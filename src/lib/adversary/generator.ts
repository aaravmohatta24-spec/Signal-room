import { gaussian, seededRandom } from "./data";
import type { Bars } from "./signals";
import {
  BOUNDED_SIGNALS,
  PERIOD_RANGE,
  SIGNAL_KINDS,
  type Comparator,
  type ExitRule,
  type SignalKind,
  type SignalSpec,
  type SizingRule,
  type StrategySpec
} from "./spec";

/**
 * Random strategy sampler (§7.6).
 *
 * The generator exists for demonstration, not discovery. Its two real jobs:
 *
 *  - measure the null distribution of Sharpe ratios directly, rather than
 *    assuming it, which is what makes this implementation of the Deflated
 *    Sharpe Ratio stronger than the usual one;
 *  - run the same search against real data and against noise, so the user can
 *    see that the winners are indistinguishable.
 *
 * Every strategy it produces counts as a trial and raises the significance bar.
 */

const pick = <T>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)];

// `maxPeriod` caps lookbacks against the length of the series being tested. A
// 200-day average on one year of data leaves ~50 usable bars, so generating
// such a strategy at all would produce a result that cannot be judged.
const periodIn = (rand: () => number, kind: SignalKind, maxPeriod = Infinity): number => {
  const [min, rangeMax] = PERIOD_RANGE[kind];
  const max = Math.max(min, Math.min(rangeMax, maxPeriod));
  return Math.round(min + rand() * (max - min));
};

/** Threshold ranges that are sensible for each bounded oscillator. */
function thresholdFor(rand: () => number, kind: SignalKind): number {
  switch (kind) {
    case "rsi":
      return Math.round(15 + rand() * 70);
    case "zscore":
      return Number((-2.5 + rand() * 5).toFixed(2));
    case "momentum":
      return Number((-15 + rand() * 30).toFixed(1));
    case "volume_ratio":
      return Number((0.6 + rand() * 1.8).toFixed(2));
    default:
      return 0;
  }
}

export function randomSpec(rand: () => number, universe: string, index: number, maxPeriod = Infinity): StrategySpec {
  const bounded = rand() < 0.5;
  const kind: SignalKind = bounded
    ? pick(rand, BOUNDED_SIGNALS)
    : pick(rand, (["sma", "ema", "price"] as const));

  const left: SignalSpec = { kind, period: periodIn(rand, kind, maxPeriod) };

  let right: StrategySpec["entry"]["right"];
  let comparator: Comparator;

  if (bounded) {
    right = { constant: thresholdFor(rand, kind) };
    comparator = pick(rand, (["greater_than", "less_than", "crosses_above", "crosses_below"] as const));
  } else {
    // Price-scale signals are compared against another price-scale signal, so
    // the classic moving-average crossover is reachable.
    const rightKind: SignalKind = pick(rand, (["sma", "ema", "price"] as const));
    right = { kind: rightKind, period: periodIn(rand, rightKind, maxPeriod) };
    comparator = pick(rand, (["crosses_above", "crosses_below", "greater_than", "less_than"] as const));
  }

  const exits: ExitRule[] = [{ kind: "opposite_signal" }];
  if (rand() < 0.55) exits.push({ kind: "stop_loss", pct: Number((1 + rand() * 9).toFixed(1)) });
  if (rand() < 0.4) exits.push({ kind: "take_profit", pct: Number((2 + rand() * 15).toFixed(1)) });
  if (rand() < 0.3) exits.push({ kind: "time_stop", days: Math.round(3 + rand() * 60) });
  if (rand() < 0.25) exits.push({ kind: "trailing_stop", pct: Number((2 + rand() * 10).toFixed(1)) });

  const sizingRoll = rand();
  const sizing: SizingRule =
    sizingRoll < 0.5
      ? { kind: "fixed_fraction", pct: Math.round(20 + rand() * 80) }
      : sizingRoll < 0.8
        ? { kind: "inverse_volatility", lookback: Math.round(20 + rand() * 60) }
        : { kind: "equal_weight" };

  return {
    name: `Generated #${index + 1}`,
    universe,
    entry: { left, comparator, right, direction: rand() < 0.5 ? "long" : "short" },
    exits,
    sizing
  };
}

export function sampleStrategies(count: number, universe: string, seed: number, maxPeriod = Infinity): StrategySpec[] {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => randomSpec(rand, universe, i, maxPeriod));
}

/**
 * Stationary block bootstrap (§7.4, attack 6).
 *
 * Resamples returns in blocks of geometrically distributed length so that
 * short-range dependence — volatility clustering in particular — survives the
 * resampling. Mean block length ~20 days, which the spec calls sufficient for
 * v1 and which avoids fitting a GARCH model.
 */
export function blockBootstrap(source: Bars, seed: number, meanBlock = 20): Bars {
  const n = source.close.length;
  const rand = seededRandom(seed);

  const rets: number[] = [];
  for (let i = 1; i < n; i++) rets.push(source.close[i] / source.close[i - 1] - 1);

  const resampled: number[] = [];
  const p = 1 / meanBlock;
  let cursor = Math.floor(rand() * rets.length);

  while (resampled.length < rets.length) {
    resampled.push(rets[cursor % rets.length]);
    // Either continue the current block or jump to a new random start.
    cursor = rand() < p ? Math.floor(rand() * rets.length) : cursor + 1;
  }

  const open = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const close = new Float64Array(n);
  const volume = new Float64Array(n);

  let price = source.close[0];
  close[0] = price;
  open[0] = price;
  high[0] = price;
  low[0] = price;
  volume[0] = source.volume[0];

  for (let i = 1; i < n; i++) {
    const prev = price;
    const ret = resampled[i - 1];
    price = Math.max(prev * (1 + ret), 0.5);
    const openPrice = Math.max(prev * (1 + gaussian(rand) * Math.abs(ret) * 0.3), 0.5);
    const range = Math.abs(ret) * prev;
    open[i] = openPrice;
    close[i] = price;
    high[i] = Math.max(openPrice, price) + range * 0.5;
    low[i] = Math.max(Math.min(openPrice, price) - range * 0.5, 0.1);
    volume[i] = source.volume[i];
  }

  return { ticker: `${source.ticker}-BOOT`, dates: source.dates, open, high, low, close, volume };
}
