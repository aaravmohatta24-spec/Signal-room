import type { Bars } from "./signals";

/**
 * Bundled price data (§8.3).
 *
 * PROVENANCE — stated plainly because this product has no standing to be vague
 * about it: these series are SYNTHETIC. They are generated deterministically
 * from a seeded process with volatility clustering, fat tails and a drift term,
 * so they behave like markets statistically, but they are not any real
 * instrument's history and must never be presented as one. The UI labels them
 * as synthetic everywhere they appear.
 *
 * For real analysis, users upload their own OHLCV CSV. That path is the one
 * that matters; these series exist so the tool is usable in ten seconds and so
 * the demo never depends on a network call.
 */

/** Mulberry32 — small, fast, deterministic. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller standard normal draw. */
export function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type SyntheticConfig = {
  ticker: string;
  label: string;
  description: string;
  seed: number;
  bars: number;
  /** Annualised drift. */
  drift: number;
  /** Long-run annualised volatility. */
  baseVol: number;
  /** GARCH-like persistence of volatility shocks, 0–1. */
  volPersistence: number;
  /** Degrees of freedom for the t-distribution; lower = fatter tails. */
  tailDf: number;
};

export const BUNDLED: SyntheticConfig[] = [
  {
    ticker: "SYN-BROAD",
    label: "Broad index",
    description: "Trending, moderate volatility, occasional sharp drawdowns.",
    seed: 20260821,
    bars: 5040,
    drift: 0.08,
    baseVol: 0.16,
    volPersistence: 0.94,
    tailDf: 5
  },
  {
    ticker: "SYN-TECH",
    label: "High-beta growth",
    description: "Stronger drift, much higher volatility, violent regime shifts.",
    seed: 777001,
    bars: 5040,
    drift: 0.12,
    baseVol: 0.30,
    volPersistence: 0.96,
    tailDf: 4
  },
  {
    ticker: "SYN-DEFENSIVE",
    label: "Defensive",
    description: "Low drift, low volatility, shallow drawdowns.",
    seed: 424242,
    bars: 5040,
    drift: 0.04,
    baseVol: 0.10,
    volPersistence: 0.90,
    tailDf: 7
  },
  {
    ticker: "SYN-CYCLICAL",
    label: "Mean-reverting cyclical",
    description: "Little net drift with persistent multi-month swings.",
    seed: 909090,
    bars: 5040,
    drift: 0.01,
    baseVol: 0.22,
    volPersistence: 0.93,
    tailDf: 5
  },
  {
    ticker: "SYN-RANDOM",
    label: "Pure random walk",
    description: "Zero drift, no structure whatsoever. Nothing can be learned here.",
    seed: 13131313,
    bars: 5040,
    drift: 0,
    baseVol: 0.18,
    volPersistence: 0.0,
    tailDf: 30
  }
];

/** Student-t draw, for returns with heavier tails than a normal. */
function studentT(rand: () => number, df: number): number {
  // Normal / sqrt(chi2/df), with chi2 built from a sum of squared normals.
  let chi2 = 0;
  for (let i = 0; i < df; i++) chi2 += gaussian(rand) ** 2;
  return gaussian(rand) / Math.sqrt(chi2 / df);
}

function businessDates(count: number, startYear = 2005): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(startYear, 0, 3));
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Generate one synthetic instrument. Volatility follows a persistent process so
 * calm and turbulent regimes cluster the way they do in real markets — which
 * matters, because the regime attack is meaningless against homoscedastic noise.
 */
export function generateSeries(config: SyntheticConfig): Bars {
  const rand = seededRandom(config.seed);
  const n = config.bars;
  const dailyDrift = config.drift / 252;
  const longRunVar = (config.baseVol / Math.sqrt(252)) ** 2;

  const open = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const close = new Float64Array(n);
  const volume = new Float64Array(n);

  let price = 100;
  let currentVar = longRunVar;

  for (let i = 0; i < n; i++) {
    // Persistent variance: today's variance is mostly yesterday's, pulled back
    // toward the long-run level.
    currentVar = config.volPersistence * currentVar + (1 - config.volPersistence) * longRunVar;
    const shock = studentT(rand, config.tailDf) * Math.sqrt(currentVar);
    // Feed the shock back into variance so large moves beget large moves.
    currentVar += 0.08 * (shock * shock - currentVar);

    const prevClose = price;
    const ret = dailyDrift + shock;
    price = Math.max(prevClose * (1 + ret), 0.5);

    const gap = prevClose * gaussian(rand) * Math.sqrt(currentVar) * 0.25;
    const openPrice = Math.max(prevClose + gap, 0.5);
    const range = Math.abs(shock) * prevClose * (0.6 + rand() * 0.8);

    open[i] = openPrice;
    close[i] = price;
    high[i] = Math.max(openPrice, price) + range * 0.5;
    low[i] = Math.max(Math.min(openPrice, price) - range * 0.5, 0.1);
    volume[i] = Math.round(1_000_000 * (0.6 + rand() * 0.9) * (1 + Math.abs(shock) * 12));
  }

  return { ticker: config.ticker, dates: businessDates(n), open, high, low, close, volume };
}

const cache = new Map<string, Bars>();

export function loadBundled(ticker: string): Bars {
  const hit = cache.get(ticker);
  if (hit) return hit;
  const config = BUNDLED.find((c) => c.ticker === ticker) ?? BUNDLED[0];
  const series = generateSeries(config);
  cache.set(ticker, series);
  return series;
}

/**
 * A random walk with volatility matched to `source` and zero drift. This is the
 * control arm of the headline demonstration: a search over this data has
 * nothing to find, so whatever the search returns is pure selection bias.
 */
export function matchedRandomWalk(source: Bars, seed: number): Bars {
  const n = source.close.length;
  const rand = seededRandom(seed);

  const rets: number[] = [];
  for (let i = 1; i < n; i++) rets.push(source.close[i] / source.close[i - 1] - 1);
  const mu = rets.reduce((t, r) => t + r, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((t, r) => t + (r - mu) ** 2, 0) / (rets.length - 1));

  const open = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const close = new Float64Array(n);
  const volume = new Float64Array(n);

  let price = source.close[0];
  for (let i = 0; i < n; i++) {
    const prev = price;
    const ret = gaussian(rand) * sd; // zero drift by construction
    price = Math.max(prev * (1 + ret), 0.5);
    const openPrice = Math.max(prev * (1 + gaussian(rand) * sd * 0.3), 0.5);
    const range = Math.abs(ret) * prev;
    open[i] = openPrice;
    close[i] = price;
    high[i] = Math.max(openPrice, price) + range * 0.5;
    low[i] = Math.max(Math.min(openPrice, price) - range * 0.5, 0.1);
    volume[i] = Math.round(1_000_000 * (0.6 + rand() * 0.9));
  }

  return { ticker: `${source.ticker}-NOISE`, dates: source.dates, open, high, low, close, volume };
}

/** Parse an uploaded OHLCV CSV: `date, open, high, low, close, volume`. */
export function parseOhlcvCsv(text: string, ticker = "UPLOAD"): Bars {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 30) throw new Error("Need at least 30 rows of data to run anything meaningful.");

  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    lines[0].split(d).length > lines[0].split(best).length ? d : best
  , ",");

  const header = lines[0].toLowerCase().split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
  const columnFor = (...names: string[]) => header.findIndex((h) => names.includes(h));

  const iDate = columnFor("date", "time", "timestamp", "datetime");
  const iOpen = columnFor("open", "o");
  const iHigh = columnFor("high", "h");
  const iLow = columnFor("low", "l");
  const iClose = columnFor("close", "c", "adj close", "adj_close");
  const iVolume = columnFor("volume", "vol", "v");

  if (iDate < 0 || iClose < 0) {
    throw new Error("CSV needs at least a date column and a close column.");
  }

  const dates: string[] = [];
  const o: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  const v: number[] = [];

  for (const line of lines.slice(1)) {
    const cells = line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    const close = Number(cells[iClose]);
    if (!Number.isFinite(close) || close <= 0) continue;
    dates.push(cells[iDate]);
    c.push(close);
    o.push(iOpen >= 0 && Number.isFinite(Number(cells[iOpen])) ? Number(cells[iOpen]) : close);
    h.push(iHigh >= 0 && Number.isFinite(Number(cells[iHigh])) ? Number(cells[iHigh]) : close);
    l.push(iLow >= 0 && Number.isFinite(Number(cells[iLow])) ? Number(cells[iLow]) : close);
    v.push(iVolume >= 0 && Number.isFinite(Number(cells[iVolume])) ? Number(cells[iVolume]) : 1);
  }

  if (c.length < 30) throw new Error("Fewer than 30 usable rows after parsing. Check the column headers.");

  // Oldest-first is required; many exports are newest-first.
  const ascending = new Date(dates[0]).getTime() <= new Date(dates[dates.length - 1]).getTime();
  const order = ascending ? c.map((_, i) => i) : c.map((_, i) => c.length - 1 - i);
  const pick = (src: number[]) => Float64Array.from(order.map((i) => src[i]));

  return {
    ticker,
    dates: order.map((i) => dates[i]),
    open: pick(o),
    high: pick(h),
    low: pick(l),
    close: pick(c),
    volume: pick(v)
  };
}
