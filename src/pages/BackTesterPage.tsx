import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CircleAlert, Gauge, Medal, Play } from "lucide-react";

import Layout from "@/components/Layout";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { ActionButton } from "@/components/ui/action-button";
import { EquityPanel } from "@/components/adversary/equity-panel";
import { DrawdownPanel, MonthlyGrid, TradeHistogram, type MonthCell } from "@/components/adversary/result-panels";
import { runBacktest, type BacktestResult } from "@/lib/adversary/engine";
import {
  ASSET_CLASS_LABEL,
  INSTRUMENTS,
  instrumentByTicker,
  loadInstrument,
  type AssetClass
} from "@/lib/adversary/instruments";
import { readPermalink } from "@/lib/adversary/permalink";
import { readWinner, type RaceWinner } from "@/lib/adversary/handoff";
import { SignalCache, type Bars } from "@/lib/adversary/signals";
import { describeSpec, type ExitRule, type SizingRule, type StrategySpec } from "@/lib/adversary/spec";
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

/**
 * A deep link to the symbol on TradingView.
 *
 * A link rather than an embedded widget, and deliberately not an order ticket.
 * TradingView does not expose order routing to third-party pages — placing a
 * trade requires their own signed-in interface with a broker attached — and
 * this app is paper-only by design, so the honest handoff is to send the user
 * to the chart and let them take it from there in their own account.
 *
 * Exchange prefixes are left off: TradingView resolves a bare symbol to its
 * primary listing, and guessing the wrong exchange gives a broken chart.
 */
const tradingViewUrl = (ticker: string) =>
  `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(ticker)}`;

/** One line of the order plan. */
function PlanRow({
  label,
  children,
  tone
}: {
  label: string;
  children: React.ReactNode;
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <div className="grid gap-1 px-5 py-3 sm:grid-cols-[128px_1fr] sm:gap-4">
      <dt
        className={cn(
          "font-mono text-[9px] uppercase leading-5 tracking-[.12em]",
          tone === "good" ? "text-emerald-400/80" : tone === "bad" ? "text-red-400/80" : tone === "warn" ? "text-amber-500/80" : "text-slate-500"
        )}
      >
        {label}
      </dt>
      <dd className="text-[13px] leading-6 text-muted-foreground">{children}</dd>
    </div>
  );
}

/** A titled grid of read-only statistics. */
function StatBlock({ title, stats }: { title: string; stats: [string, string][] }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-card">
      <div className="border-b border-border px-5 py-2.5 font-mono text-[10px] uppercase tracking-[.16em] text-slate-500">
        {title}
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label} className="bg-card px-4 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">{label}</div>
            <div className="mt-1 text-sm text-foreground">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
      <span className="font-mono text-[9px] uppercase tracking-[.14em] text-slate-500">{label}</span>
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
      {hint && <span className="mt-1 block text-[11px] leading-4 text-slate-600">{hint}</span>}
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
  // A race winner takes precedence over a permalink: it is the more specific
  // intent, and it carries the standings the banner needs to explain itself.
  const champion = useMemo<RaceWinner | null>(
    () => (typeof window !== "undefined" && window.location.hash.includes("from=race") ? readWinner() : null),
    []
  );
  const preset = champion?.spec ?? shared?.spec ?? null;

  const [spec, setSpec] = useState<StrategySpec>(preset ?? DEFAULT_SPEC);
  const [imported] = useState(Boolean(preset));

  const [ticker, setTicker] = useState(champion?.ticker ?? shared?.spec?.universe ?? "SPY");
  const [years, setYears] = useState(10);
  const [capital, setCapital] = useState(100_000);
  const [feeBps, setFeeBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);

  // Direction is part of the spec, not a cost or an exit, so changing it here
  // rewrites the rule rather than the test around it.
  const [direction, setDirection] = useState<"long" | "short">((preset ?? spec).entry.direction);

  const [sizingKind, setSizingKind] = useState<SizingRule["kind"]>((preset ?? spec).sizing.kind);
  const [sizingPct, setSizingPct] = useState(() => {
    const sizing = (preset ?? spec).sizing;
    return sizing.kind === "fixed_fraction" ? sizing.pct : 100;
  });
  const [volLookback, setVolLookback] = useState(() => {
    const sizing = (preset ?? spec).sizing;
    return sizing.kind === "inverse_volatility" ? sizing.lookback : 60;
  });

  const [stopOn, setStopOn] = useState((preset ?? spec).exits.some((e) => e.kind === "stop_loss"));
  const [stopPct, setStopPct] = useState(
    ((preset ?? spec).exits.find((e) => e.kind === "stop_loss") as { pct: number } | undefined)?.pct ?? 5
  );
  const [targetOn, setTargetOn] = useState((preset ?? spec).exits.some((e) => e.kind === "take_profit"));
  const [targetPct, setTargetPct] = useState(
    ((preset ?? spec).exits.find((e) => e.kind === "take_profit") as { pct: number } | undefined)?.pct ?? 10
  );
  const [trailOn, setTrailOn] = useState((preset ?? spec).exits.some((e) => e.kind === "trailing_stop"));
  const [trailPct, setTrailPct] = useState(
    ((preset ?? spec).exits.find((e) => e.kind === "trailing_stop") as { pct: number } | undefined)?.pct ?? 8
  );
  const [timeOn, setTimeOn] = useState((preset ?? spec).exits.some((e) => e.kind === "time_stop"));
  const [timeDays, setTimeDays] = useState(
    ((preset ?? spec).exits.find((e) => e.kind === "time_stop") as { days: number } | undefined)?.days ?? 20
  );

  const [result, setResult] = useState<{ bars: Bars; result: BacktestResult; spec: StrategySpec } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A spec arriving by handoff should replace whatever is on screen.
  useEffect(() => {
    if (preset) setSpec(preset);
  }, [preset]);

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

    const sizing: SizingRule =
      sizingKind === "inverse_volatility"
        ? { kind: "inverse_volatility", lookback: Math.max(5, Math.round(volLookback) || 60) }
        : sizingKind === "equal_weight"
          ? { kind: "equal_weight" }
          : { kind: "fixed_fraction", pct: Number.isFinite(sizingPct) ? sizingPct : 100 };

    const effective: StrategySpec = {
      ...spec,
      universe: ticker,
      entry: { ...spec.entry, direction },
      exits,
      sizing
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

  /** Calendar-month returns, compounded from the daily equity series. */
  const monthly = useMemo<MonthCell[]>(() => {
    if (!result) return [];
    const { bars, result: res } = result;
    const cells: MonthCell[] = [];
    let openIndex = 0;
    for (let i = 1; i < bars.dates.length; i++) {
      const thisMonth = bars.dates[i].slice(0, 7);
      const prevMonth = bars.dates[i - 1].slice(0, 7);
      const last = i === bars.dates.length - 1;
      if (thisMonth !== prevMonth || last) {
        const from = res.equity[openIndex];
        const to = res.equity[last ? i : i - 1];
        if (from > 0) {
          const [y, mo] = prevMonth.split("-");
          cells.push({ year: y, month: Number(mo) - 1, ret: to / from - 1 });
        }
        openIndex = i;
      }
    }
    return cells;
  }, [result]);

  /** Statistics the engine does not compute, derived from the trade list. */
  const tradeStats = useMemo(() => {
    if (!result) return null;
    const trades = result.result.trades;
    if (!trades.length) return null;
    let grossWin = 0;
    let grossLoss = 0;
    let bars = 0;
    for (const t of trades) {
      if (t.returnPct >= 0) grossWin += t.returnPct;
      else grossLoss += Math.abs(t.returnPct);
      bars += t.bars;
    }
    return {
      // Gross profit over gross loss. Above 1 means the winners outweigh the
      // losers in total, which is a different claim from a high win rate.
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : Infinity,
      avgBars: bars / trades.length,
      returns: trades.map((t) => t.returnPct)
    };
  }, [result]);

  /** Last close and the exposure the test was carrying at that bar. */
  const lastClose = result ? result.bars.close[result.bars.close.length - 1] : null;
  const exposureNow = result ? result.result.exposure[result.result.exposure.length - 1] ?? 0 : 0;

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
            {champion
              ? `Race winner loaded. Its entry, exits and sizing are preset below — change anything you like before running.`
              : imported
                ? "Strategy imported from the Adversary. Adjust the terms below and run it."
                : "No strategy imported — the default golden cross is loaded. Send one here from the Adversary to test it instead."}
          </p>
        </ScrollReveal>

        {champion && (
          <div className="mt-6 rounded-[16px] border border-emerald-500/40 bg-emerald-950/15 p-4">
            <div className="flex items-center gap-2">
              <Medal size={14} className="text-emerald-300" />
              <span className="font-mono text-[10px] uppercase tracking-[.14em] text-emerald-300">
                Won a field of {champion.fieldSize} on {champion.instrumentLabel}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Survived {champion.survived} of {champion.ordealCount} ordeals. The race measured it over the full
              history with default costs; what you set below re-tests it on your own terms, so expect the numbers to
              move.
            </p>
          </div>
        )}

        <div className="mt-6 rounded-[16px] border border-border bg-card/60 p-4">
          <div className="font-mono text-[9px] uppercase tracking-[.14em] text-slate-500">Strategy under test</div>
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
                  <div className="font-mono text-[9px] uppercase tracking-[.14em] text-slate-600">
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
                            : "border-border text-muted-foreground hover:border-slate-600"
                        )}
                      >
                        {i.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Test window" value={years} onChange={setYears} min={1} max={40} suffix="years" />
              <Field label="Starting capital" value={capital} onChange={setCapital} min={1} step={1000} suffix="$" />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Brokerage" value={feeBps} onChange={setFeeBps} min={0} max={200} suffix="bps" />
                <Field label="Slippage" value={slippageBps} onChange={setSlippageBps} min={0} max={200} suffix="bps" />
              </div>
            </div>

            <div className="mt-5 grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[.14em] text-slate-500">Direction</div>
                <div className="mt-2 flex gap-1.5">
                  {(["long", "short"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDirection(d)}
                      className={cn(
                        "min-h-[36px] flex-1 rounded-[3px] border px-3 font-mono text-[10px] uppercase tracking-[.11em] transition-colors",
                        direction === d
                          ? "border-signal/70 bg-signal/15 text-foreground"
                          : "border-border text-muted-foreground hover:border-slate-600"
                      )}
                    >
                      {d === "long" ? "Long only" : "Short only"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="font-mono text-[9px] uppercase tracking-[.14em] text-slate-500">Position sizing</div>
                <div className="mt-2 flex gap-1.5">
                  {([
                    ["fixed_fraction", "Fixed %"],
                    ["inverse_volatility", "Vol-scaled"],
                    ["equal_weight", "Full"]
                  ] as const).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setSizingKind(k)}
                      className={cn(
                        "min-h-[36px] flex-1 rounded-[3px] border px-2 font-mono text-[10px] uppercase tracking-[.11em] transition-colors",
                        sizingKind === k
                          ? "border-signal/70 bg-signal/15 text-foreground"
                          : "border-border text-muted-foreground hover:border-slate-600"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {sizingKind === "fixed_fraction" && (
                  <div className="mt-2">
                    <Field label="Share of capital per trade" value={sizingPct} onChange={setSizingPct} min={1} max={100} suffix="%" />
                  </div>
                )}
                {sizingKind === "inverse_volatility" && (
                  <div className="mt-2">
                    <Field
                      label="Volatility lookback"
                      hint="Size falls as realised volatility over this window rises."
                      value={volLookback}
                      onChange={setVolLookback}
                      min={10}
                      max={120}
                      suffix="days"
                    />
                  </div>
                )}
                {sizingKind === "equal_weight" && (
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">
                    Full capital committed on every signal. No scaling.
                  </p>
                )}
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
                <EquityPanel
                  equity={Array.from(result.result.equity)}
                  dates={result.bars.dates}
                  capital={capital}
                />
              </div>
            </div>

<StatBlock
              title="Risk"
              stats={[
                ["Max drawdown", pct(-m.maxDrawdown, 0)],
                ["Longest drawdown", `${m.maxDrawdownDuration} days`],
                ["Sharpe", m.sharpeAnnual.toFixed(2)],
                ["Sortino", m.sortino.toFixed(2)],
                ["Calmar", m.calmar.toFixed(2)],
                ["Time in market", `${(m.timeInMarket * 100).toFixed(0)}%`]
              ]}
            />

            <StatBlock
              title="Trades"
              stats={[
                ["Trades", String(m.tradeCount)],
                ["Win rate", `${(m.winRate * 100).toFixed(0)}%`],
                ["Profit factor", tradeStats ? (Number.isFinite(tradeStats.profitFactor) ? tradeStats.profitFactor.toFixed(2) : "∞") : "—"],
                ["Avg hold", tradeStats ? `${tradeStats.avgBars.toFixed(0)} days` : "—"],
                ["Avg win", pct(m.avgWin)],
                ["Avg loss", pct(m.avgLoss)],
                ["Best trade", pct(m.maxWin)],
                ["Worst trade", pct(m.maxLoss)],
                ["Expectancy", pct(m.expectancy, 2)],
                ["Reward / risk", m.rewardRiskRatio.toFixed(2)],
                ["Win streak", String(m.maxWinStreak)],
                ["Loss streak", String(m.maxLossStreak)]
              ]}
            />

            {/* Underwater curve: the shape of the bad stretches. */}
            <div className="rounded-[20px] border border-border bg-card p-5">
              <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                Drawdown from running peak
              </div>
              <div className="mt-3">
                <DrawdownPanel drawdown={Array.from(result.result.drawdown)} dates={result.bars.dates} />
              </div>
            </div>

            {monthly.length > 0 && (
              <div className="rounded-[20px] border border-border bg-card p-5">
                <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                  Month by month
                </div>
                <div className="mt-4">
                  <MonthlyGrid cells={monthly} />
                </div>
              </div>
            )}

            {tradeStats && (
              <div className="rounded-[20px] border border-border bg-card p-5">
                <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                  Trade distribution
                </div>
                <div className="mt-4">
                  <TradeHistogram returns={tradeStats.returns} />
                </div>
              </div>
            )}

            {stance && (
              <div className="overflow-hidden rounded-[20px] border border-signal/40 bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
                  <span className="font-mono text-[10px] uppercase tracking-[.16em] text-signal-soft">
                    The plan, as of {stance.asOf}
                  </span>
                  <a
                    href={tradingViewUrl(ticker)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-[3px] border border-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[.11em] text-muted-foreground transition-colors hover:border-signal/50 hover:text-foreground"
                  >
                    Open in TradingView
                    <ArrowUpRight size={12} />
                  </a>
                </div>

                <dl className="divide-y divide-border">
                  <PlanRow label="Position now">
                    <span className="text-foreground">
                      {stance.position === "flat"
                        ? "Flat — no position open."
                        : `${stance.position === "long" ? "Long" : "Short"} since ${stance.since ?? "—"}, ${stance.barsHeld} days held.`}
                    </span>
                    {stance.unrealised !== null && (
                      <span className={cn("ml-2", stance.unrealised >= 0 ? "text-emerald-300" : "text-red-300")}>
                        {pct(stance.unrealised)} open
                      </span>
                    )}
                  </PlanRow>

                  <PlanRow label="Entry trigger">
                    {stance.position === "flat"
                      ? `Enter when the rule fires: ${describeSpec(result.spec).split(". Exit")[0]}.`
                      : "Already in. Do not add — the test sizes one position at a time."}
                  </PlanRow>

                  <PlanRow label="Order type">
                    Read the signal on the daily close; place a market order for the next open. The test assumes exactly
                    that fill, so entering intraday is a different strategy from the one measured here.
                  </PlanRow>

                  <PlanRow label="Size">
                    {sizingKind === "fixed_fraction"
                      ? `${sizingPct}% of ${money(capital)} = ${money((capital * sizingPct) / 100)}${lastClose ? ` ≈ ${Math.floor((capital * sizingPct) / 100 / lastClose).toLocaleString()} units at ${lastClose.toFixed(2)}` : ""}`
                      : sizingKind === "inverse_volatility"
                        ? `Scaled by ${volLookback}-day volatility, so the figure moves with the market. At the last close the test held ${(exposureNow * 100).toFixed(0)}% of capital, about ${money(capital * exposureNow)}.`
                        : `Full capital: ${money(capital)}${lastClose ? ` ≈ ${Math.floor(capital / lastClose).toLocaleString()} units at ${lastClose.toFixed(2)}` : ""}`}
                  </PlanRow>

                  {(stopOn || trailOn) && lastClose != null && (
                    <PlanRow label="Stop" tone="bad">
                      {stopOn && `Hard stop ${stopPct}% against the entry${direction === "long" ? ` — ${(lastClose * (1 - stopPct / 100)).toFixed(2)} from the last close` : ` — ${(lastClose * (1 + stopPct / 100)).toFixed(2)} from the last close`}.`}
                      {stopOn && trailOn && " "}
                      {trailOn && `Trailing stop ${trailPct}% behind the best price reached.`}
                    </PlanRow>
                  )}

                  {targetOn && lastClose != null && (
                    <PlanRow label="Target" tone="good">
                      {`Take profit at ${targetPct}% — ${(direction === "long" ? lastClose * (1 + targetPct / 100) : lastClose * (1 - targetPct / 100)).toFixed(2)} from the last close.`}
                    </PlanRow>
                  )}

                  {timeOn && (
                    <PlanRow label="Time limit">{`Close the position after ${Math.round(timeDays)} trading days regardless of price.`}</PlanRow>
                  )}

                  <PlanRow label="Review">
                    Check once per day after the close. Nothing in this rule requires watching the market intraday, and
                    doing so is how a daily strategy turns into a different one.
                  </PlanRow>

                  <PlanRow label="What to expect" tone="warn">
                    {`About ${Math.round(m.tradeCount / Math.max(1, years))} trades a year, a ${(m.winRate * 100).toFixed(0)}% win rate, and drawdowns reaching ${(m.maxDrawdown * 100).toFixed(0)}%. The longest stretch below a previous peak was ${m.maxDrawdownDuration} days.`}
                  </PlanRow>
                </dl>
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
                  <span className="font-mono text-[10px] text-slate-600">
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
                          <td className="px-4 py-2 font-mono text-[11px] text-slate-600">{i + 1}</td>
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
                          <td className="px-4 py-2 text-xs text-slate-500">{t.reason.replace(/_/g, " ")}</td>
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
