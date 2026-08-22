import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, CircleAlert, Skull, Sparkles, Swords, X } from "lucide-react";

import Layout from "@/components/Layout";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { ActionButton } from "@/components/ui/action-button";
import { EquityCurve } from "@/components/adversary/charts";
import { SignalCard } from "@/components/adversary/signal-card";
import { ASSET_CLASS_LABEL, INSTRUMENTS, instrumentByTicker, type AssetClass } from "@/lib/adversary/instruments";
import { DEFAULT_COSTS, runBacktest } from "@/lib/adversary/engine";
import { SignalCache } from "@/lib/adversary/signals";
import { loadInstrument } from "@/lib/adversary/instruments";
import { buildPermalink } from "@/lib/adversary/permalink";
import type { Candidate, PipelineMessage } from "@/lib/adversary/pipeline.worker";
import { cn } from "@/lib/utils";

const POOL_SIZE = 14; // within the 5–20 band the spec calls for
const BACKTEST_YEARS = 10;
const ORDER: AssetClass[] = ["index", "stock", "forex", "commodity"];

const pct = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;

function StageHeader({ n, title, subtitle, active, done }: { n: number; title: string; subtitle: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full border font-mono text-xs",
          done ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-300"
            : active ? "border-signal/60 bg-signal/10 text-signal-soft"
            : "border-border text-muted-foreground"
        )}
      >
        {done ? <Check size={13} /> : n}
      </span>
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-[-.018em] text-foreground">{title}</h2>
        <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const workerRef = useRef<Worker | null>(null);

  const [ticker, setTicker] = useState("^GSPC");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ stage: 1 as 1 | 2, done: 0, total: POOL_SIZE, label: "" });
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

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

  const winner = candidates?.find((c) => c.id === winnerId) ?? null;

  // Stage 3: the winner re-run over the most recent decade only.
  const validation = useMemo(() => {
    if (!winner) return null;
    const full = loadInstrument(ticker);
    const window = Math.min(full.close.length, BACKTEST_YEARS * 252);
    const start = full.close.length - window;
    const recent = {
      ...full,
      dates: full.dates.slice(start),
      open: full.open.slice(start),
      high: full.high.slice(start),
      low: full.low.slice(start),
      close: full.close.slice(start),
      volume: full.volume.slice(start)
    };
    return { bars: recent, result: runBacktest(winner.spec, recent, DEFAULT_COSTS, new SignalCache(recent)) };
  }, [winner, ticker]);

  const run = () => {
    if (!instrument) return;
    setRunning(true);
    setCandidates(null);
    setWinnerId(null);
    setError(null);
    setProgress({ stage: 1, done: 0, total: POOL_SIZE, label: "Starting…" });

    workerRef.current?.terminate();
    const worker = new Worker(new URL("../lib/adversary/pipeline.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<PipelineMessage>) => {
      const m = event.data;
      if (m.type === "progress") setProgress({ stage: m.stage, done: m.done, total: m.total, label: m.label });
      else if (m.type === "complete") {
        setCandidates(m.candidates);
        setWinnerId(m.winnerId);
        setRunning(false);
        worker.terminate();
      } else {
        setError(m.message);
        setRunning(false);
        worker.terminate();
      }
    };
    worker.onerror = () => {
      setError("The pipeline worker failed to start.");
      setRunning(false);
    };

    worker.postMessage({
      type: "run",
      ticker,
      assetClass: instrument.assetClass,
      poolSize: POOL_SIZE,
      seed: Date.now() % 1_000_000
    });
  };

  const survivors = candidates?.filter((c) => !c.eliminated) ?? [];
  const percentDone = ((progress.done / Math.max(progress.total, 1)) * 100).toFixed(0);

  return (
    <Layout showBackLink>
      <section className="py-9">
        <ScrollReveal variant="rise">
          <div className="eyebrow">
            <Swords size={15} />
            The Signal Room
          </div>
          <h1 className="mt-4 max-w-3xl font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground">
            Pick an instrument.
            <br />
            <span className="font-normal text-foreground/55">We generate the strategies, then try to kill them.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            Three stages, run in order: the Strategy Maker builds a pool of candidates for your asset, the Adversary
            red-teams every one of them, and the Back Tester validates whatever survives over {BACKTEST_YEARS} years.
          </p>
        </ScrollReveal>

        {/* ── Stage 1 ─────────────────────────────────────────────── */}
        <ScrollReveal variant="drift" className="mt-10">
          <StageHeader
            n={1}
            title="Strategy Maker"
            subtitle={`Generates ${POOL_SIZE} distinct strategies tailored to the instrument you choose.`}
            active={!candidates}
            done={Boolean(candidates)}
          />

          <div className="mt-4 rounded-[20px] border border-border bg-card p-5">
            <div className="space-y-4">
              {grouped.map(([assetClass, list]) => (
                <div key={assetClass}>
                  <div className="font-mono text-[9px] uppercase tracking-[.14em] text-zinc-600">
                    {ASSET_CLASS_LABEL[assetClass]}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {list.map((i) => (
                      <button
                        key={i.ticker}
                        disabled={running}
                        onClick={() => {
                          setTicker(i.ticker);
                          setCandidates(null);
                          setWinnerId(null);
                        }}
                        title={i.note}
                        className={cn(
                          "min-h-[44px] rounded-full border px-4 py-2 text-xs transition-colors disabled:opacity-50",
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

            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
              <p className="text-xs leading-5 text-muted-foreground">
                {instrument
                  ? `${instrument.label} · ${instrument.bars.toLocaleString()} daily bars · ${instrument.source}`
                  : "Select an instrument."}
              </p>
              <ActionButton onClick={run} disabled={running || !instrument}>
                <Sparkles size={15} />
                {running ? `Running ${percentDone}%` : "Run the pipeline"}
              </ActionButton>
            </div>

            {running && (
              <div className="mt-4">
                <div className="flex justify-between gap-4 font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                  <span className="truncate">Stage {progress.stage} — {progress.label}</span>
                  <span className="shrink-0">{progress.done}/{progress.total}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-signal transition-all duration-200" style={{ width: `${percentDone}%` }} />
                </div>
              </div>
            )}

            {error && (
              <p className="mt-4 flex gap-2 text-sm text-red-300">
                <CircleAlert size={15} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        </ScrollReveal>

        {/* ── Stage 2 ─────────────────────────────────────────────── */}
        {candidates && (
          <ScrollReveal variant="drift" className="mt-10">
            <StageHeader
              n={2}
              title="The Adversary"
              subtitle={`Eight ordeals per candidate. ${candidates.length - survivors.length} of ${candidates.length} were eliminated.`}
              active={!winner}
              done={Boolean(winner)}
            />

            <div className="mt-4 space-y-2">
              {candidates.map((c) => {
                const isWinner = c.id === winnerId;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "rounded-[16px] border p-4 transition-colors",
                      isWinner
                        ? "border-emerald-500/50 bg-emerald-950/15"
                        : c.eliminated
                          ? "border-border bg-card/50 opacity-70"
                          : "border-border bg-card"
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {isWinner ? (
                            <span className="rounded-full border border-emerald-500/50 bg-emerald-950/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[.1em] text-emerald-300">
                              Survivor
                            </span>
                          ) : (
                            <Skull size={13} className="text-zinc-600" aria-label="eliminated" />
                          )}
                          <span className="text-sm font-medium text-foreground">{c.name}</span>
                          <span className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
                            {c.origin}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{c.description}</p>
                      </div>

                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <div className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">Sharpe</div>
                          <div className="text-sm text-foreground">{c.sharpeAnnual.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">Ordeals</div>
                          <div className={cn("text-sm", isWinner ? "text-emerald-300" : "text-foreground")}>
                            {c.survived}/{c.ordeals.length}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Per-ordeal result. Shape plus colour, never colour alone. */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {c.ordeals.map((o) => (
                        <span
                          key={o.name}
                          title={`${o.name} — ${o.detail}`}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px]",
                            o.passed
                              ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                              : "border-red-500/30 bg-red-950/20 text-red-300"
                          )}
                        >
                          {o.passed ? <Check size={10} /> : <X size={10} />}
                          {o.name}
                        </span>
                      ))}
                    </div>

                    {c.causeOfDeath && !isWinner && (
                      <p className="mt-2 text-xs leading-5 text-zinc-500">Killed by — {c.causeOfDeath}</p>
                    )}

                    {/* Hand the spec to the Adversary workbench, where the same
                        eight attacks can be re-run one at a time with the
                        parameters exposed. The spec rides in the permalink, so
                        no state is shared between the two pages. */}
                    <a
                      href={buildPermalink({ spec: c.spec })}
                      className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-signal-soft"
                    >
                      Open in the Adversary
                      <ArrowUpRight size={13} />
                    </a>
                  </div>
                );
              })}
            </div>

            {!winner && (
              <p className="mt-4 rounded-[16px] border border-amber-500/30 bg-amber-950/20 p-4 text-sm leading-6 text-amber-200/90">
                Nothing survived this round. That is a legitimate outcome, not an error — of {candidates.length}{" "}
                strategies generated for {instrument?.label}, none cleared enough of the battery to be worth validating.
                Run it again for a fresh pool, or try a different instrument.
              </p>
            )}
          </ScrollReveal>
        )}

        {/* ── Stage 3 ─────────────────────────────────────────────── */}
        {winner && validation && (
          <ScrollReveal variant="settle" className="mt-10">
            <StageHeader
              n={3}
              title="Back Tester"
              subtitle={`Deep validation of the survivor over the last ${BACKTEST_YEARS} years.`}
              active
              done
            />

            <div className="mt-4 space-y-4">
              <SignalCard
                result={validation.result}
                spec={winner.spec}
                bars={validation.bars}
                verdict={null}
                instrumentLabel={instrument?.label ?? ticker}
              />

              <div className="rounded-[20px] border border-border bg-card p-5">
                <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                  Equity curve · {BACKTEST_YEARS} years
                </div>
                <div className="mt-3">
                  <EquityCurve series={Array.from(validation.result.equity)} stroke="rgb(52 211 153)" />
                </div>
              </div>

              {/* Implementation guide */}
              <div className="rounded-[20px] border border-border bg-card p-5">
                <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                  How to run this
                </div>

                <ol className="mt-4 space-y-3">
                  {[
                    ["Instrument", `${instrument?.label} (${ticker}). Daily bars, checked once per day after the close.`],
                    ["Entry", winner.description.split(". Exit")[0] + "."],
                    ["Exit", "Exit when " + (winner.description.split("Exit when ")[1] ?? "the signal reverses.")],
                    [
                      "Sizing",
                      winner.spec.sizing.kind === "fixed_fraction"
                        ? `Commit ${winner.spec.sizing.pct}% of capital per position.`
                        : winner.spec.sizing.kind === "inverse_volatility"
                          ? `Size inversely to ${winner.spec.sizing.lookback}-day volatility, targeting 15% annualised, capped at full exposure.`
                          : "Full exposure on each signal."
                    ],
                    ["Execution", "Signals are read on the close; orders fill at the next day's open. Assume 15bps round-trip in costs."],
                    [
                      "Expected behaviour",
                      `About ${Math.round(validation.result.metrics.tradeCount / BACKTEST_YEARS)} trades a year, ` +
                        `a ${(validation.result.metrics.winRate * 100).toFixed(0)}% win rate, and drawdowns reaching ` +
                        `${(validation.result.metrics.maxDrawdown * 100).toFixed(0)}%. Expect long flat stretches.`
                    ]
                  ].map(([label, body], i) => (
                    <li key={label} className="flex gap-3">
                      <span className="mt-0.5 font-mono text-[10px] text-signal-soft">{String(i + 1).padStart(2, "0")}</span>
                      <div>
                        <div className="text-sm font-medium text-foreground">{label}</div>
                        <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{body}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <p className="mt-5 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs leading-5 text-amber-200/90">
                  <CircleAlert size={14} className="mt-0.5 shrink-0" />
                  This survived {winner.survived} of {winner.ordeals.length} ordeals on historical data. That is failure
                  to disprove an edge, not proof of one. Paper-trade it forward before committing capital.
                </p>
              </div>

              <div className="grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-4">
                {[
                  ["Total return", pct(validation.result.metrics.totalReturn, 0)],
                  ["CAGR", pct(validation.result.metrics.cagr)],
                  ["Sharpe", (validation.result.metrics.sharpe * Math.sqrt(252)).toFixed(2)],
                  ["Max drawdown", pct(-validation.result.metrics.maxDrawdown, 0)]
                ].map(([label, value]) => (
                  <div key={label} className="bg-card px-4 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</div>
                    <div className="mt-1.5 font-display text-2xl font-semibold tracking-[-.018em] text-foreground">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ScrollReveal>
        )}

        {!candidates && !running && (
          <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <ChevronRight size={15} className="text-signal-soft" />
            Choose an instrument above and run the pipeline.
          </p>
        )}
      </section>
    </Layout>
  );
}
