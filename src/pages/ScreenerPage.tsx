import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Filter, Radar, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";

import Layout from "@/components/Layout";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { ActionButton } from "@/components/ui/action-button";
import { EquityCurve } from "@/components/adversary/charts";
import {
  ASSET_CLASS_LABEL,
  INSTRUMENTS,
  depthWarning,
  instrumentByTicker,
  maxLookbackFor,
  type AssetClass
} from "@/lib/adversary/instruments";
import type { ScreenCandidate, ScreenMessage } from "@/lib/adversary/screener.worker";
import { buildPermalink } from "@/lib/adversary/permalink";
import { useSession } from "@/lib/adversary/session";
import { describeSpec } from "@/lib/adversary/spec";
import { cn } from "@/lib/utils";

const STRATEGIES_PER_INSTRUMENT = 150;

const VERDICT_STYLE = {
  SURVIVED: "text-emerald-300 border-emerald-500/40 bg-emerald-950/20",
  WOUNDED: "text-amber-300 border-amber-500/40 bg-amber-950/20",
  DEAD: "text-red-300 border-red-500/40 bg-red-950/20"
} as const;

const SIGNAL_LABEL: Record<string, string> = {
  sma: "Moving average",
  ema: "Exponential MA",
  rsi: "RSI",
  zscore: "Z-score",
  momentum: "Momentum",
  volatility: "Volatility",
  price: "Price",
  volume_ratio: "Volume"
};

const ORDER: AssetClass[] = ["index", "stock", "forex", "commodity", "synthetic"];
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

export default function ScreenerPage() {
  const workerRef = useRef<Worker | null>(null);
  const navigate = useNavigate();
  const [session, store] = useSession();

  const [tickers, setTickers] = useState<string[]>(["SPY"]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 1, label: "" });
  const [candidates, setCandidates] = useState<ScreenCandidate[] | null>(null);
  const [trialsRun, setTrialsRun] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [hideDead, setHideDead] = useState(false);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const grouped = useMemo(() => {
    const map = new Map<AssetClass, typeof INSTRUMENTS>();
    for (const instrument of INSTRUMENTS) {
      const list = map.get(instrument.assetClass) ?? [];
      list.push(instrument);
      map.set(instrument.assetClass, list);
    }
    return ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, []);

  const totalStrategies = tickers.length * STRATEGIES_PER_INSTRUMENT;

  // The shortest series in the selection governs how much can be concluded.
  const shallowest = useMemo(() => {
    const chosen = tickers.map((t) => instrumentByTicker(t)).filter(Boolean);
    if (!chosen.length) return null;
    return chosen.reduce((min, i) => (i!.bars < min!.bars ? i : min))!;
  }, [tickers]);

  const toggleTicker = (ticker: string) =>
    setTickers((current) =>
      current.includes(ticker) ? current.filter((t) => t !== ticker) : [...current, ticker]
    );

  const run = () => {
    if (!tickers.length) return;
    setRunning(true);
    setCandidates(null);
    setError(null);
    setProgress({ done: 0, total: totalStrategies, label: "Starting…" });

    workerRef.current?.terminate();
    const worker = new Worker(new URL("../lib/adversary/screener.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ScreenMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        setProgress({ done: message.done, total: message.total, label: message.label });
      } else if (message.type === "complete") {
        setCandidates(message.candidates);
        setTrialsRun(message.trialsRun);
        setRunning(false);
        store.recordTrials(message.trialSharpes, true);
        worker.terminate();
      } else {
        setError(message.message);
        setRunning(false);
        worker.terminate();
      }
    };

    worker.onerror = () => {
      setError("The screener worker failed to start.");
      setRunning(false);
    };

    worker.postMessage({
      type: "screen",
      tickers,
      strategiesPerInstrument: STRATEGIES_PER_INSTRUMENT,
      seed: Date.now() % 1_000_000,
      priorTrials: session.trialCount
    });
  };

  const families = useMemo(() => {
    if (!candidates) return [];
    return [...new Set(candidates.map((c) => c.family))].sort();
  }, [candidates]);

  const visible = useMemo(() => {
    if (!candidates) return [];
    return candidates
      .filter((c) => familyFilter === "all" || c.family === familyFilter)
      .filter((c) => !hideDead || c.verdict !== "DEAD")
      .slice(0, 30);
  }, [candidates, familyFilter, hideDead]);

  const summary = useMemo(() => {
    if (!candidates) return null;
    const counts = { SURVIVED: 0, WOUNDED: 0, DEAD: 0 };
    for (const c of candidates) counts[c.verdict]++;
    return counts;
  }, [candidates]);

  const openInAdversary = (candidate: ScreenCandidate) => {
    const link = buildPermalink({ spec: candidate.spec });
    navigate(link.slice(link.indexOf("#")).replace(/^#/, ""));
  };

  const percentDone = ((progress.done / Math.max(progress.total, 1)) * 100).toFixed(0);

  return (
    <Layout showBackLink>
      <section className="py-9">
        <ScrollReveal variant="rise">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="eyebrow">
                <Radar size={15} />
                Stress tester
              </div>
              <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground">
                Generate thousands.
                <br />
                <span className="font-normal text-foreground/55">Keep what survives.</span>
              </h1>
            </div>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              Pick an instrument. The generator builds {STRATEGIES_PER_INSTRUMENT} strategies from the grammar, runs
              the attacks on every one, and ranks them by what withstands the attacks — not by what scores highest.
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal variant="drift" className="mt-6">
          <div className="rounded-2xl border border-signal/25 bg-signal/[0.06] px-5 py-4">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-signal-soft">Read this first</div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
              This is a search over {totalStrategies.toLocaleString()} strategies. The winner will look good{" "}
              <em>by construction</em> — that is what searching does. Every candidate is therefore ranked by a survival
              score built from the attacks, its Sharpe is deflated by the full size of the search, and all
              {" "}{totalStrategies.toLocaleString()} trials are charged to your session counter.
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal variant="drift" index={1} className="mt-5">
          <div className="rounded-[24px] border border-border bg-card p-5 md:p-6">
            <span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
              Choose what to trade
            </span>

            <div className="mt-4 space-y-4">
              {grouped.map(([assetClass, list]) => (
                <div key={assetClass}>
                  <div className="font-mono text-[9px] uppercase tracking-[.14em] text-zinc-600">
                    {ASSET_CLASS_LABEL[assetClass]}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {list.map((instrument) => (
                      <button
                        key={instrument.ticker}
                        disabled={running}
                        onClick={() => toggleTicker(instrument.ticker)}
                        title={instrument.note}
                        className={cn(
                          "rounded-full border px-3.5 py-2 text-xs transition-colors disabled:opacity-50",
                          tickers.includes(instrument.ticker)
                            ? "border-signal/60 bg-signal/10 text-foreground"
                            : "border-border text-muted-foreground hover:border-zinc-600"
                        )}
                      >
                        <span className="font-medium">{instrument.label}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-zinc-600">{instrument.ticker}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Data depth governs what any of this can prove. */}
            {shallowest && depthWarning(shallowest.bars) && (
              <p className="mt-4 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs leading-5 text-amber-200/90">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong className="font-semibold">{shallowest.label}</strong> — {depthWarning(shallowest.bars)}
                </span>
              </p>
            )}

            {shallowest && (
              <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                Source: {shallowest.source}. Lookbacks capped at {maxLookbackFor(shallowest.bars)} days for this
                selection.
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <p className="text-xs leading-5 text-muted-foreground">
                {tickers.length === 0
                  ? "Select at least one instrument."
                  : `${totalStrategies.toLocaleString()} strategies will be generated and attacked.`}
              </p>
              <ActionButton onClick={run} disabled={running || tickers.length === 0}>
                {running ? `Screening ${percentDone}%` : "Generate and attack"}
              </ActionButton>
            </div>

            {running && (
              <div className="mt-5">
                <div className="flex justify-between gap-4 font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                  <span className="truncate">{progress.label}</span>
                  <span className="shrink-0">
                    {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
                  </span>
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

        {summary && candidates && (
          <>
            <ScrollReveal variant="settle" className="mt-5">
              <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
                {[
                  ["Generated", candidates.length.toLocaleString()],
                  ["Survived", String(summary.SURVIVED)],
                  ["Wounded", String(summary.WOUNDED)],
                  ["Trials charged", trialsRun.toLocaleString()]
                ].map(([label, value]) => (
                  <div key={label} className="bg-card px-4 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</div>
                    <div className="mt-1.5 text-xl text-foreground">{value}</div>
                  </div>
                ))}
              </div>
              {summary.SURVIVED === 0 && (
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  Nothing survived. That is the most common outcome and it is not a bug — of{" "}
                  {candidates.length.toLocaleString()} strategies generated, none cleared the cost of having searched
                  for them. This is what the multiple-testing penalty looks like when it is actually applied.
                </p>
              )}
            </ScrollReveal>

            <ScrollReveal variant="drift" className="mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <Filter size={14} className="text-muted-foreground" />
                {["all", ...families].map((family) => (
                  <button
                    key={family}
                    onClick={() => setFamilyFilter(family)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs transition-colors",
                      familyFilter === family
                        ? "border-signal/60 bg-signal/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-zinc-600"
                    )}
                  >
                    {family === "all" ? "All signals" : (SIGNAL_LABEL[family] ?? family)}
                  </button>
                ))}
                <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={hideDead}
                    onChange={(event) => setHideDead(event.target.checked)}
                    className="h-4 w-4 accent-[rgb(var(--color-signal))]"
                  />
                  Hide dead
                </label>
              </div>
            </ScrollReveal>

            <div className="mt-4 space-y-3">
              {visible.map((candidate, index) => (
                <ScrollReveal key={candidate.id} variant={index % 2 === 0 ? "drift" : "drift-right"} index={Math.min(index, 4)}>
                  <div className="rounded-[20px] border border-border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-[.12em] text-zinc-600">
                            #{index + 1}
                          </span>
                          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground">
                            {instrumentByTicker(candidate.ticker)?.label ?? candidate.ticker}
                          </span>
                          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground">
                            {SIGNAL_LABEL[candidate.family] ?? candidate.family}
                          </span>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[.1em]",
                              VERDICT_STYLE[candidate.verdict]
                            )}
                          >
                            {candidate.verdict}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-zinc-300">{describeSpec(candidate.spec)}</p>
                      </div>

                      <div className="text-right">
                        <div className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">
                          Survival
                        </div>
                        <div
                          className={cn(
                            "font-display text-3xl font-semibold tracking-[-.018em]",
                            candidate.survivalScore >= 70
                              ? "text-emerald-300"
                              : candidate.survivalScore >= 45
                                ? "text-amber-300"
                                : "text-red-300"
                          )}
                        >
                          {candidate.survivalScore}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
                      {[
                        ["Sharpe", candidate.sharpeAnnual.toFixed(2)],
                        ["DSR", pct(candidate.dsr)],
                        ["vs random", pct(candidate.noisePercentile)],
                        ["Synthetic", pct(candidate.bootstrapSurvival)],
                        ["Dies at", `${candidate.breakevenBps}bps`],
                        ["Trades", String(candidate.tradeCount)]
                      ].map(([label, value]) => (
                        <div key={label} className="bg-card px-3 py-2">
                          <div className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
                            {label}
                          </div>
                          <div className="mt-1 text-sm text-foreground">{value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                      <EquityCurve
                        series={candidate.equity}
                        stroke={
                          candidate.verdict === "SURVIVED"
                            ? "rgb(52 211 153)"
                            : candidate.verdict === "WOUNDED"
                              ? "rgb(251 191 36)"
                              : "rgb(var(--color-muted-foreground))"
                        }
                      />
                      <ActionButton variant="secondary" size="sm" onClick={() => openInAdversary(candidate)}>
                        Run all 8 attacks
                      </ActionButton>
                    </div>
                  </div>
                </ScrollReveal>
              ))}

              {visible.length === 0 && (
                <p className="rounded-[20px] border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Nothing matches these filters.
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </Layout>
  );
}
