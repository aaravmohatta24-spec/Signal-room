/**
 * Build the instrument universe from the local archives.
 *
 * Run with: node scripts/build-universe.mjs
 *
 * WHY PER-INSTRUMENT FILES AND NOT ONE BUNDLE
 * -------------------------------------------
 * The source archives are ~2.6 GB. The previous approach imported a single
 * market-data.json into the app, which Vite then inlined into the main chunk
 * *and* into every worker chunk — four copies of the same 9.6 MB. Emitting one
 * file per instrument under public/ means the browser fetches only the series
 * it is actually testing, the JS bundle carries no price data at all, and the
 * universe can grow without touching bundle size.
 *
 * WHY A TRIMMED WINDOW
 * --------------------
 * Strategies here are daily-bar rules. Twenty years is far more than enough to
 * measure one, and the oldest bars of a 40-year series describe a market whose
 * microstructure no longer exists.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ARCHIVE_1 = "C:/Users/Asus/Downloads/archive (1)";
const ARCHIVE_3 = "C:/Users/Asus/Downloads/archive (3)";
const OUT = join(process.cwd(), "public", "data");

const MAX_BARS = 5040; // ~20 years of trading days
const MIN_BARS = 750; // ~3 years; below this a 200-day rule has nothing to say

/** Curated universe. Chosen for depth of history, liquidity and sector spread. */
const STOCKS = [
  ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["AMZN", "Amazon"], ["GOOGL", "Alphabet"],
  ["FB", "Meta Platforms (FB)"], ["NVDA", "NVIDIA"], ["TSLA", "Tesla"], ["JPM", "JPMorgan Chase"],
  ["JNJ", "Johnson and Johnson"], ["V", "Visa"], ["PG", "Procter and Gamble"], ["UNH", "UnitedHealth"],
  ["HD", "Home Depot"], ["MA", "Mastercard"], ["DIS", "Disney"], ["BAC", "Bank of America"],
  ["XOM", "Exxon Mobil"], ["CVX", "Chevron"], ["KO", "Coca-Cola"], ["PEP", "PepsiCo"],
  ["WMT", "Walmart"], ["CSCO", "Cisco"], ["INTC", "Intel"], ["VZ", "Verizon"],
  ["T", "AT and T"], ["MRK", "Merck"], ["PFE", "Pfizer"], ["ABT", "Abbott"],
  ["MCD", "McDonalds"], ["NKE", "Nike"], ["IBM", "IBM"], ["GE", "General Electric"],
  ["BA", "Boeing"], ["CAT", "Caterpillar"], ["HON", "Honeywell"], ["MMM", "3M"],
  ["AXP", "American Express"], ["GS", "Goldman Sachs"], ["MS", "Morgan Stanley"], ["C", "Citigroup"],
  ["WFC", "Wells Fargo"], ["AMD", "AMD"], ["QCOM", "Qualcomm"], ["TXN", "Texas Instruments"],
  ["ORCL", "Oracle"], ["ADBE", "Adobe"], ["CRM", "Salesforce"], ["NFLX", "Netflix"],
  ["COST", "Costco"], ["SBUX", "Starbucks"], ["LOW", "Lowes"], ["TGT", "Target"],
  ["UPS", "UPS"], ["LMT", "Lockheed Martin"], ["RTX", "Raytheon"], ["DE", "Deere"],
  ["F", "Ford"], ["GM", "General Motors"], ["DAL", "Delta Air Lines"], ["AAL", "American Airlines"],
  ["MO", "Altria"], ["HPQ", "HP"], ["AA", "Alcoa"], ["IP", "International Paper"],
  ["BMY", "Bristol-Myers Squibb"], ["DD", "DuPont"], ["ETN", "Eaton"], ["HAL", "Halliburton"],
  ["BK", "Bank of New York Mellon"], ["CNP", "CenterPoint Energy"], ["NI", "NiSource"], ["MRO", "Marathon Oil"]
];

const ETFS = [
  ["SPY", "S&P 500 ETF", "index"], ["QQQ", "Nasdaq 100 ETF", "index"], ["DIA", "Dow 30 ETF", "index"],
  ["IWM", "Russell 2000 ETF", "index"], ["MDY", "S&P MidCap 400 ETF", "index"], ["EFA", "MSCI EAFE ETF", "index"],
  ["EEM", "MSCI Emerging Markets ETF", "index"], ["VTI", "Total US Market ETF", "index"],
  ["XLF", "Financials Sector", "stock"], ["XLK", "Technology Sector", "stock"],
  ["XLE", "Energy Sector", "stock"], ["XLV", "Health Care Sector", "stock"],
  ["XLI", "Industrials Sector", "stock"], ["XLP", "Consumer Staples Sector", "stock"],
  ["XLY", "Consumer Discretionary Sector", "stock"], ["XLU", "Utilities Sector", "stock"],
  ["GLD", "Gold Trust", "commodity"], ["SLV", "Silver Trust", "commodity"],
  ["USO", "US Oil Fund", "commodity"], ["DBC", "Commodity Index", "commodity"],
  ["TLT", "20+ Year Treasury", "index"], ["IEF", "7-10 Year Treasury", "index"],
  ["HYG", "High Yield Corporate", "index"], ["LQD", "Investment Grade Corporate", "index"],
  ["EWJ", "MSCI Japan", "index"], ["EWG", "MSCI Germany", "index"],
  ["EWU", "MSCI United Kingdom", "index"], ["EWH", "MSCI Hong Kong", "index"],
  ["EWC", "MSCI Canada", "index"], ["EWA", "MSCI Australia", "index"],
  ["EWW", "MSCI Mexico", "index"], ["EWS", "MSCI Singapore", "index"]
];

/**
 * Currency columns worth carrying.
 *
 * The source already quotes every pair in market convention rather than a
 * uniform base: Euro is 1.20 USD per EUR while Japanese Yen is 110 JPY per USD.
 * So nothing is inverted here, and SANE_RANGE below asserts that assumption
 * rather than trusting it. An inverted pair still looks superficially plausible
 * and would silently poison every backtest run against it.
 */
const CURRENCIES = [
  ["Euro", "EURUSD", "Euro / US Dollar"],
  ["Japanese Yen", "USDJPY", "US Dollar / Japanese Yen"],
  ["U.K. Pound Sterling", "GBPUSD", "Pound Sterling / US Dollar"],
  ["Australian Dollar", "AUDUSD", "Australian Dollar / US Dollar"],
  ["Canadian Dollar", "USDCAD", "US Dollar / Canadian Dollar"],
  ["Swiss Franc", "USDCHF", "US Dollar / Swiss Franc"],
  ["Chinese Yuan", "USDCNY", "US Dollar / Chinese Yuan"],
  ["Indian Rupee", "USDINR", "US Dollar / Indian Rupee"],
  ["Brazilian Real", "USDBRL", "US Dollar / Brazilian Real"],
  ["Mexican Peso", "USDMXN", "US Dollar / Mexican Peso"],
  ["Korean Won", "USDKRW", "US Dollar / Korean Won"],
  ["Singapore Dollar", "USDSGD", "US Dollar / Singapore Dollar"]
];

/** Plausible historical bounds per pair, used to catch an inverted series. */
const SANE_RANGE = {
  EURUSD: [0.7, 1.7], USDJPY: [70, 160], GBPUSD: [1.0, 2.2], AUDUSD: [0.45, 1.15],
  USDCAD: [0.9, 1.7], USDCHF: [0.7, 1.9], USDCNY: [5.5, 9.0], USDINR: [30, 80],
  USDBRL: [0.8, 4.5], USDMXN: [5, 25], USDKRW: [700, 2000], USDSGD: [1.1, 1.9]
};

const round = (n, dp = 4) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Parse a Yahoo-format OHLCV csv. Adj Close is preferred where present. */
function parseYahoo(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",").map((h) => h.trim());
  const iDate = head.indexOf("Date");
  const iOpen = head.indexOf("Open");
  const iHigh = head.indexOf("High");
  const iLow = head.indexOf("Low");
  const iClose = head.indexOf("Close");
  const iAdj = head.indexOf("Adj Close");
  const iVol = head.indexOf("Volume");
  if (iDate < 0 || iClose < 0) return null;

  const dates = [], open = [], high = [], low = [], close = [], volume = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const d = c[iDate];
    const o = Number(c[iOpen]), h = Number(c[iHigh]), l = Number(c[iLow]);
    const raw = Number(c[iClose]);
    const adj = iAdj >= 0 ? Number(c[iAdj]) : raw;
    const v = iVol >= 0 ? Number(c[iVol]) : 0;
    // A null or zero row is a non-trading artefact, not a real bar.
    if (!d || !Number.isFinite(raw) || raw <= 0) continue;
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l)) continue;
    // Scale OHLC by the split/dividend factor so the whole bar stays consistent
    // with the adjusted close rather than mixing adjusted and raw prices.
    const factor = Number.isFinite(adj) && raw > 0 ? adj / raw : 1;
    dates.push(d);
    open.push(round(o * factor));
    high.push(round(h * factor));
    low.push(round(l * factor));
    close.push(round(Number.isFinite(adj) ? adj : raw));
    volume.push(Number.isFinite(v) ? Math.round(v) : 0);
  }
  return { dates, open, high, low, close, volume };
}

/** Trim to the most recent MAX_BARS. */
function trim(series) {
  const n = series.close.length;
  if (n <= MAX_BARS) return series;
  const s = n - MAX_BARS;
  return {
    dates: series.dates.slice(s), open: series.open.slice(s), high: series.high.slice(s),
    low: series.low.slice(s), close: series.close.slice(s), volume: series.volume.slice(s)
  };
}

function write(entry, series) {
  const payload = {
    ticker: entry.ticker, label: entry.label, assetClass: entry.assetClass,
    source: entry.source, dates: series.dates, open: series.open, high: series.high,
    low: series.low, close: series.close, volume: series.volume
  };
  writeFileSync(join(OUT, `${entry.ticker.replace(/[^A-Za-z0-9_-]/g, "_")}.json`), JSON.stringify(payload));
  return {
    ticker: entry.ticker, label: entry.label, assetClass: entry.assetClass, source: entry.source,
    bars: series.close.length, from: series.dates[0], to: series.dates[series.dates.length - 1],
    note: entry.note ?? ""
  };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const manifest = [];
  let skipped = 0;

  for (const [sym, label] of STOCKS) {
    const p = join(ARCHIVE_1, "stocks", `${sym}.csv`);
    if (!existsSync(p)) { skipped++; continue; }
    const parsed = parseYahoo(p);
    if (!parsed || parsed.close.length < MIN_BARS) { skipped++; continue; }
    manifest.push(write({ ticker: sym, label, assetClass: "stock", source: "US equities archive" }, trim(parsed)));
  }

  for (const [sym, label, cls] of ETFS) {
    const p = join(ARCHIVE_1, "etfs", `${sym}.csv`);
    if (!existsSync(p)) { skipped++; continue; }
    const parsed = parseYahoo(p);
    if (!parsed || parsed.close.length < MIN_BARS) { skipped++; continue; }
    manifest.push(write({ ticker: sym, label, assetClass: cls, source: "US ETF archive" }, trim(parsed)));
  }

  const nasdaq = join(ARCHIVE_1, "Index", "nasdq.csv");
  if (existsSync(nasdaq)) {
    const parsed = parseYahoo(nasdaq);
    if (parsed && parsed.close.length >= MIN_BARS) {
      manifest.push(write(
        { ticker: "IXIC", label: "Nasdaq Composite", assetClass: "index", source: "Index archive" },
        trim(parsed)
      ));
    }
  }

  const fxPath = join(ARCHIVE_3, "currency_exchange_rates_02-01-1995_-_02-05-2018.csv");
  if (existsSync(fxPath)) {
    const lines = readFileSync(fxPath, "utf8").trim().split(/\r?\n/);
    const head = lines[0].split(",").map((h) => h.trim());
    for (const [col, ticker, label] of CURRENCIES) {
      const idx = head.indexOf(col);
      if (idx < 0) continue;
      const dates = [], close = [];
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(",");
        const v = Number(cells[idx]);
        if (!Number.isFinite(v) || v <= 0) continue;
        // Normalise the date: the source writes 1995-1-2 rather than 1995-01-02.
        const [y, mo, d] = cells[0].split("-");
        if (!y || !mo || !d) continue;
        dates.push(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`);
        close.push(round(v, 6));
      }
      if (close.length < MIN_BARS) { skipped++; continue; }
      const [lo, hi] = SANE_RANGE[ticker] ?? [0, Infinity];
      const min = Math.min(...close), max = Math.max(...close);
      if (min < lo || max > hi) {
        throw new Error(
          `${ticker} spans ${min}-${max}, outside the plausible ${lo}-${hi}. ` +
          "The source column is probably quoted the other way up."
        );
      }
      // The source is a daily fixing: one price per day, no OHLC. Synthesising a
      // high and low would invent intraday range that never existed, so open,
      // high and low all carry the close. Rules reading high/low on FX therefore
      // behave as close-only, which is the honest reading of this data.
      const series = trim({
        dates, open: close.slice(), high: close.slice(), low: close.slice(),
        close, volume: close.map(() => 0)
      });
      manifest.push(write(
        {
          ticker, label, assetClass: "forex", source: "Daily currency fixings 1995-2018",
          note: "Daily fixing: close-only, no intraday range."
        },
        series
      ));
    }
  }

  manifest.sort((a, b) => a.assetClass.localeCompare(b.assetClass) || a.ticker.localeCompare(b.ticker));
  const payload = { builtAt: new Date().toISOString(), instruments: manifest };
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(payload, null, 1));
  // A second copy lives in src/ so the app can import the catalogue synchronously.
  // It is ~25 KB of names and bar counts; the price series it points at stay in
  // public/ and are fetched only when a strategy is actually run against them.
  mkdirSync(join(process.cwd(), "src", "data"), { recursive: true });
  writeFileSync(
    join(process.cwd(), "src", "data", "universe-manifest.json"),
    JSON.stringify(payload, null, 1)
  );

  const bytes = readdirSync(OUT).reduce((sum, f) => sum + statSync(join(OUT, f)).size, 0);
  const byClass = {};
  for (const m of manifest) byClass[m.assetClass] = (byClass[m.assetClass] ?? 0) + 1;
  console.log(`wrote ${manifest.length} instruments (${(bytes / 1e6).toFixed(1)} MB), skipped ${skipped}`);
  console.log(byClass);
}

main();
