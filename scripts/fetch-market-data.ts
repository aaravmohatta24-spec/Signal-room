/**
 * Build-time market data fetcher.
 *
 * Run with: npx tsx scripts/fetch-market-data.ts
 *
 * WHY A BUILD SCRIPT, NOT A RUNTIME FETCH
 * ---------------------------------------
 * This app has no backend, so anything the browser needs, the browser exposes.
 * Data is fetched here and committed as JSON; no key and no network dependency
 * ever reaches the client.
 *
 * WHY YAHOO AND NOT THE MARKETSTACK KEY
 * -------------------------------------
 * The supplied Marketstack key works, but its free tier caps at 251 daily bars
 * — one year — and offers no true indices and no forex. One year is not enough
 * to run this product honestly: a 200-day lookback leaves ~50 usable bars, and
 * the Deflated Sharpe collapses to zero for everything because the estimator's
 * standard error on a one-year sample swamps any plausible edge. Yahoo's public
 * chart endpoint returns ~26 years, real index levels (^GSPC rather than SPY)
 * and real FX crosses, which is what the statistics actually require.
 *
 * The Marketstack key is kept in .env for the optional cross-check below.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export type InstrumentClass = "index" | "stock" | "forex" | "commodity";

export type FetchedSeries = {
  ticker: string;
  label: string;
  assetClass: InstrumentClass;
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

const UNIVERSE: { symbol: string; label: string; assetClass: InstrumentClass; note: string }[] = [
  // Real index levels, not ETF proxies.
  { symbol: "^GSPC", label: "S&P 500", assetClass: "index", note: "S&P 500 index level. Broad US large cap." },
  { symbol: "^IXIC", label: "Nasdaq Composite", assetClass: "index", note: "Nasdaq Composite index. Tech-heavy, higher volatility." },
  { symbol: "^DJI", label: "Dow Jones 30", assetClass: "index", note: "Dow Jones Industrial Average. Price-weighted, 30 names." },
  { symbol: "^RUT", label: "Russell 2000", assetClass: "index", note: "US small-cap index. Noisier than large caps." },
  { symbol: "^FTSE", label: "FTSE 100", assetClass: "index", note: "UK large-cap index." },
  { symbol: "^N225", label: "Nikkei 225", assetClass: "index", note: "Japanese large-cap index. Long sideways regimes." },

  { symbol: "AAPL", label: "Apple", assetClass: "stock", note: "Apple Inc. Mega-cap with a long, strong trend." },
  { symbol: "MSFT", label: "Microsoft", assetClass: "stock", note: "Microsoft Corp. Mega-cap, steadier than most." },
  { symbol: "NVDA", label: "NVIDIA", assetClass: "stock", note: "NVIDIA Corp. Extreme volatility and momentum." },
  { symbol: "JPM", label: "JPMorgan", assetClass: "stock", note: "JPMorgan Chase. Cyclical, rate-sensitive." },
  { symbol: "XOM", label: "Exxon Mobil", assetClass: "stock", note: "Exxon Mobil. Commodity-linked, mean-reverting." },
  { symbol: "KO", label: "Coca-Cola", assetClass: "stock", note: "Coca-Cola. Low-beta defensive." },

  // Real FX crosses.
  { symbol: "EURUSD=X", label: "EUR / USD", assetClass: "forex", note: "Euro against the US dollar. The most liquid FX pair." },
  { symbol: "GBPUSD=X", label: "GBP / USD", assetClass: "forex", note: "Sterling against the US dollar." },
  { symbol: "USDJPY=X", label: "USD / JPY", assetClass: "forex", note: "US dollar against the yen. Strong trends." },

  { symbol: "GC=F", label: "Gold", assetClass: "commodity", note: "Gold futures, continuous front month." },
  { symbol: "CL=F", label: "Crude Oil", assetClass: "commodity", note: "WTI crude futures. Violent regime shifts." }
];

function loadEnv(): Record<string, string> {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type YahooChart = {
  chart?: {
    result?: [
      {
        timestamp?: number[];
        indicators?: {
          quote?: [{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }];
          adjclose?: [{ adjclose?: (number | null)[] }];
        };
      }
    ];
    error?: { description?: string };
  };
};

async function fetchYahoo(symbol: string) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=946684800&period2=9999999999&interval=1d`;

  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`);

  const json = (await response.json()) as YahooChart;
  if (json.chart?.error) throw new Error(`${symbol}: ${json.chart.error.description ?? "chart error"}`);

  const result = json.chart?.result?.[0];
  const stamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!stamps?.length || !quote?.close) throw new Error(`${symbol}: no rows`);

  const adj = result?.indicators?.adjclose?.[0]?.adjclose;

  const dates: string[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  const volume: number[] = [];

  for (let i = 0; i < stamps.length; i++) {
    // Yahoo emits nulls for halted or non-trading sessions. A null close makes
    // the whole bar unusable, and carrying it forward would invent a flat day
    // that never happened.
    const c = adj?.[i] ?? quote.close[i];
    if (c === null || c === undefined || !Number.isFinite(c) || c <= 0) continue;

    dates.push(new Date(stamps[i] * 1000).toISOString().slice(0, 10));
    close.push(c);
    open.push(quote.open?.[i] ?? c);
    high.push(quote.high?.[i] ?? c);
    low.push(quote.low?.[i] ?? c);
    // FX and index series carry no meaningful volume; 1 keeps volume_ratio
    // defined without implying a real figure.
    volume.push(quote.volume?.[i] ?? 1);
  }

  if (close.length < 500) throw new Error(`${symbol}: only ${close.length} usable bars`);
  return { dates, open, high, low, close, volume };
}

async function main() {
  const outDir = resolve(process.cwd(), "src/data");
  mkdirSync(outDir, { recursive: true });

  const series: FetchedSeries[] = [];
  const failures: string[] = [];

  for (const instrument of UNIVERSE) {
    try {
      await sleep(250);
      const bars = await fetchYahoo(instrument.symbol);
      series.push({
        ticker: instrument.symbol,
        label: instrument.label,
        assetClass: instrument.assetClass,
        note: instrument.note,
        source: "Yahoo Finance daily bars, split- and dividend-adjusted",
        fetchedAt: new Date().toISOString().slice(0, 10),
        ...bars
      });
      console.log(
        `  ok    ${instrument.symbol.padEnd(10)} ${String(bars.close.length).padEnd(6)} bars  ` +
          `${bars.dates[0]} → ${bars.dates[bars.dates.length - 1]}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      console.error(`  FAIL  ${message}`);
    }
  }

  if (!series.length) {
    console.error("\nNo series fetched. Nothing written.");
    process.exit(1);
  }

  writeFileSync(resolve(outDir, "market-data.json"), JSON.stringify(series), "utf8");

  const shortest = series.reduce((min, s) => (s.close.length < min.close.length ? s : min));
  console.log(`\nWrote ${series.length} instruments to src/data/market-data.json`);
  console.log(`Shallowest: ${shortest.ticker} at ${shortest.close.length} bars (~${(shortest.close.length / 252).toFixed(1)} years).`);
  if (failures.length) console.log(`${failures.length} symbol(s) failed.`);

  // Optional sanity check against the second provider, if a key is present.
  const key = loadEnv().MARKETSTACK_KEY;
  if (key) {
    try {
      const response = await fetch(`https://api.marketstack.com/v1/eod?access_key=${key}&symbols=AAPL&limit=1`);
      const json = (await response.json()) as { data?: { close: number; date: string }[] };
      const row = json.data?.[0];
      const ours = series.find((s) => s.ticker === "AAPL");
      if (row && ours) {
        const mine = ours.close[ours.close.length - 1];
        const drift = Math.abs(mine - row.close) / row.close;
        console.log(
          `\nCross-check AAPL vs Marketstack: ${mine.toFixed(2)} vs ${row.close.toFixed(2)} ` +
            `(${(drift * 100).toFixed(2)}% apart)${drift > 0.05 ? "  ← investigate" : ""}`
        );
      }
    } catch {
      console.log("\nCross-check skipped (Marketstack unreachable).");
    }
  }
}

main();
