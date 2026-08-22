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
    const { close, volume } = this.bars;
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
      case "price":
        return close;
    }
  }
}
