import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, CircleAlert, Gauge, Medal, Skull, Swords, X } from "lucide-react";

import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { ActionButton } from "@/components/ui/action-button";
import { RaceChart } from "@/components/adversary/race-chart";
import { clearPool, readPool, saveWinner, type RacePool } from "@/lib/adversary/handoff";
import type { Candidate, PipelineMessage } from "@/lib/adversary/pipeline.worker";
import { cn } from "@/lib/utils";

const pct = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;

/**
 * The race: a whole field put through the same battery, ranked by what survived.
 *
 * Ranking is by ordeals passed, not by return. A field sorted on return would
 * simply hand first place to whichever rule was luckiest over this particular
 * history, which is the failure the Adversary exists to catch. Return is shown,
 * but it breaks ties rather than setting them.
 */
export function RaceView() {
  const navigate = useNavigate();
  const workerRef = useRef<Worker | null>(null);

  const [pool] = useState<RacePool | null>(() => readPool());
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "Preparing…" });
  const [running, setRunning] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const start = () => {
    if (!pool || running) return;
    setRunning(true);
    setCandidates(null);
    setWinnerId(null);
    setError(null);
    setProgress({ done: 0, total: pool.candidates.length, label: "Starting…" });

    workerRef.current?.terminate();

    // The race runs in a module worker. Browsers that predate module worker
    // support — Firefox before 114, Safari before 15 — throw from the
    // constructor rather than firing onerror, so construction is guarded and
    // reported separately from a fault inside the worker.
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../lib/adversary/pipeline.worker.ts", import.meta.url), {
        type: "module"
      });
    } catch (cause) {
      setError(
        `This browser could not start the race worker${
          cause instanceof Error ? `: ${cause.message}` : "."
        } Module workers are required, which needs Firefox 114, Safari 15 or Chrome 80 and later.`
      );
      setRunning(false);
      return;
    }
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<PipelineMessage>) => {
      const m = event.data;
      if (m.type === "progress") {
        setProgress({ done: m.done, total: m.total, label: m.label });
      } else if (m.type === "complete") {
        setCandidates(m.candidates);
        setWinnerId(m.winnerId);
        setDates(m.dates ?? []);
        setRunning(false);
        worker.terminate();
      } else {
        setError(m.message);
        setRunning(false);
        worker.terminate();
      }
    };

    // onerror covers both a worker that never loaded and one that threw while
    // running. The previous handler reported every case as a failure to start,
    // which sent anyone debugging it looking in the wrong place. The event
    // carries the real message, file and line, so report those.
    worker.onerror = (event: ErrorEvent) => {
      const where = event.filename ? ` (${event.filename.split("/").pop()}:${event.lineno})` : "";
      setError(event.message ? `Race worker error: ${event.message}${where}` : `The race worker failed to load${where}.`);
      setRunning(false);
      worker.terminate();
    };

    // Fires when a message cannot be deserialised — a pool carrying something
    // uncloneable would land here rather than as a silent hang.
    worker.onmessageerror = () => {
      setError("The race worker sent a message this browser could not read. Rebuild the field and try again.");
      setRunning(false);
      worker.terminate();
    };

    worker.postMessage({
      type: "run",
      ticker: pool.ticker,
      assetClass: pool.assetClass,
      poolSize: pool.candidates.length,
      seed: Date.now() % 1_000_000,
      supplied: pool.candidates.map((c) => ({ spec: c.spec, origin: c.origin }))
    });
  };

  /**
   * Standings: most ordeals survived first, then robustness, then return.
   * Return is the last key on purpose — see the note on the component.
   */
  const standings = useMemo(() => {
    if (!candidates) return [];
    return [...candidates].sort(
      (a, b) =>
        b.survived - a.survived ||
        b.robustness - a.robustness ||
        b.totalReturn - a.totalReturn
    );
  }, [candidates]);

  const winner = standings.find((c) => c.id === winnerId) ?? null;
  const percentDone = progress.total ? ((progress.done / progress.total) * 100).toFixed(0) : "0";

  const sendWinner = () => {
    if (!winner || !pool) return;
    const ok = saveWinner({
      ticker: pool.ticker,
      instrumentLabel: pool.instrumentLabel,
      spec: winner.spec,
      survived: winner.survived,
      ordealCount: winner.ordeals.length,
      robustness: winner.robustness,
      fieldSize: standings.length,
      sharpeAnnual: winner.sharpeAnnual,
      totalReturn: winner.totalReturn,
      maxDrawdown: winner.maxDrawdown,
      tradeCount: winner.tradeCount,
      decidedAt: new Date().toISOString()
    });
    if (!ok) {
      setError("This browser refused to store the winner, so it cannot be handed to the Back Tester.");
      return;
    }
    navigate("/back-tester?from=race");
  };

  if (!pool) {
    return (
      <section className="py-9">
        <div className="eyebrow">
          <Swords size={15} />
          Race
        </div>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-.018em] text-foreground">
          No field waiting.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          A race needs a field of candidates. Build one in the Strategy Maker and send it here.
        </p>
        <a
          href="#/signal-room"
          className="mt-5 inline-flex items-center gap-2 text-sm text-signal-soft hover:underline"
        >
          Open the Strategy Maker
          <ChevronRight size={15} />
        </a>
      </section>
    );
  }

  return (
    <section className="py-9">
      <ScrollReveal variant="rise">
        <div className="eyebrow">
          <Swords size={15} />
          The Adversary · Race
        </div>
        <h1 className="mt-4 max-w-3xl font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground">
          {pool.candidates.length} strategies enter.
          <br />
          <span className="font-normal text-foreground/55">Whatever survives, wins.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
          Every candidate faces the same battery on {pool.instrumentLabel}. They are ranked by ordeals survived, not
          by return — sorting a field on return just crowns whichever rule was luckiest over this history.
        </p>
      </ScrollReveal>

      <ScrollReveal variant="drift" className="mt-6">
        <div className="rounded-[20px] border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs leading-5 text-muted-foreground">
              {pool.instrumentLabel} ({pool.ticker}) · {pool.candidates.length} candidates ·{" "}
              {pool.candidates.filter((c) => c.origin === "playbook").length} from the playbook
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  clearPool();
                  navigate("/signal-room");
                }}
                className="rounded-xl border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-slate-600 hover:text-foreground"
              >
                Discard field
              </button>
              <ActionButton onClick={start} disabled={running}>
                <Swords size={15} />
                {running ? `Racing ${percentDone}%` : candidates ? "Race again" : "Start the race"}
              </ActionButton>
            </div>
          </div>

          {running && (
            <div className="mt-4">
              <div className="flex justify-between gap-4 font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                <span className="truncate">{progress.label}</span>
                <span className="shrink-0">
                  {progress.done}/{progress.total}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-signal transition-all duration-200"
                  style={{ width: `${percentDone}%` }}
                />
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

      {/* ── Winner ─────────────────────────────────────────────── */}
      {winner && (
        <ScrollReveal variant="settle" className="mt-8">
          <div className="rounded-[24px] border border-emerald-500/40 bg-emerald-950/15 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Medal size={16} className="text-emerald-300" />
                  <span className="font-mono text-[10px] uppercase tracking-[.16em] text-emerald-300">
                    Winner · {winner.survived}/{winner.ordeals.length} ordeals
                  </span>
                </div>
                <h2 className="mt-2 font-display text-3xl font-semibold tracking-[-.018em] text-foreground">
                  {winner.name}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{winner.description}</p>
              </div>
              <ActionButton onClick={sendWinner} className="shrink-0">
                <Gauge size={15} />
                Send to the Back Tester
              </ActionButton>
            </div>

            <div className="mt-5 grid gap-px overflow-hidden rounded-[16px] border border-border bg-border sm:grid-cols-4">
              {[
                ["Sharpe", winner.sharpeAnnual.toFixed(2)],
                ["Total return", pct(winner.totalReturn, 0)],
                ["Max drawdown", pct(-winner.maxDrawdown, 0)],
                ["Trades", String(winner.tradeCount)]
              ].map(([label, value]) => (
                <div key={label} className="bg-card px-4 py-3">
                  <div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">{label}</div>
                  <div className="mt-1 text-sm text-foreground">{value}</div>
                </div>
              ))}
            </div>



          </div>
        </ScrollReveal>
      )}

      {candidates && !winner && (
        <ScrollReveal variant="settle" className="mt-8">
          <p className="rounded-[20px] border border-amber-500/30 bg-amber-950/20 p-5 text-sm leading-6 text-amber-200/90">
            Nothing survived. Of {candidates.length} strategies raced on {pool.instrumentLabel}, none cleared enough of
            the battery to be worth backtesting. That is a legitimate result, not a failure — build a new field, or try
            a different instrument.
          </p>
        </ScrollReveal>
      )}

      {/* ── Standings ──────────────────────────────────────────── */}
      {candidates && (
        <ScrollReveal variant="drift" className="mt-8">
          <div className="rounded-[20px] border border-border bg-card p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-2xl font-semibold tracking-[-.018em] text-foreground">
                The field
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                {standings.length} curves · one axis
              </span>
            </div>
            <div className="mt-4">
              <RaceChart
                dates={dates}
                runners={standings.map((c) => ({
                  id: c.id,
                  name: c.name,
                  equity: c.equity,
                  eliminated: c.eliminated,
                  isWinner: c.id === winnerId
                }))}
              />
            </div>
          </div>

          <h2 className="mt-8 font-display text-2xl font-semibold tracking-[-.018em] text-foreground">
            Final standings
          </h2>

          <div className="mt-4 space-y-2">
            {standings.map((c, place) => {
              const isWinner = c.id === winnerId;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "rounded-[16px] border p-4",
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
                        <span
                          className={cn(
                            "font-mono text-sm tabular-nums",
                            place === 0 ? "text-emerald-300" : "text-slate-600"
                          )}
                        >
                          {String(place + 1).padStart(2, "0")}
                        </span>
                        {isWinner ? (
                          <Medal size={13} className="text-emerald-300" />
                        ) : c.eliminated ? (
                          <Skull size={13} className="text-slate-600" aria-label="eliminated" />
                        ) : null}
                        <span className="text-sm font-medium text-foreground">{c.name}</span>
                        <span className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
                          {c.origin}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{c.description}</p>
                    </div>

                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
                          Survived
                        </div>
                        <div className={cn("text-sm", isWinner ? "text-emerald-300" : "text-foreground")}>
                          {c.survived}/{c.ordeals.length}
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
                          Return
                        </div>
                        <div className="text-sm text-foreground">{pct(c.totalReturn, 0)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Ordeal results as a log readout rather than coloured
                      pills. Status lives in a 2px rule down the left edge and
                      in the glyph, never in colour alone. */}
                  <div className="mt-3 grid gap-px overflow-hidden rounded-[3px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                    {c.ordeals.map((o) => (
                      <div
                        key={o.name}
                        title={`${o.name} — ${o.detail}`}
                        className="flex items-center gap-2 bg-card px-2.5 py-1.5"
                      >
                        <span
                          aria-hidden
                          className={cn("h-4 w-0.5 shrink-0", o.passed ? "bg-emerald-400" : "bg-red-400")}
                        />
                        <span className={cn("shrink-0", o.passed ? "text-emerald-400" : "text-red-400")}>
                          {o.passed ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
                        </span>
                        <span className="truncate font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                          {o.name}
                        </span>
                      </div>
                    ))}
                  </div>

                  {c.causeOfDeath && !isWinner && (
                    <p className="mt-2 text-xs leading-5 text-slate-500">Killed by — {c.causeOfDeath}</p>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollReveal>
      )}
    </section>
  );
}
