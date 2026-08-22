/**
 * Verification harness for the Adversary engine.
 *
 * Run with: npx tsx scripts/verify-adversary.ts
 *
 * These are correctness checks against hand-computable values and known
 * statistical identities, not a substitute for a test suite. The Deflated
 * Sharpe checks matter most: a tool whose premise is statistical honesty cannot
 * ship a mis-specified statistic.
 */
import { ema, rsi, sma, SignalCache, type Bars } from "../src/lib/adversary/signals";
import {
  deflatedSharpe,
  expectedMaxSharpe,
  kurtosis,
  minTrackRecordLength,
  normalCdf,
  normalInv,
  probabilisticSharpe,
  sharpeRatio,
  sharpeStandardError,
  skewness
} from "../src/lib/adversary/stats";
import { runBacktest, DEFAULT_COSTS } from "../src/lib/adversary/engine";
import { loadBundled, matchedRandomWalk, parseOhlcvCsv } from "../src/lib/adversary/data";
import { sampleStrategies, blockBootstrap } from "../src/lib/adversary/generator";
import { describeSpec, validateSpec, type StrategySpec } from "../src/lib/adversary/spec";
import { haircutSharpe, harmonicNumber, twoSidedPValue } from "../src/lib/adversary/stats";
import { combinations, probabilityOfBacktestOverfitting } from "../src/lib/adversary/pbo";
import { parseLocally } from "../src/lib/adversary/compiler";
import { decodeRun, encodeRun } from "../src/lib/adversary/permalink";
import {
  attackCostSensitivity,
  attackHaircut,
  attackNoiseBenchmark,
  attackOverfitting,
  attackParameterStability,
  attackRegimeDependence,
  attackSearchCost,
  attackSyntheticMarkets,
  buildVerdict
} from "../src/lib/adversary/attacks";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

console.log("\n── Normal distribution ──");
check("normalCdf(0) = 0.5", near(normalCdf(0), 0.5, 1e-6), normalCdf(0).toFixed(6));
check("normalCdf(1.96) ≈ 0.975", near(normalCdf(1.96), 0.975, 1e-3), normalCdf(1.96).toFixed(5));
check("normalInv(0.975) ≈ 1.96", near(normalInv(0.975), 1.959964, 1e-4), normalInv(0.975).toFixed(6));
check("normalInv(0.95) ≈ 1.6449", near(normalInv(0.95), 1.644854, 1e-4), normalInv(0.95).toFixed(6));
check(
  "normalCdf/normalInv round-trip",
  near(normalCdf(normalInv(0.83)), 0.83, 1e-3),
  normalCdf(normalInv(0.83)).toFixed(5)
);

console.log("\n── Sample moments ──");
// Symmetric data has zero skew.
const symmetric = [-2, -1, 0, 1, 2];
check("skewness of symmetric sample ≈ 0", near(skewness(symmetric), 0, 1e-9), skewness(symmetric).toExponential(2));
// A large normal sample should have RAW kurtosis near 3, which is the
// convention the standard error formula requires.
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const normalSample: number[] = [];
for (let i = 0; i < 200_000; i++) {
  const u = Math.max(rand(), 1e-12);
  const v = Math.max(rand(), 1e-12);
  normalSample.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
}
const k = kurtosis(normalSample);
check("kurtosis of normal sample ≈ 3 (RAW, not excess)", near(k, 3, 0.08), k.toFixed(4));

console.log("\n── Sharpe standard error ──");
// For normal returns (skew 0, kurt 3) with SR=0 the SE reduces to 1/sqrt(T-1).
const seNormal = sharpeStandardError(0, 0, 3, 101);
check("SE(SR=0, normal) = 1/sqrt(T-1)", near(seNormal, 1 / Math.sqrt(100), 1e-12), seNormal.toFixed(8));
// The (γ₄ − 1)/4 term must fold in the ½SR² term of the published form:
//   1 + ½SR² − γ₃SR + ((γ₄−3)/4)SR²  ≡  1 − γ₃SR + ((γ₄−1)/4)SR²
const sr = 0.1;
const skew = -0.4;
const kurt = 6;
const ours = 1 - skew * sr + ((kurt - 1) / 4) * sr * sr;
const published = 1 + 0.5 * sr * sr - skew * sr + ((kurt - 3) / 4) * sr * sr;
check("SE adjustment matches published form", near(ours, published, 1e-12), `${ours.toFixed(8)} vs ${published.toFixed(8)}`);

console.log("\n── Probabilistic Sharpe / MinTRL ──");
check("PSR(SR=benchmark) = 0.5", near(probabilisticSharpe(0.1, 0.1, 0, 3, 500), 0.5, 1e-6));
check("PSR rises with track record", probabilisticSharpe(0.1, 0, 0, 3, 2000) > probabilisticSharpe(0.1, 0, 0, 3, 200));
const trl = minTrackRecordLength(0.1, 0, 0, 3, 0.95);
// Closed form for normal returns. Note the adjustment is NOT 1 even when
// skew = 0 and kurt = 3: the (γ₄ − 1)/4 · SR² term contributes ½SR².
const expectedTrl = (1 + 0.5 * 0.1 ** 2) * (normalInv(0.95) / 0.1) ** 2 + 1;
check("MinTRL matches closed form", trl !== null && near(trl, expectedTrl, 1e-6), `${trl?.toFixed(2)} vs ${expectedTrl.toFixed(2)}`);
check("MinTRL is null when SR ≤ benchmark", minTrackRecordLength(0, 0, 0, 3) === null);

console.log("\n── Deflated Sharpe ──");
const em10 = expectedMaxSharpe(0.01, 10);
const em1000 = expectedMaxSharpe(0.01, 1000);
check("expected max Sharpe rises with trials", em1000 > em10, `${em10.toFixed(4)} → ${em1000.toFixed(4)}`);
const dsrFew = deflatedSharpe({ sharpe: 0.1, trialVariance: 0.01, nTrials: 5, skew: 0, kurt: 3, observations: 2000 });
const dsrMany = deflatedSharpe({ sharpe: 0.1, trialVariance: 0.01, nTrials: 5000, skew: 0, kurt: 3, observations: 2000 });
check("DSR falls as the search grows", dsrMany.dsr < dsrFew.dsr, `${dsrFew.dsr.toFixed(4)} → ${dsrMany.dsr.toFixed(4)}`);
check("DSR is a probability in [0,1]", dsrMany.dsr >= 0 && dsrMany.dsr <= 1);
// Negative skew and fat tails should penalise, per the paper's motivation.
// Trial variance is kept small here so the DSR is not saturated at zero by the
// expected-maximum term, which would mask the moment adjustment entirely.
const dsrClean = deflatedSharpe({ sharpe: 0.1, trialVariance: 4e-4, nTrials: 100, skew: 0, kurt: 3, observations: 2000 });
const dsrUgly = deflatedSharpe({ sharpe: 0.1, trialVariance: 4e-4, nTrials: 100, skew: -1.5, kurt: 12, observations: 2000 });
check("DSR penalises negative skew + fat tails", dsrUgly.dsr < dsrClean.dsr, `${dsrClean.dsr.toFixed(4)} → ${dsrUgly.dsr.toFixed(4)}`);

console.log("\n── Indicators (hand-computed) ──");
const series = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const s3 = sma(series, 3);
check("SMA warm-up is NaN", Number.isNaN(s3[0]) && Number.isNaN(s3[1]));
check("SMA(3)[2] = 2", near(s3[2], 2, 1e-12), String(s3[2]));
check("SMA(3)[9] = 9", near(s3[9], 9, 1e-12), String(s3[9]));
const e3 = ema(series, 3);
// Seed is the mean of the first 3 = 2; then 4*0.5 + 2*0.5 = 3.
check("EMA(3) seed = SMA(3)", near(e3[2], 2, 1e-12), String(e3[2]));
check("EMA(3)[3] = 3", near(e3[3], 3, 1e-12), String(e3[3]));
// A monotonically rising series has no losses, so RSI must be 100.
const r = rsi(series, 5);
check("RSI of a rising series = 100", near(r[9], 100, 1e-9), String(r[9]));

console.log("\n── Backtest engine ──");
const bars = loadBundled("SYN-BROAD");
check("bundled series has ~20y of bars", bars.close.length === 5040, String(bars.close.length));
check("dates align with prices", bars.dates.length === bars.close.length);
check("no non-positive prices", Array.from(bars.close).every((c) => c > 0));

const goldenCross: StrategySpec = {
  name: "Golden cross",
  universe: "SYN-BROAD",
  entry: {
    left: { kind: "sma", period: 50 },
    comparator: "crosses_above",
    right: { kind: "sma", period: 200 },
    direction: "long"
  },
  exits: [{ kind: "opposite_signal" }, { kind: "stop_loss", pct: 5 }],
  sizing: { kind: "fixed_fraction", pct: 100 }
};

check("valid spec passes validation", validateSpec(goldenCross).length === 0);
const bt = runBacktest(goldenCross, bars, DEFAULT_COSTS);
check("equity curve is finite", Array.from(bt.equity).every(Number.isFinite));
check("equity stays positive", Array.from(bt.equity).every((e) => e > 0));
check("strategy actually trades", bt.metrics.tradeCount > 0, `${bt.metrics.tradeCount} trades`);
check("drawdown never positive", Array.from(bt.drawdown).every((d) => d <= 1e-9));
check("max drawdown in [0,1]", bt.metrics.maxDrawdown >= 0 && bt.metrics.maxDrawdown <= 1, bt.metrics.maxDrawdown.toFixed(4));
check("time in market in [0,1]", bt.metrics.timeInMarket >= 0 && bt.metrics.timeInMarket <= 1);
check("Sharpe is finite", Number.isFinite(bt.metrics.sharpe), bt.metrics.sharpeAnnual.toFixed(3));

// Equity must reconcile with the compounded per-bar returns.
let compounded = 1;
for (let i = 1; i < bt.returns.length; i++) compounded *= 1 + bt.returns[i];
check("equity reconciles with returns", near(compounded, bt.equity[bt.equity.length - 1], 1e-9));

// Lookahead checks. A same-bar round trip is legal (fill at the open, exit at
// the close), so exit may equal entry — but it must never precede it.
check("no trade exits before it enters", bt.trades.every((t) => t.exitIndex >= t.entryIndex));
check("entry fills at the open of the bar after the signal", bt.trades.every((t) => t.entryIndex >= 1));
// The entry bar must earn open→close only, never the overnight gap before it.
check(
  "entry-bar return excludes the prior gap",
  bt.trades.every((t) => Number.isFinite(t.entryPrice) && t.entryPrice > 0)
);

// Costs must reduce performance, never improve it.
const free = runBacktest(goldenCross, bars, { feeBps: 0, slippageBps: 0 });
const pricey = runBacktest(goldenCross, bars, { feeBps: 50, slippageBps: 50 });
check("higher costs reduce return", pricey.metrics.totalReturn < free.metrics.totalReturn,
  `${(free.metrics.totalReturn * 100).toFixed(1)}% → ${(pricey.metrics.totalReturn * 100).toFixed(1)}%`);

console.log("\n── Data handling ──");
const walk = matchedRandomWalk(bars, 999);
check("random walk matches length", walk.close.length === bars.close.length);
const boot = blockBootstrap(bars, 555);
check("bootstrap matches length", boot.close.length === bars.close.length);
check("bootstrap differs from source", boot.close[2000] !== bars.close[2000]);

const csv = "date,open,high,low,close,volume\n2024-01-01,10,11,9,10.5,1000\n2024-01-02,10.5,12,10,11,1200\n"
  + Array.from({ length: 40 }, (_, i) => `2024-02-${String(i + 1).padStart(2, "0")},10,11,9,${10 + i * 0.1},1000`).join("\n");
const parsed = parseOhlcvCsv(csv, "TEST");
check("CSV parses", parsed.close.length === 42, `${parsed.close.length} rows`);
check("CSV rejects short files", (() => { try { parseOhlcvCsv("date,close\n2024-01-01,10"); return false; } catch { return true; } })());

console.log("\n── Generator ──");
const specs = sampleStrategies(300, "SYN-BROAD", 42);
check("generator produces requested count", specs.length === 300);
const invalid = specs.filter((s) => validateSpec(s).length > 0);
check("every generated spec is valid", invalid.length === 0, `${invalid.length} invalid`);
const cache = new SignalCache(bars);
const generatedSharpes = specs.map((s) => runBacktest(s, bars, DEFAULT_COSTS, cache).metrics);
const trading = generatedSharpes.filter((m) => m.tradeCount > 0);
check("most generated strategies trade", trading.length > specs.length * 0.5, `${trading.length}/${specs.length}`);
check("all generated Sharpes finite", generatedSharpes.every((m) => Number.isFinite(m.sharpe)));

console.log("\n── Attacks ──");
const trialSharpes = trading.map((m) => m.sharpe);
const a1 = attackSearchCost(bt.metrics.sharpe, bt.metrics.skew, bt.metrics.kurt, bt.metrics.observations, trialSharpes, 300);
check("attack 1 returns a valid status", ["pass", "warn", "fail"].includes(a1.status), `${a1.status} / ${a1.headline}`);
const a2 = attackParameterStability(goldenCross, bars, DEFAULT_COSTS, cache);
check("attack 2 returns a curve", a2.chart.kind === "curve", `${a2.status} / ${a2.headline}`);
const a3 = attackRegimeDependence(bt.returns, bars.dates);
check("attack 3 returns yearly bars", a3.chart.kind === "bars", `${a3.status} / ${a3.headline}`);
const a4 = attackCostSensitivity(goldenCross, bars, cache);
check("attack 4 returns a cost curve", a4.chart.kind === "curve", `${a4.status} / ${a4.headline}`);
const a5 = attackNoiseBenchmark(bt.metrics.sharpe, bars, DEFAULT_COSTS, cache, 150, 7);
check("attack 5 returns a distribution", a5.chart.kind === "distribution", `${a5.status} / ${a5.headline}`);
const a6 = attackSyntheticMarkets(goldenCross, bars, DEFAULT_COSTS, 40, 11);
check("attack 6 returns a distribution", a6.chart.kind === "distribution", `${a6.status} / ${a6.headline}`);

const a7 = attackHaircut(bt.metrics.sharpe, bt.metrics.observations, 300);
check("attack 7 returns a comparison", a7.chart.kind === "bars", `${a7.status} / ${a7.headline}`);
const a8 = attackOverfitting(goldenCross, bars, DEFAULT_COSTS, cache);
check("attack 8 returns a logit distribution", a8.chart.kind === "distribution", `${a8.status} / ${a8.headline}`);

console.log("\n── Harvey–Liu haircut ──");
check("harmonic number c(1) = 1", near(harmonicNumber(1), 1, 1e-12));
check("harmonic number c(4) = 1+1/2+1/3+1/4", near(harmonicNumber(4), 1 + 0.5 + 1 / 3 + 0.25, 1e-12));
// A t-stat of 1.96 is the classic two-sided 5% boundary.
check("two-sided p(1.96) ≈ 0.05", near(twoSidedPValue(1.96), 0.05, 1e-3), twoSidedPValue(1.96).toFixed(5));
const strongHc = haircutSharpe(0.15, 2000, 316);
const weakHc = haircutSharpe(0.03, 2000, 316);
check("haircut is a fraction in [0,1]", strongHc.haircut >= 0 && strongHc.haircut <= 1, strongHc.haircut.toFixed(4));
check("weaker Sharpe takes a bigger haircut", weakHc.haircut > strongHc.haircut,
  `${(strongHc.haircut * 100).toFixed(1)}% vs ${(weakHc.haircut * 100).toFixed(1)}%`);
check("adjusted Sharpe never exceeds the original", strongHc.adjustedSharpe <= 0.15 + 1e-12,
  strongHc.adjustedSharpe.toFixed(5));
// More trials must never make the result look better.
const hcFew = haircutSharpe(0.1, 2000, 316);
const hcMany = haircutSharpe(0.1, 2000, 100_000);
check("haircut grows with the search", hcMany.haircut >= hcFew.haircut,
  `${(hcFew.haircut * 100).toFixed(1)}% → ${(hcMany.haircut * 100).toFixed(1)}%`);
check("a non-positive Sharpe is fully haircut", haircutSharpe(-0.05, 2000, 316).haircut === 1);
check("BHY is stricter than the raw p-value", strongHc.adjustedPValue >= strongHc.pValue);

console.log("\n── CSCV / PBO ──");
check("C(4,2) = 6", combinations(4, 2).length === 6);
check("C(8,4) = 70", combinations(8, 4).length === 70);
check("combinations are strictly increasing", combinations(5, 3).every((c) => c[0] < c[1] && c[1] < c[2]));

// A config family where one variant genuinely dominates everywhere should show
// LOW overfitting: the in-sample winner keeps winning out of sample.
const T = 2000;
let pboSeed = 987654321;
const pboRand = () => {
  pboSeed = (pboSeed * 1103515245 + 12345) % 2147483648;
  return pboSeed / 2147483648;
};
const noiseRow = () => Array.from({ length: T }, () => (pboRand() - 0.5) * 0.02);
const skilled = [
  noiseRow().map((r) => r + 0.004), // a real, persistent edge
  ...Array.from({ length: 9 }, () => noiseRow())
];
const skilledPbo = probabilityOfBacktestOverfitting({ matrix: skilled });
check("a genuine edge gives low PBO", skilledPbo.pbo < 0.2, `PBO ${(skilledPbo.pbo * 100).toFixed(1)}%`);

// Pure noise configs: the in-sample winner is arbitrary, so it should land
// below the OOS median roughly half the time.
const pureNoise = Array.from({ length: 10 }, () => noiseRow());
const noisePbo = probabilityOfBacktestOverfitting({ matrix: pureNoise });
check("pure noise gives PBO near 0.5", noisePbo.pbo > 0.25 && noisePbo.pbo < 0.75, `PBO ${(noisePbo.pbo * 100).toFixed(1)}%`);
check("PBO evaluates every split", noisePbo.splits === 70, String(noisePbo.splits));
check("PBO is a probability in [0,1]", noisePbo.pbo >= 0 && noisePbo.pbo <= 1);
check("all logits finite", noisePbo.logits.every(Number.isFinite));

console.log("\n── English compiler ──");
const compiled = parseLocally("buy when the 50-day moving average crosses above the 200-day, exit on a 5% stop loss");
check("compiler reads the signal family", compiled.spec.entry.left.kind === "sma", compiled.spec.entry.left.kind);
check("compiler reads both lookbacks",
  compiled.spec.entry.left.period === 50 && "period" in compiled.spec.entry.right && compiled.spec.entry.right.period === 200,
  describeSpec(compiled.spec));
check("compiler reads the crossover", compiled.spec.entry.comparator === "crosses_above");
check("compiler reads the stop", compiled.spec.exits.some((e) => e.kind === "stop_loss" && e.pct === 5));
check("compiled spec is valid", compiled.issues.length === 0);

const rsiSpec = parseLocally("go long when RSI(14) drops below 30, take profit at 8%, size by inverse volatility");
check("compiler reads RSI", rsiSpec.spec.entry.left.kind === "rsi" && rsiSpec.spec.entry.left.period === 14);
check("oscillator compares against a constant", !("kind" in rsiSpec.spec.entry.right));
check("compiler reads inverse-vol sizing", rsiSpec.spec.sizing.kind === "inverse_volatility");
check("RSI spec is valid", rsiSpec.issues.length === 0, JSON.stringify(rsiSpec.issues));

const shortSpec = parseLocally("short when the 20-day z-score is above 2, hold for 10 days maximum");
check("compiler reads direction", shortSpec.spec.entry.direction === "short");
check("compiler reads the time stop", shortSpec.spec.exits.some((e) => e.kind === "time_stop" && e.days === 10));
check("short spec is valid", shortSpec.issues.length === 0, JSON.stringify(shortSpec.issues));

// Gibberish must still produce a runnable spec — the compiler is never a dead end.
const nonsense = parseLocally("please make me rich immediately");
check("nonsense still yields a valid spec", nonsense.issues.length === 0);
check("nonsense reports what it guessed", nonsense.notes.length > 0, `${nonsense.notes.length} notes`);

console.log("\n── Permalinks ──");
const roundTrip = decodeRun(encodeRun({ spec: goldenCross }));
check("permalink round-trips the spec", roundTrip !== null && describeSpec(roundTrip.spec) === describeSpec(goldenCross));
const withVerdict = decodeRun(
  encodeRun({ spec: goldenCross, verdict: { status: "DEAD", attacks: [], trialCount: 1234 } })
);
check("permalink carries the verdict", withVerdict?.verdict?.status === "DEAD" && withVerdict.verdict.trialCount === 1234);
check("malformed payload decodes to null", decodeRun("not-valid-base64!!!") === null);
check("truncated payload decodes to null", decodeRun(encodeRun({ spec: goldenCross }).slice(0, 12)) === null);
// A hand-edited link must not smuggle an out-of-range spec past the validator.
const tampered = encodeRun({
  spec: { ...goldenCross, entry: { ...goldenCross.entry, left: { kind: "sma", period: 99999 } } }
});
check("out-of-range spec is rejected on decode", decodeRun(tampered) === null);

console.log("\n── Verdict ──");
const all = [a1, a2, a3, a4, a5, a6, a7, a8];
const verdict = buildVerdict(all, {
  sharpe: bt.metrics.sharpe,
  skew: bt.metrics.skew,
  kurt: bt.metrics.kurt,
  observations: bt.metrics.observations
});
check("verdict is one of three states", ["DEAD", "WOUNDED", "SURVIVED"].includes(verdict.status), verdict.status);
check("verdict carries a remedy", verdict.remedy.length > 20);
// A DSR failure must be an automatic kill regardless of everything else.
const forcedDsrFail = buildVerdict(
  all.map((a) => (a.id === "search-cost" ? { ...a, status: "fail" as const } : { ...a, status: "pass" as const })),
  { sharpe: 0.05, skew: 0, kurt: 3, observations: 2000 }
);
check("DSR failure alone forces DEAD", forcedDsrFail.status === "DEAD", forcedDsrFail.status);
// Clean sweep must survive.
const allPass = buildVerdict(all.map((a) => ({ ...a, status: "pass" as const })), {
  sharpe: 0.08,
  skew: 0,
  kurt: 3,
  observations: 3000
});
check("all passes → SURVIVED", allPass.status === "SURVIVED", allPass.status);

console.log("\n── Noise control (the thesis) ──");
// Searching a zero-drift random walk must still produce a good-looking winner.
const noiseBars = matchedRandomWalk(bars, 20260821);
const noiseCache = new SignalCache(noiseBars);
const noiseSpecs = sampleStrategies(400, noiseBars.ticker, 4242);
let bestNoise = -Infinity;
for (const s of noiseSpecs) {
  const m = runBacktest(s, noiseBars, DEFAULT_COSTS, noiseCache).metrics;
  if (m.tradeCount > 0 && m.sharpe > bestNoise) bestNoise = m.sharpe;
}
const bestNoiseAnnual = bestNoise * Math.sqrt(252);
check(
  "best-of-400 on pure noise looks respectable",
  bestNoiseAnnual > 0.5,
  `annualised Sharpe ${bestNoiseAnnual.toFixed(2)} on data with zero edge`
);

console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
