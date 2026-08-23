/// <reference lib="webworker" />
import { loadInstrument, maxLookbackFor } from "./instruments";
import { runBacktest, type CostModel } from "./engine";
import { blockBootstrap, randomSpec } from "./generator";
import { seededRandom } from "./data";
import { playbookFor } from "./playbook";
import { SignalCache, type Bars } from "./signals";
import { describeSpec, validateSpec, type StrategySpec } from "./spec";
import { annualise, deflatedSharpe, nullSharpeVariance, percentileRank } from "./stats";
import type { AssetClass } from "./instruments";

/**
 * The Signal Room pipeline.
 *
 * Stage 1 — Strategy Maker: generate a pool of distinct strategies for one
 *   instrument, drawn from the grammar and from the setups conventionally used
 *   on that asset class.
 * Stage 2 — Adversary: red-team every candidate and eliminate the fragile ones,
 *   leaving a single survivor.
 * Stage 3 is a deep backtest, run on the main thread against the winner.
 */
const DEFAULT_COSTS: CostModel = { feeBps: 10, slippageBps: 5 };
const COST_STEPS = [0, 10, 25, 50, 100];
const BOOTSTRAP_PATHS = 25;
const NOISE_SAMPLES = 300;
/** Share of the ordeal battery a strategy must clear to count as a survivor. */
const SURVIVAL_THRESHOLD = 0.75;

export type PipelineRequest = {
  type: "run";
  ticker: string;
  assetClass: AssetClass;
  /** How many strategies to generate. The spec calls for 5–20. */
  poolSize: number;
  seed: number;
  /**
   * A pool built elsewhere. When present the worker skips generation and races
   * exactly these, so the Adversary judges the candidates the Strategy Maker
   * displayed rather than a fresh draw that merely resembles them.
   */
  supplied?: { spec: StrategySpec; origin: "playbook" | "generated" }[];
};

/** One test in the red-team battery. */
export type Ordeal = {
  name: string;
  passed: boolean;
  detail: string;
};

export type Candidate = {
  id: string;
  name: string;
  description: string;
  origin: "playbook" | "generated";
  spec: StrategySpec;
  sharpeAnnual: number;
  totalReturn: number;
  maxDrawdown: number;
  tradeCount: number;
  ordeals: Ordeal[];
  /** Ordeals survived, out of the battery. */
  survived: number;
  /** Composite robustness, 0–100. */
  robustness: number;
  eliminated: boolean;
  /** Why it was killed, if it was. */
  causeOfDeath: string | null;
  equity: number[];
};

export type PipelineProgress = { type: "progress"; stage: 1 | 2; done: number; total: number; label: string };
export type PipelineComplete = {
  type: "complete";
  candidates: Candidate[];
  winnerId: string | null;
  poolSize: number;
  /**
   * Dates matching the thinned equity arrays, index for index, so a chart can
   * label its own x-axis without re-deriving the sampling the worker used.
   */
  dates: string[];
};
export type PipelineMessage = PipelineProgress | PipelineComplete | { type: "error"; message: string };

function thin(equity: Float64Array, points = 200): number[] {
  const step = Math.max(1, Math.floor(equity.length / points));
  const out: number[] = [];
  for (let i = 0; i < equity.length; i += step) out.push(equity[i]);
  return out;
}

/** Same sampling as thin(), applied to the date labels. */
function thinDates(dates: string[], length: number, points = 200): string[] {
  const step = Math.max(1, Math.floor(length / points));
  const out: string[] = [];
  for (let i = 0; i < length; i += step) out.push(dates[i] ?? "");
  return out;
}

/** A crude signature so the pool contains genuinely distinct rules, not near-duplicates. */
const signatureOf = (spec: StrategySpec): string => {
  const right = "kind" in spec.entry.right ? `${spec.entry.right.kind}` : "const";
  return `${spec.entry.direction}|${spec.entry.left.kind}|${spec.entry.comparator}|${right}`;
};

/* ------------------------------------------------------------------ */
/* Stage 1 — Strategy Maker                                            */
/* ------------------------------------------------------------------ */

function buildPool(ticker: string, assetClass: AssetClass, poolSize: number, seed: number, bars: Bars) {
  const cap = maxLookbackFor(bars.close.length);
  const pool: { spec: StrategySpec; origin: "playbook" | "generated" }[] = [];
  const seen = new Set<string>();

  // Start from the setups conventionally used on this asset class, so the pool
  // is anchored in strategies people actually run rather than pure noise.
  for (const entry of playbookFor(assetClass)) {
    if (pool.length >= poolSize) break;
    const spec = entry.build(ticker, assetClass);
    if (validateSpec(spec).length) continue;
    const signature = signatureOf(spec);
    if (seen.has(signature)) continue;
    seen.add(signature);
    pool.push({ spec, origin: "playbook" });
  }

  // Fill the remainder with fresh draws from the grammar, rejecting shapes the
  // pool already contains so the candidates stay distinct.
  const rand = seededRandom(seed);
  let attempts = 0;
  while (pool.length < poolSize && attempts < poolSize * 60) {
    attempts++;
    const spec = randomSpec(rand, ticker, pool.length, cap);
    if (validateSpec(spec).length) continue;
    const signature = signatureOf(spec);
    if (seen.has(signature)) continue;
    // A strategy that never trades is not a strategy.
    if (runBacktest(spec, bars, DEFAULT_COSTS).metrics.tradeCount < 5) continue;
    seen.add(signature);
    spec.name = `Generated ${pool.length + 1}`;
    pool.push({ spec, origin: "generated" });
  }

  return pool;
}

/* ------------------------------------------------------------------ */
/* Stage 2 — Adversary                                                 */
/* ------------------------------------------------------------------ */

function redTeam(
  spec: StrategySpec,
  bars: Bars,
  cache: SignalCache,
  nullDist: number[],
  nTrials: number,
  seed: number
): { ordeals: Ordeal[]; metrics: ReturnType<typeof runBacktest>["metrics"]; equity: number[] } {
  const result = runBacktest(spec, bars, DEFAULT_COSTS, cache);
  const m = result.metrics;
  const ordeals: Ordeal[] = [];

  // 1. Is it profitable at all, after realistic friction?
  ordeals.push({
    name: "Profitable after costs",
    passed: m.sharpe > 0,
    detail: `Annualised Sharpe ${annualise(m.sharpe).toFixed(2)} at 15bps round-trip.`
  });

  // 2. Does it beat a coin flip that traded as often?
  const rank = percentileRank(m.sharpe, nullDist);
  ordeals.push({
    name: "Beats random",
    passed: rank >= 0.8,
    detail: `Ranks at the ${(rank * 100).toFixed(0)}th percentile against ${nullDist.length} random strategies.`
  });

  // 3. Does the edge survive being told how many variants were tried?
  const { dsr } = deflatedSharpe({
    sharpe: m.sharpe,
    trialVariance: nullSharpeVariance(m.observations),
    nTrials,
    skew: m.skew,
    kurt: m.kurt,
    observations: m.observations
  });
  ordeals.push({
    name: "Survives the search cost",
    passed: dsr >= 0.8,
    detail: `${(dsr * 100).toFixed(0)}% probability the edge is real across ${nTrials} strategies tried.`
  });

  // 4. How much friction kills it?
  let breakeven = 100;
  for (const bps of COST_STEPS) {
    const sharpe = runBacktest(spec, bars, { feeBps: bps / 2, slippageBps: bps / 2 }, cache).metrics.sharpe;
    if (sharpe <= 0) {
      breakeven = bps;
      break;
    }
  }
  ordeals.push({
    name: "Withstands friction",
    passed: breakeven >= 25,
    detail: breakeven >= 100 ? "Still profitable at 100bps." : `Dies at ${breakeven}bps round-trip.`
  });

  // 5. Is the return spread across regimes, or one lucky year?
  const byYear = new Map<string, number>();
  for (let i = 1; i < result.returns.length; i++) {
    const year = (bars.dates[i] ?? "").slice(0, 4);
    byYear.set(year, (byYear.get(year) ?? 0) + result.returns[i]);
  }
  const values = [...byYear.values()];
  const totalAbs = values.reduce((t, v) => t + Math.abs(v), 0) || 1;
  const concentration = Math.max(...values.map(Math.abs)) / totalAbs;
  ordeals.push({
    name: "Not one lucky year",
    passed: concentration <= 0.5,
    detail: `Best single year accounts for ${(concentration * 100).toFixed(0)}% of total movement.`
  });

  // 6. Does it work on histories that never happened?
  let profitablePaths = 0;
  for (let i = 0; i < BOOTSTRAP_PATHS; i++) {
    const synthetic = blockBootstrap(bars, seed + i * 7919);
    if (runBacktest(spec, synthetic, DEFAULT_COSTS, new SignalCache(synthetic)).metrics.sharpe > 0) profitablePaths++;
  }
  const survivalRate = profitablePaths / BOOTSTRAP_PATHS;
  ordeals.push({
    name: "Holds on synthetic histories",
    passed: survivalRate >= 0.6,
    detail: `Profitable on ${(survivalRate * 100).toFixed(0)}% of ${BOOTSTRAP_PATHS} bootstrapped paths.`
  });

  // 7. Does it hold up in the worst quarter of the sample by volatility?
  const half = Math.floor(bars.close.length / 2);
  const secondHalf: Bars = {
    ...bars,
    dates: bars.dates.slice(half),
    open: bars.open.slice(half),
    high: bars.high.slice(half),
    low: bars.low.slice(half),
    close: bars.close.slice(half),
    volume: bars.volume.slice(half)
  };
  const oos = runBacktest(spec, secondHalf, DEFAULT_COSTS, new SignalCache(secondHalf)).metrics;
  ordeals.push({
    name: "Works out of sample",
    passed: oos.sharpe > 0,
    detail: `Second half of the record: Sharpe ${annualise(oos.sharpe).toFixed(2)}.`
  });

  // 8. Enough trades to be judged at all?
  ordeals.push({
    name: "Enough evidence",
    passed: m.tradeCount >= 20,
    detail: `${m.tradeCount} trades over the full record.`
  });

  return { ordeals, metrics: m, equity: thin(result.equity) };
}

self.onmessage = async (event: MessageEvent<PipelineRequest>) => {
  const post = (message: PipelineMessage) => self.postMessage(message);

  try {
    const { ticker, assetClass, poolSize, seed } = event.data;
    const bars = await loadInstrument(ticker);
    const cache = new SignalCache(bars);

    // Stage 1 — build the pool, unless one was handed in.
    const supplied = event.data.supplied;
    post({
      type: "progress", stage: 1, done: 0, total: supplied?.length ?? poolSize,
      label: supplied ? "Loading the imported pool…" : "Generating strategies…"
    });
    const pool = supplied?.length
      ? supplied.map((c) => ({ spec: c.spec, origin: c.origin }))
      : buildPool(ticker, assetClass, poolSize, seed, bars);
    post({ type: "progress", stage: 1, done: pool.length, total: pool.length, label: "Pool assembled." });

    // The control distribution the Adversary measures against.
    post({ type: "progress", stage: 2, done: 0, total: pool.length, label: "Building the null distribution…" });
    const rand = seededRandom(seed + 104_729);
    const cap = maxLookbackFor(bars.close.length);
    const nullDist: number[] = [];
    for (let i = 0; i < NOISE_SAMPLES; i++) {
      const candidate = randomSpec(rand, ticker, i, cap);
      const result = runBacktest(candidate, bars, DEFAULT_COSTS, cache);
      if (result.metrics.tradeCount > 0) nullDist.push(result.metrics.sharpe);
    }

    // Stage 2 — red-team each candidate.
    const candidates: Candidate[] = [];
    for (const [i, { spec, origin }] of pool.entries()) {
      post({ type: "progress", stage: 2, done: i, total: pool.length, label: `Attacking ${spec.name}…` });

      const { ordeals, metrics, equity } = redTeam(spec, bars, cache, nullDist, pool.length, seed + i);
      const survived = ordeals.filter((o) => o.passed).length;
      const firstFailure = ordeals.find((o) => !o.passed);
      // One threshold governs both the badge and the winner, so a candidate can
      // never be shown as eliminated and as the survivor at the same time.
      const threshold = Math.ceil(ordeals.length * SURVIVAL_THRESHOLD);

      candidates.push({
        id: `${ticker}-${i}`,
        name: spec.name,
        description: describeSpec(spec),
        origin,
        spec,
        sharpeAnnual: annualise(metrics.sharpe),
        totalReturn: metrics.totalReturn,
        maxDrawdown: metrics.maxDrawdown,
        tradeCount: metrics.tradeCount,
        ordeals,
        survived,
        robustness: Math.round((survived / ordeals.length) * 100),
        eliminated: survived < threshold,
        causeOfDeath: firstFailure ? `${firstFailure.name}: ${firstFailure.detail}` : null,
        equity
      });
    }

    // Rank by ordeals survived, then by Sharpe. The winner is the top entry
    // only if it actually cleared a majority of the battery — otherwise the
    // honest answer is that nothing survived.
    candidates.sort((a, b) => b.survived - a.survived || b.sharpeAnnual - a.sharpeAnnual);
    const top = candidates[0];
    const winnerId = top && !top.eliminated ? top.id : null;

    post({
      type: "complete",
      candidates,
      winnerId,
      poolSize: pool.length,
      dates: thinDates(bars.dates, bars.close.length)
    });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "Pipeline failed." });
  }
};
