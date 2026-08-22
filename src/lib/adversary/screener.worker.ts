/// <reference lib="webworker" />
import { loadInstrument, maxLookbackFor } from "./instruments";
import { runBacktest, type CostModel } from "./engine";
import { blockBootstrap, randomSpec, sampleStrategies } from "./generator";
import { seededRandom } from "./data";
import { SignalCache, type Bars } from "./signals";
import type { StrategySpec } from "./spec";
import { annualise, deflatedSharpe, percentileRank, variance } from "./stats";

/**
 * The stress tester.
 *
 * Builds every strategy in the preset library (plus parameter variants) against
 * every selected instrument, backtests all of them, and puts each one through a
 * fast battery of the same falsification tests the Adversary runs in full.
 *
 * The important design decision is what "best" means here. Ranking by Sharpe
 * would rebuild exactly the data-mining machine this product exists to expose —
 * the top of a Sharpe-ranked list of several hundred strategies is, by
 * construction, mostly selection bias. So candidates are ranked by a SURVIVAL
 * score built from the adversarial tests, and their Sharpe is deflated by the
 * full size of the search before it is shown at all.
 */
const COST_STEPS = [0, 10, 25, 50, 100];
const BOOTSTRAP_PATHS = 10;
const NOISE_SAMPLES = 200;
const DEFAULT_COSTS: CostModel = { feeBps: 10, slippageBps: 5 };

export type ScreenRequest = {
  type: "screen";
  tickers: string[];
  /** How many strategies to generate per instrument. */
  strategiesPerInstrument: number;
  seed: number;
  /** Trials the user has already spent, so the deflation reflects their history. */
  priorTrials: number;
};

export type ScreenCandidate = {
  /** Stable id for this generated strategy. */
  id: string;
  /** Which signal family the generator happened to draw. */
  family: string;
  ticker: string;
  spec: StrategySpec;
  sharpeAnnual: number;
  totalReturn: number;
  maxDrawdown: number;
  tradeCount: number;
  /** Probability the edge survives the whole search, 0–1. */
  dsr: number;
  /** Round-trip basis points at which the Sharpe crosses zero. */
  breakevenBps: number;
  /** Share of total movement contributed by the single best year, 0–1. */
  worstYearConcentration: number;
  /** Fraction of bootstrapped histories that stayed profitable, 0–1. */
  bootstrapSurvival: number;
  /** Percentile against random strategies on the same instrument, 0–1. */
  noisePercentile: number;
  /** Composite 0–100. */
  survivalScore: number;
  verdict: "DEAD" | "WOUNDED" | "SURVIVED";
  equity: number[];
};

export type ScreenProgress = { type: "progress"; done: number; total: number; label: string };
export type ScreenComplete = {
  type: "complete";
  candidates: ScreenCandidate[];
  /** Every strategy evaluated, including variants — the true trial count. */
  trialsRun: number;
  trialSharpes: number[];
};
export type ScreenMessage = ScreenProgress | ScreenComplete | { type: "error"; message: string };

function thin(equity: Float64Array, points = 220): number[] {
  const step = Math.max(1, Math.floor(equity.length / points));
  const out: number[] = [];
  for (let i = 0; i < equity.length; i += step) out.push(equity[i]);
  return out;
}

/** Share of total absolute movement contributed by the single strongest year. */
function yearConcentration(returns: Float64Array, dates: string[]): number {
  const byYear = new Map<string, number>();
  for (let i = 1; i < returns.length; i++) {
    const year = (dates[i] ?? "").slice(0, 4) || "?";
    byYear.set(year, (byYear.get(year) ?? 0) + returns[i]);
  }
  const values = [...byYear.values()];
  const totalAbs = values.reduce((t, v) => t + Math.abs(v), 0);
  if (totalAbs === 0) return 1;
  return Math.max(...values.map(Math.abs)) / totalAbs;
}

/** Coarse cost sweep; returns the first level at which the Sharpe turns non-positive. */
function breakeven(spec: StrategySpec, bars: Bars, cache: SignalCache): number {
  for (const bps of COST_STEPS) {
    const sharpe = runBacktest(spec, bars, { feeBps: bps / 2, slippageBps: bps / 2 }, cache).metrics.sharpe;
    if (sharpe <= 0) return bps;
  }
  return 100;
}

function bootstrapSurvival(spec: StrategySpec, bars: Bars, seed: number): number {
  let profitable = 0;
  for (let i = 0; i < BOOTSTRAP_PATHS; i++) {
    const synthetic = blockBootstrap(bars, seed + i * 7919);
    const sharpe = runBacktest(spec, synthetic, DEFAULT_COSTS, new SignalCache(synthetic)).metrics.sharpe;
    if (sharpe > 0) profitable++;
  }
  return profitable / BOOTSTRAP_PATHS;
}

/**
 * Composite survival score. Deliberately weights the adversarial dimensions
 * above raw performance: a spectacular Sharpe that dies at 10bps and only works
 * in one year should rank below a modest one that holds up everywhere.
 */
function scoreOf(c: Omit<ScreenCandidate, "survivalScore" | "verdict">): number {
  const dsr = c.dsr * 30; // survives the search
  const noise = Math.max(0, (c.noisePercentile - 0.5) * 2) * 20; // beats random
  const boot = c.bootstrapSurvival * 20; // works on histories that never happened
  const cost = Math.min(c.breakevenBps / 50, 1) * 15; // survives friction
  const regime = Math.max(0, 1 - c.worstYearConcentration / 0.6) * 10; // not one lucky year
  const trades = Math.min(c.tradeCount / 30, 1) * 5; // enough evidence to judge
  return Math.round(dsr + noise + boot + cost + regime + trades);
}

function verdictOf(c: Omit<ScreenCandidate, "survivalScore" | "verdict">): ScreenCandidate["verdict"] {
  // A DSR failure is fatal on its own, exactly as in the full attack suite.
  if (c.dsr < 0.8) return "DEAD";
  const failures =
    (c.noisePercentile < 0.8 ? 1 : 0) +
    (c.bootstrapSurvival < 0.4 ? 1 : 0) +
    (c.breakevenBps < 15 ? 1 : 0) +
    (c.worstYearConcentration > 0.6 ? 1 : 0);
  if (failures >= 2) return "DEAD";
  if (failures === 1 || c.dsr < 0.95) return "WOUNDED";
  return "SURVIVED";
}

self.onmessage = async (event: MessageEvent<ScreenRequest>) => {
  const post = (message: ScreenMessage) => self.postMessage(message);

  try {
    const { tickers, strategiesPerInstrument, seed, priorTrials } = event.data;

    // Strategies are GENERATED from the grammar, not drawn from a fixed list.
    // That matters for more than variety: the Deflated Sharpe needs the variance
    // of the null distribution, and that is only measurable over a search space
    // the generator can actually sample. Lookbacks are capped against each
    // instrument's length so nothing is generated that the data cannot judge.
    const jobs: { spec: StrategySpec; id: string; family: string; ticker: string }[] = [];
    for (const [t, ticker] of tickers.entries()) {
      const bars = await loadInstrument(ticker);
      const cap = maxLookbackFor(bars.close.length);
      const specs = sampleStrategies(strategiesPerInstrument, ticker, seed + t * 7907, cap);
      for (const [i, spec] of specs.entries()) {
        jobs.push({ spec, id: `${ticker}-${i}`, family: spec.entry.left.kind, ticker });
      }
    }

    const total = jobs.length;
    // Trials include the noise benchmark strategies, which are real searches too.
    const trialsRun = total + tickers.length * NOISE_SAMPLES;
    const totalTrials = priorTrials + trialsRun;

    // One noise distribution and one signal cache per instrument, reused across
    // every candidate on that instrument.
    const caches = new Map<string, SignalCache>();
    const barsFor = new Map<string, Bars>();
    const noiseDist = new Map<string, number[]>();

    for (const [i, ticker] of tickers.entries()) {
      post({ type: "progress", done: 0, total, label: `Building the null distribution for ${ticker}…` });
      const bars = await loadInstrument(ticker);
      const cache = new SignalCache(bars);
      barsFor.set(ticker, bars);
      caches.set(ticker, cache);

      const rand = seededRandom(seed + i * 104_729);
      const sharpes: number[] = [];
      for (let k = 0; k < NOISE_SAMPLES; k++) {
        const candidate = randomSpec(rand, ticker, k, maxLookbackFor(bars.close.length));
        const result = runBacktest(candidate, bars, DEFAULT_COSTS, cache);
        if (result.metrics.tradeCount > 0) sharpes.push(result.metrics.sharpe);
      }
      noiseDist.set(ticker, sharpes);
    }

    // Variance of the null, measured rather than assumed.
    const allNoise = [...noiseDist.values()].flat();
    const trialVariance = allNoise.length >= 20 ? variance(allNoise) : (0.5 / Math.sqrt(252)) ** 2;

    const candidates: ScreenCandidate[] = [];
    const trialSharpes: number[] = [];

    for (const [index, job] of jobs.entries()) {
      const bars = barsFor.get(job.ticker)!;
      const cache = caches.get(job.ticker)!;
      const result = runBacktest(job.spec, bars, DEFAULT_COSTS, cache);
      const m = result.metrics;
      trialSharpes.push(m.sharpe);

      if (index % 10 === 0) {
        post({ type: "progress", done: index, total, label: `Testing  strategies on ` });
      }

      // A strategy that never trades tells us nothing; skip the expensive tests.
      if (m.tradeCount === 0) continue;

      const { dsr } = deflatedSharpe({
        sharpe: m.sharpe,
        trialVariance,
        nTrials: Math.max(totalTrials, 1),
        skew: m.skew,
        kurt: m.kurt,
        observations: m.observations
      });

      const partial = {
        id: job.id,
        family: job.family,
        ticker: job.ticker,
        spec: job.spec,
        sharpeAnnual: annualise(m.sharpe),
        totalReturn: m.totalReturn,
        maxDrawdown: m.maxDrawdown,
        tradeCount: m.tradeCount,
        dsr,
        breakevenBps: breakeven(job.spec, bars, cache),
        worstYearConcentration: yearConcentration(result.returns, bars.dates),
        bootstrapSurvival: bootstrapSurvival(job.spec, bars, seed + index),
        noisePercentile: percentileRank(m.sharpe, noiseDist.get(job.ticker) ?? []),
        equity: thin(result.equity)
      };

      candidates.push({ ...partial, survivalScore: scoreOf(partial), verdict: verdictOf(partial) });
    }

    post({ type: "progress", done: total, total, label: "Ranking survivors…" });

    // Rank by survival, not by Sharpe. Sharpe breaks ties only.
    candidates.sort((a, b) => b.survivalScore - a.survivalScore || b.sharpeAnnual - a.sharpeAnnual);

    post({ type: "complete", candidates, trialsRun, trialSharpes });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "Screening failed." });
  }
};
