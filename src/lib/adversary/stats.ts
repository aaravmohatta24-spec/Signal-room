/**
 * Statistical primitives for the Adversary attack suite.
 *
 * The formulas here are the product's whole claim, so the sources are cited and
 * the two conventions that implementations usually get wrong are called out:
 *
 *  1. `kurtosis` is RAW (3 for a normal distribution), not excess. The published
 *     standard error carries a `(γ₄ − 1)/4 · SR²` term, which is only correct
 *     for raw kurtosis. Passing excess kurtosis silently understates the error.
 *  2. `sharpe` and `T` must be at the SAME frequency. Everything below works in
 *     per-observation (daily) units; annualisation is applied for display only.
 *
 * Sources:
 *  - Bailey & López de Prado, "The Deflated Sharpe Ratio: Correcting for
 *    Selection Bias, Backtest Overfitting and Non-Normality" (2014).
 *  - Bailey & López de Prado, "The Sharpe Ratio Efficient Frontier" (2012) for
 *    the Probabilistic Sharpe Ratio and Minimum Track Record Length.
 */

/** Euler–Mascheroni constant. */
export const EULER_MASCHERONI = 0.5772156649015329;

export const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((total, x) => total + x, 0) / xs.length : 0;

/** Sample standard deviation (n − 1 denominator). */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mu = mean(xs);
  const sumSq = xs.reduce((total, x) => total + (x - mu) ** 2, 0);
  return Math.sqrt(sumSq / (xs.length - 1));
}

export function variance(xs: number[]): number {
  const sd = stdev(xs);
  return sd * sd;
}

/** Sample skewness (third standardised moment). */
export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mu = mean(xs);
  const sd = stdev(xs);
  if (sd === 0) return 0;
  return xs.reduce((total, x) => total + ((x - mu) / sd) ** 3, 0) / n;
}

/** Sample kurtosis, RAW (a normal distribution gives 3). */
export function kurtosis(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return 3;
  const mu = mean(xs);
  const sd = stdev(xs);
  if (sd === 0) return 3;
  return xs.reduce((total, x) => total + ((x - mu) / sd) ** 4, 0) / n;
}

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 error function. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Inverse standard normal CDF (Acklam's rational approximation).
 * Accurate to ~1.15e-9, which is far beyond what this product needs.
 */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export const TRADING_DAYS = 252;

/** Per-observation Sharpe ratio. Annualise separately for display. */
export function sharpeRatio(returns: number[]): number {
  const sd = stdev(returns);
  return sd === 0 ? 0 : mean(returns) / sd;
}

export const annualise = (perPeriodSharpe: number, periodsPerYear = TRADING_DAYS): number =>
  perPeriodSharpe * Math.sqrt(periodsPerYear);

/**
 * Expected maximum Sharpe ratio under the null of no skill, across `nTrials`
 * independent trials:
 *
 *   E[max] ≈ √V · [ (1 − γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]
 *
 * `trialVariance` is the variance of Sharpe ratios across the search. Most
 * implementations assume this value; Adversary measures it from the generator
 * sweep, which is the point of §7.6(b) of the spec.
 *
 * Under H0 the mean trial Sharpe is zero, so the mean term drops out.
 */
/**
 * Variance of the Sharpe estimator under the null of no skill.
 *
 * This is the dispersion the expected-maximum formula actually assumes: N
 * strategies with zero true edge, each estimated from T observations, whose
 * observed Sharpes scatter purely from sampling noise. For normal returns that
 * variance is 1/(T−1).
 *
 * It is deliberately NOT the raw variance of a population of arbitrary
 * strategies. That population contains systematically bad members — shorting a
 * rising index, say — whose spread comes from real exposure differences rather
 * than estimation noise. Using it inflates the null's dispersion and pushes the
 * significance bar far above where the theory puts it, which fails every
 * strategy regardless of merit.
 */
export const nullSharpeVariance = (observations: number): number => 1 / Math.max(2, observations - 1);

export function expectedMaxSharpe(trialVariance: number, nTrials: number): number {
  const n = Math.max(2, nTrials);
  const g = EULER_MASCHERONI;
  return (
    Math.sqrt(Math.max(trialVariance, 0)) *
    ((1 - g) * normalInv(1 - 1 / n) + g * normalInv(1 - 1 / (n * Math.E)))
  );
}

/**
 * Standard error of the Sharpe estimator, adjusted for non-normal returns:
 *
 *   SE(SR) = √[ (1 − γ₃·SR + (γ₄ − 1)/4 · SR²) / (T − 1) ]
 *
 * with γ₃ skewness and γ₄ RAW kurtosis, all in per-observation units.
 */
export function sharpeStandardError(sr: number, skew: number, kurt: number, T: number): number {
  const n = Math.max(2, T);
  const adjustment = 1 - skew * sr + ((kurt - 1) / 4) * sr * sr;
  // The adjustment is a variance and cannot be negative; extreme sample moments
  // on very short series can drive it below zero.
  return Math.sqrt(Math.max(adjustment, 1e-12) / (n - 1));
}

/**
 * Probabilistic Sharpe Ratio: probability the true Sharpe exceeds `benchmark`.
 * All arguments in per-observation units.
 */
export function probabilisticSharpe(
  sr: number,
  benchmark: number,
  skew: number,
  kurt: number,
  T: number
): number {
  const se = sharpeStandardError(sr, skew, kurt, T);
  return se === 0 ? 0 : normalCdf((sr - benchmark) / se);
}

export type DeflatedSharpeInput = {
  /** Observed per-observation Sharpe of the selected strategy. */
  sharpe: number;
  /** Variance of per-observation Sharpe ratios across the search. */
  trialVariance: number;
  /** Number of independent trials searched. */
  nTrials: number;
  skew: number;
  /** RAW kurtosis (3 for a normal). */
  kurt: number;
  /** Number of return observations. */
  observations: number;
};

export type DeflatedSharpeResult = {
  dsr: number;
  /** Expected max Sharpe under the null, per observation. */
  expectedMax: number;
  /** Same, annualised, for display. */
  expectedMaxAnnual: number;
  standardError: number;
};

/**
 * Deflated Sharpe Ratio — the probability the strategy's Sharpe exceeds what
 * the best of `nTrials` random searches would be expected to produce.
 */
export function deflatedSharpe(input: DeflatedSharpeInput): DeflatedSharpeResult {
  const { sharpe, trialVariance, nTrials, skew, kurt, observations } = input;
  const expectedMax = expectedMaxSharpe(trialVariance, nTrials);
  const standardError = sharpeStandardError(sharpe, skew, kurt, observations);
  const dsr = standardError === 0 ? 0 : normalCdf((sharpe - expectedMax) / standardError);
  return { dsr, expectedMax, expectedMaxAnnual: annualise(expectedMax), standardError };
}

/**
 * Minimum Track Record Length — how many observations are needed for the
 * Sharpe to be significantly above `benchmark` at confidence `confidence`:
 *
 *   MinTRL = (1 − γ₃·SR + (γ₄ − 1)/4 · SR²) · ( Z⁻¹(c) / (SR − benchmark) )²  + 1
 *
 * Returns null when SR ≤ benchmark, where no track record length suffices.
 */
export function minTrackRecordLength(
  sr: number,
  benchmark: number,
  skew: number,
  kurt: number,
  confidence = 0.95
): number | null {
  if (sr <= benchmark) return null;
  const adjustment = Math.max(1 - skew * sr + ((kurt - 1) / 4) * sr * sr, 1e-12);
  const z = normalInv(confidence);
  return adjustment * (z / (sr - benchmark)) ** 2 + 1;
}

/* ------------------------------------------------------------------ */
/* Harvey–Liu haircut Sharpe ratio                                     */
/* ------------------------------------------------------------------ */

/**
 * Harmonic number c(M) = Σ 1/i, the Yekutieli correction term that makes the
 * Benjamini–Hochberg procedure valid under ARBITRARY dependence between tests.
 * Strategies drawn from one grammar over one price series are heavily
 * correlated, so the dependence-agnostic form is the honest choice here.
 */
export function harmonicNumber(m: number): number {
  let total = 0;
  for (let i = 1; i <= Math.max(1, Math.floor(m)); i++) total += 1 / i;
  return total;
}

/** Two-sided p-value for a t-statistic, using the normal approximation. */
export const twoSidedPValue = (t: number): number => 2 * (1 - normalCdf(Math.abs(t)));

export type HaircutResult = {
  /** t = SR · √T, in per-observation units. */
  tStat: number;
  /** Unadjusted two-sided p-value. */
  pValue: number;
  /** p-value after BHY multiple-testing adjustment. */
  adjustedPValue: number;
  /** t-statistic implied by the adjusted p-value. */
  adjustedTStat: number;
  /** Sharpe implied by the adjusted t-statistic, per observation. */
  adjustedSharpe: number;
  /** (SR − SR_adj) / SR, clamped to [0, 1]. */
  haircut: number;
};

/**
 * Harvey & Liu (2015), "Backtesting", §Phase 2 of the falsification suite.
 *
 * Converts the Sharpe ratio to a t-statistic, adjusts its p-value for multiple
 * testing via Benjamini–Hochberg–Yekutieli, then reverse-engineers the Sharpe
 * that the adjusted t-statistic implies. The gap between the two is the
 * "haircut" — how much of the reported Sharpe is attributable to search.
 *
 * The strategy under test is assumed to be the BEST of the `trials` searched,
 * so it takes rank 1 in the BHY ordering. That is the conservative reading, and
 * the correct one for a user who tuned until they liked the result:
 *
 *   p_adj = min(1, p · M · c(M) / rank)   with rank = 1
 *
 * Harvey & Liu run this against ~316 implied trials from the published factor
 * literature; here `trials` comes from the user's own measured trial counter,
 * floored at that literature baseline because the published factor zoo is a
 * search the user inherits whether or not they ran it themselves.
 */
export const HARVEY_LIU_IMPLIED_TRIALS = 316;

export function haircutSharpe(sr: number, observations: number, trials: number): HaircutResult {
  const T = Math.max(2, observations);
  const m = Math.max(HARVEY_LIU_IMPLIED_TRIALS, Math.floor(trials));

  const tStat = sr * Math.sqrt(T);
  const pValue = twoSidedPValue(tStat);
  const adjustedPValue = Math.min(1, pValue * m * harmonicNumber(m));

  // A fully adjusted-away p-value implies a t-statistic of zero, not -Infinity.
  const adjustedTStat = adjustedPValue >= 1 ? 0 : normalInv(1 - adjustedPValue / 2);
  const adjustedSharpe = (Math.sign(sr) || 1) * (adjustedTStat / Math.sqrt(T));

  const haircut = sr <= 0 ? 1 : Math.min(1, Math.max(0, (sr - adjustedSharpe) / sr));

  return { tStat, pValue, adjustedPValue, adjustedTStat, adjustedSharpe, haircut };
}

/** Percentile rank of `value` within `population`, as a 0–1 fraction. */
export function percentileRank(value: number, population: number[]): number {
  if (!population.length) return 0;
  const below = population.reduce((count, x) => count + (x < value ? 1 : 0), 0);
  return below / population.length;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const median = (xs: number[]): number => quantile([...xs].sort((a, b) => a - b), 0.5);
