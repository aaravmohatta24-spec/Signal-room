import { DEFAULT_COSTS, runBacktest, type CostModel } from "./engine";
import { blockBootstrap, randomSpec } from "./generator";
import { seededRandom } from "./data";
import { probabilityOfBacktestOverfitting } from "./pbo";
import { SignalCache, type Bars } from "./signals";
import { numericParams, withParam, type StrategySpec } from "./spec";
import {
  annualise,
  deflatedSharpe,
  haircutSharpe,
  median,
  minTrackRecordLength,
  percentileRank,
  sharpeRatio,
  nullSharpeVariance,
  HARVEY_LIU_IMPLIED_TRIALS,
  TRADING_DAYS
} from "./stats";

export type AttackStatus = "pass" | "warn" | "fail";

export type AttackResult = {
  id: string;
  name: string;
  question: string;
  status: AttackStatus;
  /** The headline number, already formatted for display. */
  headline: string;
  explanation: string;
  /** Chart payload, shape depends on the attack. */
  chart: AttackChart;
};

export type AttackChart =
  | { kind: "none" }
  | { kind: "distribution"; values: number[]; marker: number; markerLabel: string }
  | { kind: "curve"; points: { x: number; y: number }[]; marker?: number; xLabel: string; yLabel: string }
  | { kind: "bars"; points: { label: string; value: number }[]; highlight?: string };

const statusFrom = (value: number, passAbove: number, warnAbove: number): AttackStatus =>
  value >= passAbove ? "pass" : value >= warnAbove ? "warn" : "fail";

/* ------------------------------------------------------------------ */
/* Attack 1 — search cost (Deflated Sharpe Ratio)                      */
/* ------------------------------------------------------------------ */

export function attackSearchCost(
  strategySharpe: number,
  skew: number,
  kurt: number,
  observations: number,
  trialSharpes: number[],
  nTrials: number
): AttackResult {
  // The null's dispersion is the sampling variance of the Sharpe estimator, not
  // the raw spread of whatever strategies happen to have been tried. See
  // `nullSharpeVariance` — using the empirical spread of a mixed population
  // inflates the bar by roughly 2.5x and fails everything regardless of merit.
  const trialVariance = nullSharpeVariance(observations);

  const { dsr, expectedMaxAnnual } = deflatedSharpe({
    sharpe: strategySharpe,
    trialVariance,
    nTrials: Math.max(nTrials, 1),
    skew,
    kurt,
    observations
  });

  const status = statusFrom(dsr, 0.95, 0.8);

  return {
    id: "search-cost",
    name: "Search cost",
    question: "Does your Sharpe survive being told how many variants you tried?",
    status,
    headline: `DSR ${(dsr * 100).toFixed(1)}%`,
    explanation:
      `Across ${nTrials.toLocaleString()} trial${nTrials === 1 ? "" : "s"}, the best result expected from pure luck is an ` +
      `annualised Sharpe of ${expectedMaxAnnual.toFixed(2)}. Yours is ${annualise(strategySharpe).toFixed(2)}. ` +
      `That leaves a ${(dsr * 100).toFixed(1)}% probability the edge is real rather than the best draw from your search.`,
    chart: {
      kind: "distribution",
      values: trialSharpes.map((s) => annualise(s)),
      marker: annualise(strategySharpe),
      markerLabel: "your strategy"
    }
  };
}

/* ------------------------------------------------------------------ */
/* Attack 2 — parameter stability                                      */
/* ------------------------------------------------------------------ */

export function attackParameterStability(
  spec: StrategySpec,
  bars: Bars,
  costs: CostModel,
  cache: SignalCache
): AttackResult {
  const params = numericParams(spec);
  const chosenSharpe = runBacktest(spec, bars, costs, cache).metrics.sharpe;

  if (!params.length) {
    return {
      id: "parameter-stability",
      name: "Parameter stability",
      question: "Did you find a robust region, or a lucky spike?",
      status: "warn",
      headline: "No tunable parameters",
      explanation: "This strategy exposes no numeric parameters, so there is no neighbourhood to test.",
      chart: { kind: "none" }
    };
  }

  // Sweep the first parameter ±50% and measure how the neighbourhood behaves.
  const param = params[0];
  const points: { x: number; y: number }[] = [];
  const neighbourhood: number[] = [];

  const lo = Math.max(param.min, param.value * 0.5);
  const hi = Math.min(param.max, param.value * 1.5);
  const steps = 21;

  for (let i = 0; i < steps; i++) {
    const value = lo + ((hi - lo) * i) / (steps - 1);
    const variant = withParam(spec, param.path, value);
    const sharpe = runBacktest(variant, bars, costs, cache).metrics.sharpe;
    points.push({ x: Number(value.toFixed(2)), y: Number(annualise(sharpe).toFixed(3)) });
    neighbourhood.push(sharpe);
  }

  const neighbourhoodMedian = median(neighbourhood);
  const profitableShare = neighbourhood.filter((s) => s > 0).length / neighbourhood.length;
  // A spike is a chosen point far above its own neighbourhood.
  const ratio = neighbourhoodMedian > 0 ? chosenSharpe / neighbourhoodMedian : chosenSharpe > 0 ? 3 : 0;

  const status: AttackStatus =
    ratio <= 1.3 && profitableShare >= 0.6 ? "pass" : ratio <= 2 && profitableShare >= 0.4 ? "warn" : "fail";

  return {
    id: "parameter-stability",
    name: "Parameter stability",
    question: "Did you find a robust region, or a lucky spike?",
    status,
    headline: `${(profitableShare * 100).toFixed(0)}% of neighbours profitable`,
    explanation:
      `Sweeping ${param.path.split(".").pop()} by ±50%, your chosen value scores ${ratio.toFixed(2)}× the median of its ` +
      `neighbourhood and ${(profitableShare * 100).toFixed(0)}% of nearby settings stay profitable. ` +
      (status === "pass"
        ? "That is a plateau, which is what a real edge looks like."
        : "A real edge sits on a plateau; this looks more like a needle."),
    chart: {
      kind: "curve",
      points,
      marker: param.value,
      xLabel: param.path.split(".").pop() ?? "parameter",
      yLabel: "Annualised Sharpe"
    }
  };
}

/* ------------------------------------------------------------------ */
/* Attack 3 — regime dependence                                        */
/* ------------------------------------------------------------------ */

export function attackRegimeDependence(returns: Float64Array, dates: string[]): AttackResult {
  const byYear = new Map<string, number>();
  for (let i = 1; i < returns.length; i++) {
    const year = (dates[i] ?? "").slice(0, 4) || "?";
    byYear.set(year, (byYear.get(year) ?? 0) + returns[i]);
  }

  const entries = [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b));
  const totalAbs = entries.reduce((total, [, value]) => total + Math.abs(value), 0);
  const best = entries.reduce((top, entry) => (entry[1] > top[1] ? entry : top), entries[0] ?? ["?", 0]);
  const share = totalAbs > 0 ? Math.abs(best[1]) / totalAbs : 0;

  const status: AttackStatus = share < 0.4 ? "pass" : share <= 0.6 ? "warn" : "fail";

  return {
    id: "regime",
    name: "Regime dependence",
    question: "Did all your returns come from one lucky period?",
    status,
    headline: `${(share * 100).toFixed(0)}% from ${best[0]}`,
    explanation:
      `${best[0]} accounts for ${(share * 100).toFixed(0)}% of the strategy's total movement across ${entries.length} years. ` +
      (status === "pass"
        ? "Returns are spread across regimes rather than concentrated in one."
        : "A strategy whose return is concentrated in one period is a bet on that period, not an edge."),
    chart: {
      kind: "bars",
      points: entries.map(([label, value]) => ({ label, value: Number((value * 100).toFixed(2)) })),
      highlight: best[0]
    }
  };
}

/* ------------------------------------------------------------------ */
/* Attack 4 — cost sensitivity                                         */
/* ------------------------------------------------------------------ */

export function attackCostSensitivity(spec: StrategySpec, bars: Bars, cache: SignalCache): AttackResult {
  const points: { x: number; y: number }[] = [];
  let breakeven: number | null = null;

  for (let bps = 0; bps <= 100; bps += 5) {
    const sharpe = runBacktest(spec, bars, { feeBps: bps / 2, slippageBps: bps / 2 }, cache).metrics.sharpe;
    points.push({ x: bps, y: Number(annualise(sharpe).toFixed(3)) });
    if (breakeven === null && sharpe <= 0) breakeven = bps;
  }

  const survivesTo = breakeven ?? 100;
  const status: AttackStatus = survivesTo > 50 ? "pass" : survivesTo >= 15 ? "warn" : "fail";

  return {
    id: "costs",
    name: "Cost sensitivity",
    question: "How much friction kills it?",
    status,
    headline: breakeven === null ? "Survives 100bps" : `Dies at ${breakeven}bps`,
    explanation:
      breakeven === null
        ? "Still profitable at 100bps round-trip, which is more friction than most liquid instruments impose."
        : `Sharpe crosses zero at ${breakeven}bps round-trip. ` +
          (status === "fail"
            ? "Realistic retail costs alone are enough to eliminate this edge."
            : "That leaves little headroom once real spreads and slippage are included."),
    chart: { kind: "curve", points, xLabel: "Round-trip cost (bps)", yLabel: "Annualised Sharpe" }
  };
}

/* ------------------------------------------------------------------ */
/* Attack 5 — noise benchmark                                          */
/* ------------------------------------------------------------------ */

export function attackNoiseBenchmark(
  strategySharpe: number,
  bars: Bars,
  costs: CostModel,
  cache: SignalCache,
  sampleCount: number,
  seed: number
): AttackResult {
  const rand = seededRandom(seed);
  const sharpes: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const candidate = randomSpec(rand, bars.ticker, i);
    const result = runBacktest(candidate, bars, costs, cache);
    if (result.metrics.tradeCount > 0) sharpes.push(result.metrics.sharpe);
  }

  const pct = percentileRank(strategySharpe, sharpes);
  const status: AttackStatus = pct > 0.95 ? "pass" : pct >= 0.8 ? "warn" : "fail";

  return {
    id: "noise",
    name: "Noise benchmark",
    question: "Did you beat a coin flip that traded as often as you did?",
    status,
    headline: `Beats ${(pct * 100).toFixed(0)}% of random strategies`,
    explanation:
      `Against ${sharpes.length.toLocaleString()} randomly generated strategies on the same data, yours ranks at the ` +
      `${(pct * 100).toFixed(0)}th percentile. ` +
      (status === "pass"
        ? "That is genuinely hard to achieve by chance."
        : "Random strategies routinely reach this level, so the result is not distinguishable from luck."),
    chart: {
      kind: "distribution",
      values: sharpes.map((s) => annualise(s)),
      marker: annualise(strategySharpe),
      markerLabel: "your strategy"
    }
  };
}

/* ------------------------------------------------------------------ */
/* Attack 6 — synthetic markets                                        */
/* ------------------------------------------------------------------ */

export function attackSyntheticMarkets(
  spec: StrategySpec,
  bars: Bars,
  costs: CostModel,
  paths: number,
  seed: number
): AttackResult {
  const sharpes: number[] = [];

  for (let i = 0; i < paths; i++) {
    const synthetic = blockBootstrap(bars, seed + i * 7919);
    const result = runBacktest(spec, synthetic, costs, new SignalCache(synthetic));
    sharpes.push(result.metrics.sharpe);
  }

  const profitable = sharpes.filter((s) => s > 0).length / (sharpes.length || 1);
  const status: AttackStatus = profitable > 0.7 ? "pass" : profitable >= 0.4 ? "warn" : "fail";

  return {
    id: "synthetic",
    name: "Synthetic markets",
    question: "Does it work on histories that never happened?",
    status,
    headline: `Profitable on ${(profitable * 100).toFixed(0)}% of paths`,
    explanation:
      `Across ${sharpes.length} bootstrapped histories that preserve the volatility structure of the original, the ` +
      `strategy stays profitable on ${(profitable * 100).toFixed(0)}%. ` +
      (status === "pass"
        ? "It has learned something about the process, not just this one realisation of it."
        : "History happened once; a strategy that only works on that one path has learned the path, not the process."),
    chart: {
      kind: "distribution",
      values: sharpes.map((s) => annualise(s)),
      marker: 0,
      markerLabel: "breakeven"
    }
  };
}

/* ------------------------------------------------------------------ */
/* Attack 7 — multiple-testing haircut (Harvey & Liu)                  */
/* ------------------------------------------------------------------ */

export function attackHaircut(strategySharpe: number, observations: number, nTrials: number): AttackResult {
  const { haircut, adjustedSharpe, pValue, adjustedPValue, tStat } = haircutSharpe(
    strategySharpe,
    observations,
    nTrials
  );

  // A haircut is a proportion of the edge lost to multiple testing, so the
  // status thresholds run the opposite way from the other attacks.
  const status: AttackStatus = haircut < 0.3 ? "pass" : haircut <= 0.7 ? "warn" : "fail";
  const effectiveTrials = Math.max(HARVEY_LIU_IMPLIED_TRIALS, nTrials);

  return {
    id: "haircut",
    name: "Multiple-testing haircut",
    question: "How much of your Sharpe is left once the whole search is priced in?",
    status,
    headline: `${(haircut * 100).toFixed(0)}% haircut`,
    explanation:
      `Your Sharpe implies a t-statistic of ${tStat.toFixed(2)} and a raw p-value of ${pValue.toFixed(4)}. ` +
      `Adjusted for ${effectiveTrials.toLocaleString()} implied trials under Benjamini–Hochberg–Yekutieli, that p-value ` +
      `becomes ${adjustedPValue.toFixed(4)}, which corresponds to an annualised Sharpe of ${annualise(adjustedSharpe).toFixed(2)} ` +
      `rather than ${annualise(strategySharpe).toFixed(2)}. ` +
      (status === "pass"
        ? "Most of the edge survives the adjustment."
        : "The majority of the reported edge is compensation for how widely you searched, not evidence of skill."),
    chart: {
      kind: "bars",
      points: [
        { label: "Reported", value: Number(annualise(strategySharpe).toFixed(3)) },
        { label: "After haircut", value: Number(annualise(adjustedSharpe).toFixed(3)) }
      ],
      highlight: "After haircut"
    }
  };
}

/* ------------------------------------------------------------------ */
/* Attack 8 — backtest overfitting (CSCV / PBO)                        */
/* ------------------------------------------------------------------ */

/**
 * Builds the configuration family that CSCV compares. These are the variants
 * the user was implicitly choosing between when they settled on their
 * parameters, whether or not they consciously tried them.
 */
function configFamily(spec: StrategySpec, bars: Bars, costs: CostModel, cache: SignalCache): number[][] {
  const params = numericParams(spec);
  if (!params.length) return [];

  const param = params[0];
  const lo = Math.max(param.min, param.value * 0.5);
  const hi = Math.min(param.max, param.value * 1.5);
  const steps = 24;

  const matrix: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const value = lo + ((hi - lo) * i) / (steps - 1);
    const variant = withParam(spec, param.path, value);
    const result = runBacktest(variant, bars, costs, cache);
    matrix.push(Array.from(result.returns));
  }
  return matrix;
}

export function attackOverfitting(
  spec: StrategySpec,
  bars: Bars,
  costs: CostModel,
  cache: SignalCache
): AttackResult {
  const matrix = configFamily(spec, bars, costs, cache);

  if (matrix.length < 2) {
    return {
      id: "overfitting",
      name: "Backtest overfitting",
      question: "Would picking the in-sample best have worked out of sample?",
      status: "warn",
      headline: "No configuration family",
      explanation:
        "This strategy exposes no tunable parameter, so there is no family of variants to have selected from and " +
        "nothing for cross-validation to compare.",
      chart: { kind: "none" }
    };
  }

  const { pbo, logits, splits, configs, meanIsSharpe, meanOosSharpe } = probabilityOfBacktestOverfitting({
    matrix
  });

  const status: AttackStatus = pbo < 0.3 ? "pass" : pbo <= 0.5 ? "warn" : "fail";
  const degradation = annualise(meanIsSharpe) - annualise(meanOosSharpe);

  return {
    id: "overfitting",
    name: "Backtest overfitting",
    question: "Would picking the in-sample best have worked out of sample?",
    status,
    headline: `PBO ${(pbo * 100).toFixed(0)}%`,
    explanation:
      `Across ${splits} combinatorial train/test splits of ${configs} parameter variants, the configuration that looked ` +
      `best in-sample landed below the median out-of-sample ${(pbo * 100).toFixed(0)}% of the time. ` +
      `In-sample Sharpe averaged ${annualise(meanIsSharpe).toFixed(2)} against ${annualise(meanOosSharpe).toFixed(2)} ` +
      `out-of-sample, a degradation of ${degradation.toFixed(2)}. ` +
      (status === "pass"
        ? "Selecting on in-sample performance carried real information here."
        : "At this rate the selection rule you used is barely better than picking a variant at random."),
    chart: {
      kind: "distribution",
      values: logits,
      marker: 0,
      markerLabel: "median OOS"
    }
  };
}

/* ------------------------------------------------------------------ */
/* Verdict (§7.5)                                                       */
/* ------------------------------------------------------------------ */

export type VerdictStatus = "DEAD" | "WOUNDED" | "SURVIVED";

export type Verdict = {
  status: VerdictStatus;
  attacks: AttackResult[];
  reasons: string[];
  remedy: string;
};

const SEVERITY: Record<AttackStatus, number> = { fail: 0, warn: 1, pass: 2 };

export function buildVerdict(
  attacks: AttackResult[],
  context: { sharpe: number; skew: number; kurt: number; observations: number }
): Verdict {
  const failures = attacks.filter((a) => a.status === "fail");
  const warnings = attacks.filter((a) => a.status === "warn");
  const dsrFailed = attacks.some((a) => a.id === "search-cost" && a.status === "fail");

  // A DSR failure is an automatic kill: it means the result is statistically
  // indistinguishable from the best of a random search, which is the thesis.
  const status: VerdictStatus =
    dsrFailed || failures.length >= 2 ? "DEAD" : failures.length === 1 || warnings.length >= 3 ? "WOUNDED" : "SURVIVED";

  const reasons = [...attacks]
    .filter((a) => a.status !== "pass")
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status])
    .map((a) => `${a.name}: ${a.headline.toLowerCase()}.`);

  const required = minTrackRecordLength(context.sharpe, 0, context.skew, context.kurt, 0.95);
  let remedy: string;

  if (status === "SURVIVED") {
    remedy = "Nothing here killed it. That is not proof of an edge — it is failure to disprove one. Test it forward.";
  } else if (required === null) {
    remedy = "The Sharpe is not positive, so no amount of additional data would make it significant.";
  } else {
    const yearsNeeded = required / TRADING_DAYS;
    const haveYears = context.observations / TRADING_DAYS;
    remedy =
      yearsNeeded <= haveYears
        ? `At this Sharpe the track record is already long enough for significance; the failures above are about robustness, not sample size.`
        : `At this Sharpe you would need about ${yearsNeeded.toFixed(1)} years of data to reach 95% confidence — you have ${haveYears.toFixed(1)}.`;
  }

  return { status, attacks, reasons, remedy };
}

export { DEFAULT_COSTS, sharpeRatio };
