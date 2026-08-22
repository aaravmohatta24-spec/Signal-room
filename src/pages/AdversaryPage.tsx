import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, Crosshair, Gauge, Link2, Skull, Upload, X } from "lucide-react";

import Layout from "@/components/Layout";
import { RaceView } from "@/components/adversary/race-view";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { ActionButton } from "@/components/ui/action-button";
import { AttackChartView, EquityCurve } from "@/components/adversary/charts";
import { StrategyBuilder } from "@/components/adversary/strategy-builder";
import { StrategyCompiler } from "@/components/adversary/strategy-compiler";
import { SignalCard } from "@/components/adversary/signal-card";
import {
  attackCostSensitivity,
  attackHaircut,
  attackNoiseBenchmark,
  attackOverfitting,
  attackParameterStability,
  attackRegimeDependence,
  attackSearchCost,
  attackSyntheticMarkets,
  buildVerdict,
  type AttackResult,
  type Verdict
} from "@/lib/adversary/attacks";
import { parseOhlcvCsv } from "@/lib/adversary/data";
import { INSTRUMENTS, depthWarning, instrumentByTicker, loadInstrument } from "@/lib/adversary/instruments";
import { DEFAULT_COSTS, runBacktest } from "@/lib/adversary/engine";
import { buildPermalink, readPermalink } from "@/lib/adversary/permalink";
import { SignalCache, type Bars } from "@/lib/adversary/signals";
import { describeSpec, validateSpec, type StrategySpec } from "@/lib/adversary/spec";
import { useSession } from "@/lib/adversary/session";
import { annualise } from "@/lib/adversary/stats";
import { cn } from "@/lib/utils";

/** Total attacks in the suite, used for the progress readout. */
const ATTACK_COUNT = 8;

const DEFAULT_SPEC: StrategySpec = {
  name: "Golden cross",
  universe: "SPY",
  entry: {
    left: { kind: "sma", period: 50 },
    comparator: "crosses_above",
    right: { kind: "sma", period: 200 },
    direction: "long"
  },
  exits: [{ kind: "opposite_signal" }, { kind: "stop_loss", pct: 5 }],
  sizing: { kind: "fixed_fraction", pct: 100 }
};

const STATUS_STYLE = {
  pass: { dot: "bg-emerald-400", text: "text-emerald-300", label: "PASS" },
  warn: { dot: "bg-amber-400", text: "text-amber-300", label: "WARN" },
  fail: { dot: "bg-red-400", text: "text-red-300", label: "FAIL" }
} as const;

const VERDICT_STYLE = {
  SURVIVED: { text: "text-emerald-300", ring: "border-emerald-500/40 bg-emerald-950/20" },
  WOUNDED: { text: "text-amber-300", ring: "border-amber-500/40 bg-amber-950/20" },
  DEAD: { text: "text-red-300", ring: "border-red-500/40 bg-red-950/20" }
} as const;

const percent = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

export default function AdversaryPage() {
  // ?race=1 means a whole field was handed over by the Strategy Maker. That is
  // a different job from the single-strategy workbench below — a field is
  // ranked against itself, not tuned parameter by parameter — so it gets its
  // own view rather than being crammed into this one.
  const isRace = typeof window !== "undefined" && window.location.hash.includes("race=1");
  if (isRace) {
    return (
      <Layout showBackLink>
        <RaceView />
      </Layout>
    );
  }

  return <AdversaryWorkbench />;
}

function AdversaryWorkbench() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [session, store] = useSession();

  const [spec, setSpec] = useState<StrategySpec>(DEFAULT_SPEC);
  const [ticker, setTicker] = useState("SPY");
  const [uploaded, setUploaded] = useState<Bars | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [attacks, setAttacks] = useState<AttackResult[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // A shared link reproduces the rules and the verdict they earned, so a claim
  // arrives with its own refutation attached rather than as a screenshot.
  useEffect(() => {
    const shared = readPermalink();
    if (!shared) return;
    setSpec(shared.spec);
    if (shared.spec.universe) setTicker(shared.spec.universe);
    setNote(
      shared.verdict
        ? `Loaded a shared strategy that was judged ${shared.verdict.status} after ${shared.verdict.trialCount.toLocaleString()} trials. Re-run the attacks to verify it yourself.`
        : "Loaded a shared strategy."
    );
  }, []);

  // The series is fetched rather than bundled, so it arrives asynchronously.
  // Until it does there are no bars to test against, and every derived value
  // below has to tolerate that gap.
  const [fetched, setFetched] = useState<Bars | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (uploaded) return;
    let cancelled = false;
    setLoadError(null);
    loadInstrument(ticker)
      .then((next) => {
        // A slow response for a ticker the user has since moved off must not
        // overwrite the one they are actually looking at.
        if (!cancelled) setFetched(next);
      })
      .catch(() => {
        if (!cancelled) setLoadError(`Could not load price data for ${ticker}.`);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, uploaded]);

  const bars = uploaded ?? fetched;
  const issues = useMemo(() => validateSpec(spec), [spec]);

  // The backtest is cheap, so it re-runs live as the builder changes. Its
  // numbers stay provisional until the attacks have been run.
  const backtest = useMemo(() => {
    if (issues.length || !bars) return null;
    try {
      return runBacktest(spec, bars, DEFAULT_COSTS, new SignalCache(bars));
    } catch {
      return null;
    }
  }, [spec, bars, issues.length]);

  const challenged = attacks.length > 0 && !running;

  const upload = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = parseOhlcvCsv(await file.text(), file.name.replace(/\.csv$/i, ""));
      setUploaded(parsed);
      setAttacks([]);
      setVerdict(null);
      setNote(`${parsed.close.length.toLocaleString()} bars loaded from ${file.name}. This is your data, not ours.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "That CSV could not be read.");
    }
  };

  /**
   * Runs the six attacks in sequence, yielding to the event loop between each
   * so the UI can paint. The sequence being visible is the point — a verdict
   * that appears instantly reads as a lookup, not an investigation.
   */
  const attack = async () => {
    if (!backtest || !bars) return;
    setRunning(true);
    setAttacks([]);
    setVerdict(null);

    const cache = new SignalCache(bars);
    const { metrics, returns } = backtest;
    const breathe = () => new Promise((resolve) => setTimeout(resolve, 260));
    const collected: AttackResult[] = [];

    const push = async (label: string, run: () => AttackResult) => {
      setStage(label);
      await breathe();
      const result = run();
      collected.push(result);
      setAttacks([...collected]);
    };

    // Every backtest run counts against the search, including this one.
    store.recordTrials([metrics.sharpe]);
    const trialCount = session.trialCount + 1;

    await push("Charging the search cost…", () =>
      attackSearchCost(metrics.sharpe, metrics.skew, metrics.kurt, metrics.observations, session.trialSharpes, trialCount)
    );
    await push("Sweeping the parameter neighbourhood…", () =>
      attackParameterStability(spec, bars, DEFAULT_COSTS, cache)
    );
    await push("Partitioning by regime…", () => attackRegimeDependence(returns, bars.dates));
    await push("Adding friction…", () => attackCostSensitivity(spec, bars, cache));
    await push("Racing 400 random strategies…", () =>
      attackNoiseBenchmark(metrics.sharpe, bars, DEFAULT_COSTS, cache, 400, 20260821)
    );
    await push("Rebuilding history 120 times…", () =>
      attackSyntheticMarkets(spec, bars, DEFAULT_COSTS, 120, 4242)
    );
    await push("Pricing in the whole factor zoo…", () =>
      attackHaircut(metrics.sharpe, metrics.observations, trialCount)
    );
    await push("Cross-validating the selection rule…", () =>
      attackOverfitting(spec, bars, DEFAULT_COSTS, cache)
    );

    const finalVerdict = buildVerdict(collected, {
      sharpe: metrics.sharpe,
      skew: metrics.skew,
      kurt: metrics.kurt,
      observations: metrics.observations
    });

    // The 400 matched-random strategies are NOT charged as trials. They are a
    // control distribution the tool builds to measure against, not the user
    // searching for an edge to deploy. Charging them would inflate N by two
    // orders of magnitude and fail every strategy regardless of merit.
    store.recordVerdict(finalVerdict.status);

    setVerdict(finalVerdict);
    setStage(null);
    setRunning(false);
  };

  const health = Math.max(
    0,
    100 - attacks.reduce((cost, a) => cost + (a.status === "fail" ? 21 : a.status === "warn" ? 8 : 0), 0)
  );

  const share = async () => {
    const link = buildPermalink({
      spec,
      verdict: verdict
        ? {
            status: verdict.status,
            attacks: verdict.attacks.map((a) => ({
              id: a.id,
              name: a.name,
              status: a.status,
              headline: a.headline
            })),
            trialCount: session.trialCount
          }
        : undefined
    });
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNote("Could not reach the clipboard — copy the link from the address bar after sharing.");
    }
  };

  return (
    <Layout showBackLink>
      <section className="py-9">
        <ScrollReveal variant="rise">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="eyebrow">
                <Crosshair size={15} />
                Adversary
              </div>
              <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground">
                A backtester that tries
                <br />
                <span className="font-normal text-foreground/55">to prove your strategy is fake.</span>
              </h1>
            </div>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              Eight attacks run against your rules. Metrics stay provisional until they have all landed — you should not
              get to feel good about a number that has not been challenged.
            </p>
          </div>
        </ScrollReveal>

        {/* Running search cost — the counter the user cannot escape. */}
        <ScrollReveal variant="drift" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-signal/25 bg-signal/[0.06] px-5 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[.16em] text-signal-soft">Search cost</span>
            <span className="flex-1 text-sm text-zinc-300">
              {session.trialCount === 0
                ? "No strategies searched yet. Your first result will be judged against a single trial."
                : `${session.trialCount.toLocaleString()} strategies searched in this browser. Your significance threshold has risen accordingly.`}
            </span>
            {session.trialCount > 0 && (
              <button
                onClick={() => store.reset()}
                className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Reset counter
              </button>
            )}
          </div>
        </ScrollReveal>

        <div className="mt-6 grid gap-5 lg:grid-cols-[380px_1fr]">
          {/* Left: data + builder */}
          <ScrollReveal variant="drift" className="space-y-4">
            <div className="rounded-[24px] border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">01 / Data</span>
                {uploaded && (
                  <button
                    onClick={() => {
                      setUploaded(null);
                      setNote(null);
                      setAttacks([]);
                      setVerdict(null);
                    }}
                    aria-label="Clear uploaded data"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              {!uploaded && (
                <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
                  {INSTRUMENTS.map((series) => (
                    <button
                      key={series.ticker}
                      onClick={() => {
                        setTicker(series.ticker);
                        setSpec({ ...spec, universe: series.ticker });
                        setAttacks([]);
                        setVerdict(null);
                      }}
                      className={cn(
                        "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                        ticker === series.ticker
                          ? "border-signal/60 bg-signal/10"
                          : "border-border hover:border-zinc-600"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{series.label}</span>
                        <span className="font-mono text-[10px] text-zinc-600">{series.ticker}</span>
                        {!series.isReal && (
                          <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
                            synthetic
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{series.note}</div>
                    </button>
                  ))}
                </div>
              )}

              <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-700 px-4 py-3 transition hover:border-signal/60 hover:bg-signal/5">
                <Upload size={16} className="text-signal-soft" />
                <span className="text-xs leading-5 text-muted-foreground">
                  {uploaded ? `Using ${uploaded.ticker}` : "Or upload your own OHLCV CSV"}
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,.txt,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    upload(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>

              {note && <p className="mt-3 text-xs leading-5 text-signal-soft">{note}</p>}

              {/* Provenance and data depth, stated plainly — both govern what
                  any result on this page is actually worth. */}
              {!uploaded && (
                <div className="mt-3 space-y-2">
                  <p className="flex gap-2 text-[11px] leading-5 text-muted-foreground">
                    <CircleAlert size={13} className="mt-0.5 shrink-0" />
                    {instrumentByTicker(ticker)?.source ?? "Unknown source"}.
                  </p>
                  {bars && depthWarning(bars.close.length) && (
                    <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5 text-[11px] leading-5 text-amber-200/90">
                      <CircleAlert size={13} className="mt-0.5 shrink-0" />
                      {depthWarning(bars!.close.length)}
                    </p>
                  )}
                </div>
              )}
            </div>

            <StrategyCompiler
              universe={ticker}
              onCompiled={(next) => {
                setSpec(next);
                setAttacks([]);
                setVerdict(null);
              }}
            />

            <StrategyBuilder spec={spec} onChange={setSpec} issues={issues} ticker={uploaded ? uploaded.ticker : ticker} barCount={bars?.close.length ?? 0} />
          </ScrollReveal>

          {/* Right: result + attacks */}
          <ScrollReveal variant="drift" index={1} className="space-y-5">
            <div className="rounded-[24px] border border-border bg-card p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                    02 / Provisional result
                  </div>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-300">{describeSpec(spec)}</p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.12em]",
                    challenged ? "border-border text-muted-foreground" : "border-amber-500/40 text-amber-300"
                  )}
                >
                  {challenged ? "Challenged" : "Unchallenged"}
                </span>
              </div>

              {issues.length > 0 ? (
                <ul className="mt-5 space-y-1.5">
                  {issues.map((issue) => (
                    <li key={issue.field + issue.message} className="flex gap-2 text-xs text-red-300">
                      <CircleAlert size={13} className="mt-0.5 shrink-0" />
                      {issue.message}
                    </li>
                  ))}
                </ul>
              ) : backtest ? (
                <>
                  <div className="mt-5">
                    <SignalCard
                      result={backtest}
                      spec={spec}
                      bars={bars!}
                      verdict={challenged ? verdict : null}
                      instrumentLabel={uploaded ? uploaded.ticker : instrumentByTicker(ticker)?.label ?? ticker}
                    />
                  </div>

                  <div className={cn("mt-4", !challenged && "opacity-45 saturate-50")}>
                    <EquityCurve series={Array.from(backtest.equity)} />
                  </div>

                  <div className="mt-5">
                    <ActionButton onClick={attack} disabled={running || backtest.metrics.tradeCount === 0}>
                      {running ? stage ?? "Attacking…" : `Run the ${ATTACK_COUNT} attacks`}
                    </ActionButton>
                    {backtest.metrics.tradeCount === 0 && (
                      <p className="mt-2 text-xs text-amber-300">
                        This strategy never trades on this data, so there is nothing to attack.
                      </p>
                    )}
                  </div>
                </>
              ) : null}
            </div>

            {(running || attacks.length > 0) && (
              <div className="rounded-[24px] border border-border bg-card p-5 md:p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                    03 / Attacks
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {attacks.length}/{ATTACK_COUNT}
                  </span>
                </div>

                {/* Health bar — drops as attacks land. */}
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-700 ease-out",
                      health > 70 ? "bg-emerald-400" : health > 40 ? "bg-amber-400" : "bg-red-400"
                    )}
                    style={{ width: `${Math.max(health, 4)}%` }}
                  />
                </div>

                <div className="mt-5 space-y-3">
                  {attacks.map((result) => {
                    const style = STATUS_STYLE[result.status];
                    return (
                      <details key={result.id} className="group rounded-xl border border-border bg-background/50 p-4">
                        <summary className="flex cursor-pointer list-none items-center gap-3">
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", style.dot)} />
                          <span className="flex-1 text-sm font-medium text-foreground">{result.name}</span>
                          <span className="text-xs text-muted-foreground">{result.headline}</span>
                          <span className={cn("font-mono text-[10px] tracking-[.12em]", style.text)}>{style.label}</span>
                        </summary>
                        <p className="mt-3 text-xs italic leading-5 text-muted-foreground">{result.question}</p>
                        <p className="mt-2 text-sm leading-6 text-zinc-300">{result.explanation}</p>
                        <div className="mt-4">
                          <AttackChartView chart={result.chart} />
                        </div>
                      </details>
                    );
                  })}

                  {running && stage && (
                    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-signal" />
                      <span className="text-sm text-muted-foreground">{stage}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {verdict && (
              <div className={cn("rounded-[24px] border p-6", VERDICT_STYLE[verdict.status].ring)}>
                <div className="flex items-center gap-3">
                  <Skull size={18} className={VERDICT_STYLE[verdict.status].text} />
                  <span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                    04 / Verdict
                  </span>
                </div>
                <div
                  className={cn(
                    "mt-3 font-display text-6xl font-semibold tracking-[-.04em]",
                    VERDICT_STYLE[verdict.status].text
                  )}
                >
                  {verdict.status}
                </div>

                {verdict.reasons.length > 0 && (
                  <ul className="mt-5 space-y-2">
                    {verdict.reasons.map((reason) => (
                      <li key={reason} className="flex gap-2 text-sm leading-6 text-zinc-300">
                        <span className="text-muted-foreground">—</span>
                        {reason}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-5 border-t border-border/60 pt-4">
                  <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                    What would have to change
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">{verdict.remedy}</p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={share}
                    className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-signal/50 hover:text-foreground"
                  >
                    {copied ? <Check size={13} /> : <Link2 size={13} />}
                    {copied ? "Link copied" : "Copy a link to this verdict"}
                  </button>

                  {/* The spec travels in the hash, so the Back Tester starts
                      from exactly what was attacked here. */}
                  <a
                    href={buildPermalink({ spec }).replace("#/adversary?", "#/back-tester?")}
                    className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-signal/50 hover:text-foreground"
                  >
                    <Gauge size={13} />
                    Send to the Back Tester
                  </a>
                </div>
              </div>
            )}
          </ScrollReveal>
        </div>
      </section>
    </Layout>
  );
}
