import type { SignalKind, SignalSpec } from "./spec";

/**
 * Indicator library. Every function returns a series the same length as its
 * input, with `NaN` in the warm-up region so the engine can skip bars where a
 * signal is not yet defined rather than silently treating them as zero.
 *
 * Signals are computed from data up to and including bar `t`; the engine
 * executes on bar `t+1`. That separation is what prevents lookahead.
 */
export type Bars = {
  ticker: string;
  dates: string[];
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
};

const filled = (n: number) => {
  const out = new Float64Array(n);
  out.fill(NaN);
  return out;
};

export function sma(values: Float64Array, period: number): Float64Array {
  const out = filled(values.length);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: Float64Array, period: number): Float64Array {
  const out = filled(values.length);
  if (period < 1 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI, the standard smoothing used by charting packages. */
export function rsi(values: Float64Array, period: number): Float64Array {
  const out = filled(values.length);
  if (values.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const up = change >= 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Rolling z-score of price against its own trailing window. */
export function zscore(values: Float64Array, period: number): Float64Array {
  const out = filled(values.length);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mu = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - mu) ** 2;
    const sd = Math.sqrt(sq / (period - 1));
    out[i] = sd === 0 ? 0 : (values[i] - mu) / sd;
  }
  return out;
}

/** Percentage return over `period` bars. */
export function momentum(values: Float64Array, period: number): Float64Array {
  const out = filled(values.length);
  for (let i = period; i < values.length; i++) {
    const base = values[i - period];
    out[i] = base === 0 ? 0 : ((values[i] - base) / base) * 100;
  }
  return out;
}

/** Annualised rolling volatility of daily log returns, in percent. */
export function volatility(values: Float64Array, period: number): Float64Array {
  const out = filled(values.length);
  const rets = filled(values.length);
  for (let i = 1; i < values.length; i++) {
    rets[i] = values[i - 1] > 0 ? Math.log(values[i] / values[i - 1]) : 0;
  }
  for (let i = period; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += rets[j];
    const mu = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (rets[j] - mu) ** 2;
    out[i] = Math.sqrt(sq / (period - 1)) * Math.sqrt(252) * 100;
  }
  return out;
}

/** Volume relative to its own trailing average, as a ratio. */
export function volumeRatio(volume: Float64Array, period: number): Float64Array {
  const out = filled(volume.length);
  const avg = sma(volume, period);
  for (let i = 0; i < volume.length; i++) {
    if (!Number.isNaN(avg[i]) && avg[i] > 0) out[i] = volume[i] / avg[i];
  }
  return out;
}

/**
 * Average True Range: the mean bar range, counting gaps.
 *
 * True range takes the widest of the current bar's own range and its two gaps
 * from the previous close, so an instrument that opens away from yesterday is
 * not recorded as having been quiet. Wilder's original smoothing is used
 * rather than a simple mean, which is what every charting package computes.
 *
 * On a series where high and low repeat the close — the daily FX fixings in
 * this dataset have no intraday range — this necessarily reduces to the mean
 * absolute close-to-close change. That is the honest reading of such data, not
 * a defect, but it does mean ATR-derived signals are weaker there.
 */
export function atr(
  high: Float64Array,
  low: Float64Array,
  close: Float64Array,
  period: number
): Float64Array {
  const out = filled(close.length);
  if (close.length < 2) return out;

  const tr = filled(close.length);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < close.length; i++) {
    tr[i] = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
  }

  let seed = 0;
  for (let i = 1; i <= period && i < close.length; i++) seed += tr[i];
  let prev = seed / Math.max(1, Math.min(period, close.length - 1));
  out[period] = prev;
  for (let i = period + 1; i < close.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Multiplier on the ATR band. 3 is the conventional Supertrend setting. */
const SUPERTREND_MULTIPLIER = 3;

/**
 * Supertrend direction: +1 in an uptrend, -1 in a downtrend.
 *
 * The indicator itself is a pair of ATR bands that ratchet — the lower band
 * only rises while price holds above it, the upper only falls — and the trend
 * flips when a band is breached. What the rule grammar needs is a comparable
 * number, so the direction is returned rather than the band level: a spec can
 * then say supertrend(10) is above 0 and mean "in an uptrend".
 *
 * The multiplier is fixed at its conventional 3 because a SignalSpec carries a
 * single period. Exposing it would mean widening the grammar for every signal
 * to carry a second parameter, which is a larger change than this earns.
 */
export function supertrend(
  high: Float64Array,
  low: Float64Array,
  close: Float64Array,
  period: number
): Float64Array {
  const out = filled(close.length);
  const range = atr(high, low, close, period);

  let upper = Number.NaN;
  let lower = Number.NaN;
  let direction = 1;

  for (let i = 0; i < close.length; i++) {
    if (Number.isNaN(range[i])) continue;
    const mid = (high[i] + low[i]) / 2;
    const rawUpper = mid + SUPERTREND_MULTIPLIER * range[i];
    const rawLower = mid - SUPERTREND_MULTIPLIER * range[i];

    // Bands ratchet: they tighten toward price and only reset once price has
    // closed through them. Without this the indicator would flip on any bar
    // where volatility happened to contract.
    upper = Number.isNaN(upper) || rawUpper < upper || close[i - 1] > upper ? rawUpper : upper;
    lower = Number.isNaN(lower) || rawLower > lower || close[i - 1] < lower ? rawLower : lower;

    if (close[i] > upper) direction = 1;
    else if (close[i] < lower) direction = -1;

    out[i] = direction;
  }
  return out;
}

/**
 * Where the close sits relative to the PRIOR N-bar high/low range, scaled so
 * that 0 is the prior low and 100 the prior high.
 *
 * It is not clipped to 0-100, and it should not be: the window excludes the
 * current bar, so a close that clears the range reads above 100 and one that
 * breaks below reads under 0. That overshoot is the breakout. Measured on 20
 * years of SPY the series runs roughly -93 to +148, with the extremes falling
 * on gap days such as March 2020.
 *
 * Expressing the channel as a position rather than a level is what lets the
 * grammar compare it against a constant, the same way it compares RSI.
 */
export function donchian(
  high: Float64Array,
  low: Float64Array,
  close: Float64Array,
  period: number
): Float64Array {
  const out = filled(close.length);
  for (let i = period; i < close.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    // The window excludes the current bar: a breakout must clear the range that
    // existed before it, otherwise every bar trivially sits inside its own high
    // and low and the signal could be read before it was knowable.
    for (let j = i - period; j < i; j++) {
      if (high[j] > hi) hi = high[j];
      if (low[j] < lo) lo = low[j];
    }
    const span = hi - lo;
    out[i] = span > 0 ? ((close[i] - lo) / span) * 100 : 50;
  }
  return out;
}

const cacheKey = (spec: SignalSpec) => `${spec.kind}:${spec.period}`;

/**
 * Signal cache.
 *
 * The 1,000-strategy sweep re-uses the same indicators constantly. Computing
 * each series once per dataset and reusing the arrays is the difference between
 * a sweep that takes seconds and one that takes minutes (§8.2).
 */
export class SignalCache {
  private readonly cache = new Map<string, Float64Array>();

  constructor(private readonly bars: Bars) {}

  get(spec: SignalSpec): Float64Array {
    const key = cacheKey(spec);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const series = this.compute(spec.kind, spec.period);
    this.cache.set(key, series);
    return series;
  }

  private compute(kind: SignalKind, period: number): Float64Array {
    const { high, low, close, volume } = this.bars;
    switch (kind) {
      case "sma":
        return sma(close, period);
      case "ema":
        return ema(close, period);
      case "rsi":
        return rsi(close, period);
      case "zscore":
        return zscore(close, period);
      case "momentum":
        return momentum(close, period);
      case "volatility":
        return volatility(close, period);
      case "volume_ratio":
        return volumeRatio(volume, period);
      case "supertrend":
        return supertrend(high, low, close, period);
      case "donchian":
        return donchian(high, low, close, period);
      case "price":
        return close;
    }
  }
}
