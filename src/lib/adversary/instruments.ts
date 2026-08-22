import manifest from "../../data/universe-manifest.json";
import { BUNDLED, loadBundled } from "./data";
import type { Bars } from "./signals";

/**
 * The instrument universe.
 *
 * The catalogue — tickers, labels, bar counts — is imported and therefore
 * bundled, because it is ~25 KB and every instrument picker needs it up front.
 * The price series are not: each lives as its own JSON file under public/data
 * and is fetched the first time something actually tests against it.
 *
 * That split exists because the previous single market-data.json was imported
 * by both the app and three Web Workers, so Vite inlined four copies of the
 * same 9.6 MB into the build. Fetching keeps price data out of the bundle
 * entirely and lets the universe grow past a hundred instruments.
 *
 * Both files are produced by `node scripts/build-universe.mjs`.
 */
export type AssetClass = "index" | "stock" | "forex" | "commodity" | "synthetic";

type ManifestEntry = {
  ticker: string;
  label: string;
  assetClass: Exclude<AssetClass, "synthetic">;
  source: string;
  bars: number;
  from: string;
  to: string;
  note: string;
};

type SeriesPayload = {
  ticker: string;
  dates: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
};

const CATALOGUE = (manifest as { instruments: ManifestEntry[] }).instruments;

export type Instrument = {
  ticker: string;
  label: string;
  assetClass: AssetClass;
  note: string;
  source: string;
  bars: number;
  /** First and last date present, blank for synthetic series. */
  from: string;
  to: string;
  isReal: boolean;
};

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  index: "Indices",
  stock: "Stocks & sectors",
  forex: "Forex",
  commodity: "Commodities",
  synthetic: "Synthetic controls"
};

export const INSTRUMENTS: Instrument[] = [
  ...CATALOGUE.map((s) => ({
    ticker: s.ticker,
    label: s.label,
    assetClass: s.assetClass as AssetClass,
    note: s.note || `${s.bars.toLocaleString()} daily bars, ${s.from} to ${s.to}.`,
    source: s.source,
    bars: s.bars,
    from: s.from,
    to: s.to,
    isReal: true
  })),
  ...BUNDLED.map((s) => ({
    ticker: s.ticker,
    label: s.label,
    assetClass: "synthetic" as AssetClass,
    note: `${s.description} Generated from a seeded process — not a real instrument.`,
    source: "Synthetic (seeded, volatility-clustered)",
    bars: s.bars,
    from: "",
    to: "",
    isReal: false
  }))
];

const cache = new Map<string, Bars>();
const inflight = new Map<string, Promise<Bars>>();

/**
 * Where the series files are served from. BASE_URL respects the configured
 * Vite base, so this keeps working if the app is ever hosted in a subdirectory.
 * Workers resolve it the same way, since they are bundled with the same env.
 */
const dataUrl = (ticker: string) =>
  `${import.meta.env.BASE_URL}data/${ticker.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;

function toBars(series: SeriesPayload): Bars {
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

/**
 * Load any instrument by ticker. Synthetic series are generated locally and
 * resolve immediately; real ones are fetched once and cached for the session.
 *
 * Concurrent callers share a single request — the pipeline and the screener
 * both ask for the same instrument the moment a run starts, and without this
 * they would each pull several megabytes.
 */
export async function loadInstrument(ticker: string): Promise<Bars> {
  const hit = cache.get(ticker);
  if (hit) return hit;

  const known = CATALOGUE.some((s) => s.ticker === ticker);
  if (!known) return loadBundled(ticker);

  const pending = inflight.get(ticker);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetch(dataUrl(ticker));
    if (!response.ok) {
      throw new Error(`Could not load ${ticker} (${response.status}).`);
    }
    const bars = toBars((await response.json()) as SeriesPayload);
    cache.set(ticker, bars);
    inflight.delete(ticker);
    return bars;
  })().catch((error) => {
    inflight.delete(ticker);
    throw error;
  });

  inflight.set(ticker, request);
  return request;
}

/** True once the series is in memory, so callers can skip a loading state. */
export const isInstrumentLoaded = (ticker: string): boolean => cache.has(ticker);

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
