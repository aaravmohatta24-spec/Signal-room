import { useEffect, useMemo, useState } from "react";
import { CircleAlert, Gauge, Play } from "lucide-react";

import Layout from "@/components/Layout";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { ActionButton } from "@/components/ui/action-button";
import { EquityCurve } from "@/components/adversary/charts";
import { runBacktest, type BacktestResult } from "@/lib/adversary/engine";
import {
  ASSET_CLASS_LABEL,
  INSTRUMENTS,
  instrumentByTicker,
  loadInstrument,
  type AssetClass
} from "@/lib/adversary/instruments";
import { readPermalink } from "@/lib/adversary/permalink";
import { SignalCache, type Bars } from "@/lib/adversary/signals";
import { describeSpec, type ExitRule, type StrategySpec } from "@/lib/adversary/spec";
import { cn } from "@/lib/utils";

const ORDER: AssetClass[] = ["index", "stock", "forex", "commodity"];
const TRADING_DAYS = 252;

const DEFAULT_SPEC: StrategySpec = {
  name: "Golden cross",
  universe: "SPY",
  entry: {
    left: { kind: "sma", period: 50 },
    comparator: "crosses_above",
    right: { kind: "sma", period: 200 },
    direction: "long"
  },
  exits: [{ kind: "opposite_signal" }],
  sizing: { kind: "fixed_fraction", pct: 100 }
};

const pct = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;
const money = (v: number) =>
  v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** A labelled numeric input. Kept local — nothing else in the app needs it. */
function Field({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-[.14em] text-zinc-500">{label}</span>
      <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:border-signal/50">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
          className="w-full bg-transparent text-sm text-foreground outline-none"
        />
        {suffix && <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-[11px] leading-4 text-zinc-600">{hint}</span>}
    </label>
  );
}

/** Toggleable exit rule with its own percentage. */
function ExitToggle({
  label,
  enabled,
  onToggle,
  value,
  onValue,
  suffix,
  min,
  max
}: {
  label: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  value: number;
  onValue: (v: number) => void;
  suffix: string;
  min: number;
  max: number;
}) {
  return (
    <div className={cn("rounded-lg border p-3 transition-colors", enabled ? "border-signal/40 bg-signal/5" : "border-border")}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-4 w-4 accent-[rgb(52,211,153)]"
        />
        <span className="text-xs text-foreground">{label}</span>
      </label>
      {enabled && (
        <span className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
          <input
            type="number"
            value={Number.isFinite(value) ? value : ""}
            min={min}
            max={max}
            step={0.5}
            onChange={(e) => onValue(e.target.value === "" ? NaN : Number(e.target.value))}
            className="w-full bg-transparent text-sm text-foreground outline-none"
          />
          <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>
        </span>
      )}
    </div>
  );
}

export default function BackTesterPage() {
  const shared = useMemo(() => readPermalink(), []);
  const [spec, setSpec] = useState<StrategySpec>(shared?.spec ?? DEFAULT_SPEC);
  const [imported] = useState(Boolean(shared?.spec));

  const [ticker, setTicker] = useState(shared?.spec?.universe ?? "SPY");
  const [years, setYears] = useState(10);
  const [capital, setCapital] = useState(100_000);
  const [feeBps, setFeeBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [sizingPct, setSizingPct] = useState(
    spec.sizing.kind === "fixed_fraction" ? spec.sizing.pct : 100
  );

  const [stopOn, setStopOn] = useState(spec.exits.some((e) => e.kind === "stop_loss"));
  const [stopPct, setStopPct] = useState(
    (spec.exits.find((e) => e.kind === "stop_loss") as { pct: number } | undefined)?.pct ?? 5
  );
  const [targetOn, setTargetOn] = useState(spec.exits.some((e) => e.kind === "take_profit"));
  const [targetPct, setTargetPct] = useState(
    (spec.exits.find((e) => e.kind === "take_profit") as { pct: number } | undefined)?.pct ?? 10
  );
  const [trailOn, setTrailOn] = useState(spec.exits.some((e) => e.kind === "trailing_stop"));
  const [trailPct, setTrailPct] = useState(
    (spec.exits.find((e) => e.kind === "trailing_stop") as { pct: number } | undefined)?.pct ?? 8
  );
  const [timeOn, setTimeOn] = useState(spec.exits.some((e) => e.kind === "time_stop"));
  const [timeDays, setTimeDays] = useState(
    (spec.exits.find((e) => e.kind === "time_stop") as { days: number } | undefined)?.days ?? 20
  );

  const [result, setResult] = useState<{ bars: Bars; result: BacktestResult; spec: StrategySpec } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A spec arriving by permalink should replace whatever is on screen.
  useEffect(() => {
    if (shared?.spec) setSpec(shared.spec);
  }, [shared]);

  const instrument = instrumentByTicker(ticker);

  const grouped = useMemo(() => {
    const map = new Map<AssetClass, typeof INSTRUMENTS>();
    for (const i of INSTRUMENTS.filter((x) => x.isReal)) {
      const list = map.get(i.assetClass) ?? [];
      list.push(i);
      map.set(i.assetClass, list);
    }
    return ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, []);

  const run = async () => {
    setError(null);
    if (busy) return;
    if (!instrument) return setError("Pick an instrument first.");
    if (!Number.isFinite(capital) || capital <= 0) return setError("Starting capital must be above zero.");
    if (!Number.isFinite(years) || years <= 0) return setError("Test window must be at least one year.");

    // Assemble the exits the form describes. Falling back to opposite_signal
    // matters: a spec with no exits at all would never close a position.
    const exits: ExitRule[] = [];
    if (stopOn && Number.isFinite(stopPct)) exits.push({ kind: "stop_loss", pct: stopPct });
    if (targetOn && Number.isFinite(targetPct)) exits.push({ kind: "take_profit", pct: targetPct });
    if (trailOn && Number.isFinite(trailPct)) exits.push({ kind: "trailing_stop", pct: trailPct });
    if (timeOn && Number.isFinite(timeDays)) exits.push({ kind: "time_stop", days: Math.round(timeDays) });
    if (exits.length === 0) exits.push({ kind: "opposite_signal" });

    const effective: StrategySpec = {
      ...spec,
      universe: ticker,
      exits,
      sizing: { kind: "fixed_fraction", pct: Number.isFinite(sizingPct) ? sizingPct : 100 }
    };

    setBusy(true);
    try {
      const full = await loadInstrument(ticker);
      const window = Math.min(full.close.length, Math.round(years * TRADING_DAYS));
      const start = full.close.length - window;
      const bars: Bars = {
        ...full,
        dates: full.dates.slice(start),
        open: full.open.slice(start),
        high: full.high.slice(start),
        low: full.low.slice(start),
        close: full.close.slice(start),
        volume: full.volume.slice(start)
      };
      const res = runBacktest(effective, bars, { feeBps, slippageBps }, new SignalCache(bars));
      setResult({ bars, result: res, spec: effective });
    } catch {
      setError("That configuration could not be tested against this instrument.");
    } finally {
      setBusy(false);
    }
  };

  /** Calendar-year P&L, derived from the equity series. */
  const yearly = useMemo(() => {
    if (!result) return [];
    const { bars, result: res } = result;
    const rows: { year: string; ret: number; end: number }[] = [];
    let openIndex = 0;
    for (let i = 1; i < bars.dates.length; i++) {
      const year = bars.dates[i].slice(0, 4);
      const prevYear = bars.dates[i - 1].slice(0, 4);
      if (year !== prevYear || i === bars.dates.length - 1) {
        const from = res.equity[openIndex];
        const to = res.equity[i];
        if (from > 0) rows.push({ year: prevYear, ret: to / from - 1, end: capital * to });
        openIndex = i;
      }
    }
    return rows;
  }, [result, capital]);

  const m = result?.result.metrics;
  const stance = result?.result.stance;
  const finalEquity = result ? capital * result.result.equity[result.result.equity.length - 1] : capital;

  return (
    <Layout showBackLink>
      <section className="py-9">
        <ScrollReveal variant="rise">
          <div className="eyebrow">
            <Gauge size={15} />
            Back Tester
          </div>
          <h1 className="mt-4 max-w-3xl font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground">
            Set your terms.
            <br />
            <span className="font-normal text-foreground/55">Then read what the rule did.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            {imported
              ? "Strategy imported from the Adversary. Adjust the terms below and run it."
              : "No strategy imported — the default golden cross is loaded. Send one here from the Adversary to test it instead."}
          </p>
        </ScrollReveal>

        <div className="mt-6 rounded-[16px] border border-border bg-card/60 p-4">
          <div className="font-mono text-[9px] uppercase tracking-[.14em] text-zinc-500">Strategy under test</div>
          <div className="mt-1.5 text-sm font-medium text-foreground">{spec.name}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{describeSpec(spec)}</p>
        </div>

        {/* ── Inputs ──────────────────────────────────────────────── */}
        <ScrollReveal variant="drift" className="mt-6">
          <div className="rounded-[20px] border border-border bg-card p-5">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Instrument</div>
            <div className="mt-3 space-y-3">
              {grouped.map(([assetClass, list]) => (
                <div key={assetClass}>
                  <div className="font-mono text-[9px] uppercase tracking-[.14em] text-zinc-600">
                    {ASSET_CLASS_LABEL[assetClass]}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {list.map((i) => (
                      <button
                        key={i.ticker}
                        onClick={() => setTicker(i.ticker)}
                        title={i.note}
                        className={cn(
                          "min-h-[40px] rounded-full border px-3.5 py-1.5 text-xs transition-colors",
                          ticker === i.ticker
                            ? "border-signal/60 bg-signal/10 text-foreground"
                            : "border-border text-muted-foreground hover:border-zinc-600"
                        )}
                      >
                        {i.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Test window" value={years} onChange={setYears} min={1} max={40} suffix="years" />
              <Field label="Starting capital" value={capital} onChange={setCapital} min={1} step={1000} suffix="$" />
              <Field
                label="Position size"
                hint="Share of capital committed per trade."
                value={sizingPct}
                onChange={setSizingPct}
                min={1}
                max={100}
                suffix="%"
              />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Brokerage" value={feeBps} onChange={setFeeBps} min={0} max={200} suffix="bps" />
                <Field label="Slippage" value={slippageBps} onChange={setSlippageBps} min={0} max={200} suffix="bps" />
              </div>
            </div>

            <div className="mt-5 border-t border-border pt-5">
              <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                Exits — leave all off to exit on the opposite signal
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ExitToggle
                  label="Stop loss"
                  enabled={stopOn}
                  onToggle={setStopOn}
                  value={stopPct}
                  onValue={setStopPct}
                  suffix="%"
                  min={0.5}
                  max={25}
                />
                <ExitToggle
                  label="Target"
                  enabled={targetOn}
                  onToggle={setTargetOn}
                  value={targetPct}
                  onValue={setTargetPct}
                  suffix="%"
                  min={0.5}
                  max={25}
                />
                <ExitToggle
                  label="Trailing stop"
                  enabled={trailOn}
                  onToggle={setTrailOn}
                  value={trailPct}
                  onValue={setTrailPct}
                  suffix="%"
                  min={0.5}
                  max={25}
                />
                <ExitToggle
                  label="Max holding period"
                  enabled={timeOn}
                  onToggle={setTimeOn}
                  value={timeDays}
                  onValue={setTimeDays}
                  suffix="days"
                  min={2}
                  max={120}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
              <p className="text-xs leading-5 text-muted-foreground">
                {instrument
                  ? `${instrument.label} · ${instrument.bars.toLocaleString()} daily bars available`
                  : "Select an instrument."}
              </p>
              <ActionButton onClick={run} disabled={!instrument || busy}>
                <Play size={15} />
                {busy ? "Running…" : "Run backtest"}
              </ActionButton>
            </div>

            {error && (
              <p className="mt-4 flex gap-2 text-sm text-red-300">
                <CircleAlert size={15} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        </ScrollReveal>

        {/* ── Results ─────────────────────────────────────────────── */}
        {result && m && (
          <ScrollReveal variant="settle" className="mt-8 space-y-4">
            <div className="grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Ending capital", money(finalEquity)],
                ["Net P&L", `${finalEquity - capital >= 0 ? "+" : "−"}${money(Math.abs(finalEquity - capital))}`],
                ["Total return", pct(m.totalReturn, 0)],
                ["CAGR", pct(m.cagr)]
              ].map(([label, value]) => (
                <div key={label} className="bg-card px-4 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</div>
                  <div className="mt-1.5 font-display text-2xl font-semibold tracking-[-.018em] text-foreground">
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-[20px] border border-border bg-card p-5">
              <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                Equity curve · {years} years · {money(capital)} start
              </div>
              <div className="mt-3">
                <EquityCurve series={Array.from(result.result.equity)} stroke="rgb(52 211 153)" />
              </div>
            </div>

            <div className="grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Max drawdown", pct(-m.maxDrawdown, 0)],
                ["Sharpe", m.sharpeAnnual.toFixed(2)],
                ["Win rate", `${(m.winRate * 100).toFixed(0)}%`],
                ["Trades", String(m.tradeCount)],
                ["Avg win", pct(m.avgWin)],
                ["Avg loss", pct(m.avgLoss)],
                ["Best trade", pct(m.maxWin)],
                ["Worst trade", pct(m.maxLoss)],
                ["Expectancy", pct(m.expectancy, 2)],
                ["Reward / risk", m.rewardRiskRatio.toFixed(2)],
                ["Longest win streak", String(m.maxWinStreak)],
                ["Time in market", `${(m.timeInMarket * 100).toFixed(0)}%`]
              ].map(([label, value]) => (
                <div key={label} className="bg-card px-4 py-3">
                  <div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">{label}</div>
                  <div className="mt-1 text-sm text-foreground">{value}</div>
                </div>
              ))}
            </div>

            {stance && (
              <div className="rounded-[20px] border border-border bg-card p-5">
                <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                  Position as of {stance.asOf}
                </div>
                <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2">
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Stance</div>
                    <div className="mt-1 font-display text-2xl font-semibold text-foreground">{stance.position}</div>
                  </div>
                  {stance.since && (
                    <div>
                      <div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Since</div>
                      <div className="mt-1 text-sm text-foreground">{stance.since}</div>
                    </div>
                  )}
                  {stance.unrealised !== null && (
                    <div>
                      <div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Open P&L</div>
                      <div className="mt-1 text-sm text-foreground">{pct(stance.unrealised)}</div>
                    </div>
                  )}
                </div>
                <p className="mt-4 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs leading-5 text-amber-200/90">
                  <CircleAlert size={14} className="mt-0.5 shrink-0" />
                  This is the rule's stance on historical data ending at the last available bar. It is a readout of what
                  the rule says, not a forecast of what the market will do.
                </p>
              </div>
            )}

            {yearly.length > 0 && (
              <div className="overflow-hidden rounded-[20px] border border-border bg-card">
                <div className="px-5 pt-5 font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                  Year by year
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="px-5 py-2 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Year</th>
                        <th className="px-5 py-2 text-right font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Return</th>
                        <th className="px-5 py-2 text-right font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Equity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearly.map((row) => (
                        <tr key={row.year} className="border-b border-border/60 last:border-b-0">
                          <td className="px-5 py-2 text-foreground">{row.year}</td>
                          <td className={cn("px-5 py-2 text-right", row.ret >= 0 ? "text-emerald-300" : "text-red-300")}>
                            {pct(row.ret)}
                          </td>
                          <td className="px-5 py-2 text-right text-muted-foreground">{money(row.end)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {result.result.trades.length > 0 && (
              <div className="overflow-hidden rounded-[20px] border border-border bg-card">
                <div className="flex items-baseline justify-between px-5 pt-5">
                  <span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                    Trade log
                  </span>
                  <span className="font-mono text-[10px] text-zinc-600">
                    {result.result.trades.length} trades · showing first 50
                  </span>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        {["#", "Entry", "Exit", "Side", "Entry px", "Exit px", "Bars", "Return", "Closed by"].map((h) => (
                          <th
                            key={h}
                            className={cn(
                              "px-4 py-2 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground",
                              ["Entry px", "Exit px", "Bars", "Return"].includes(h) && "text-right"
                            )}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.result.trades.slice(0, 50).map((t, i) => (
                        <tr key={`${t.entryIndex}-${i}`} className="border-b border-border/60 last:border-b-0">
                          <td className="px-4 py-2 font-mono text-[11px] text-zinc-600">{i + 1}</td>
                          <td className="px-4 py-2 text-muted-foreground">{result.bars.dates[t.entryIndex]}</td>
                          <td className="px-4 py-2 text-muted-foreground">{result.bars.dates[t.exitIndex]}</td>
                          <td className="px-4 py-2 text-foreground">{t.direction === 1 ? "Long" : "Short"}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{t.entryPrice.toFixed(2)}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{t.exitPrice.toFixed(2)}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{t.bars}</td>
                          <td
                            className={cn(
                              "px-4 py-2 text-right",
                              t.returnPct >= 0 ? "text-emerald-300" : "text-red-300"
                            )}
                          >
                            {pct(t.returnPct)}
                          </td>
                          <td className="px-4 py-2 text-xs text-zinc-500">{t.reason.replace(/_/g, " ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </ScrollReveal>
        )}
      </section>
    </Layout>
  );
}
