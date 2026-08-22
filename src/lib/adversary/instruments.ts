import rawSeries from "../../data/market-data.json";
import { BUNDLED, loadBundled } from "./data";
import type { Bars } from "./signals";

/**
 * The instrument universe: real market data alongside the synthetic controls.
 *
 * Real series are fetched at build time by `scripts/fetch-market-data.ts` and
 * committed as JSON, so no API key is ever exposed to the browser and no demo
 * depends on a network call succeeding.
 */
export type AssetClass = "index" | "stock" | "forex" | "commodity" | "synthetic";

type RawSeries = {
  ticker: string;
  label: string;
  assetClass: Exclude<AssetClass, "synthetic">;
  note: string;
  source: string;
  fetchedAt: string;
  dates: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
};

const REAL = rawSeries as RawSeries[];

export type Instrument = {
  ticker: string;
  label: string;
  assetClass: AssetClass;
  note: string;
  source: string;
  bars: number;
  isReal: boolean;
};

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  index: "Indices",
  stock: "Stocks",
  forex: "Forex",
  commodity: "Commodities",
  synthetic: "Synthetic controls"
};

export const INSTRUMENTS: Instrument[] = [
  ...REAL.map((s) => ({
    ticker: s.ticker,
    label: s.label,
    assetClass: s.assetClass as AssetClass,
    note: s.note,
    source: s.source,
    bars: s.close.length,
    isReal: true
  })),
  ...BUNDLED.map((s) => ({
    ticker: s.ticker,
    label: s.label,
    assetClass: "synthetic" as AssetClass,
    note: `${s.description} Generated from a seeded process — not a real instrument.`,
    source: "Synthetic (seeded, volatility-clustered)",
    bars: s.bars,
    isReal: false
  }))
];

const cache = new Map<string, Bars>();

function toBars(series: RawSeries): Bars {
  return {
    ticker: series.ticker,
    dates: series.dates,
    open: Float64Array.from(series.open),
    high: Float64Array.from(series.high),
    low: Float64Array.from(series.low),
    close: Float64Array.from(series.close),
    volume: Float64Array.from(series.volume)
  };
}

/** Load any instrument, real or synthetic, by ticker. */
export function loadInstrument(ticker: string): Bars {
  const hit = cache.get(ticker);
  if (hit) return hit;

  const real = REAL.find((s) => s.ticker === ticker);
  if (real) {
    const bars = toBars(real);
    cache.set(ticker, bars);
    return bars;
  }

  return loadBundled(ticker);
}

export const instrumentByTicker = (ticker: string): Instrument | undefined =>
  INSTRUMENTS.find((i) => i.ticker === ticker);

/**
 * Longest indicator lookback that leaves enough post-warm-up bars to say
 * anything. A 200-day average on one year of data leaves ~50 usable bars, which
 * is not a backtest — it is an anecdote. Capping at a fifth of the sample keeps
 * at least 80% of the series available for evaluation.
 */
export const maxLookbackFor = (barCount: number): number =>
  Math.max(5, Math.min(250, Math.floor(barCount / 5)));

/**
 * How much can honestly be concluded from a series of this length. Surfaced in
 * the UI next to the instrument, because the answer for one year of data is
 * "considerably less than you would like".
 */
export function depthWarning(barCount: number): string | null {
  const years = barCount / 252;
  if (years >= 3) return null;
  if (years >= 1.5) {
    return `${years.toFixed(1)} years of data. Calendar-year regime analysis has few buckets to compare, so that attack is weak here.`;
  }
  return (
    `Only ${years.toFixed(1)} years of data (${barCount} bars). Lookbacks are capped at ` +
    `${maxLookbackFor(barCount)} days, regime analysis is barely meaningful, and the track record is far too short ` +
    `for a Sharpe ratio to reach significance. Treat every result here as provisional.`
  );
}
