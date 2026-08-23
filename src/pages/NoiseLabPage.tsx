import { useEffect, useRef, useState } from "react";
import { CircleAlert, Dices } from "lucide-react";

import Layout from "@/components/Layout";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { ActionButton } from "@/components/ui/action-button";
import { EquityCurve } from "@/components/adversary/charts";
import { INSTRUMENTS, instrumentByTicker } from "@/lib/adversary/instruments";
import { describeSpec } from "@/lib/adversary/spec";
import { useSession } from "@/lib/adversary/session";
import type { SweepArmResult, SweepMessage } from "@/lib/adversary/sweep.worker";
import { cn } from "@/lib/utils";

const SWEEP_SIZE = 1000;

/**
 * The demonstration (§7.6c).
 *
 * Run the same search twice — once against data with structure, once against a
 * zero-drift random walk — and show the winner of each. They look the same.
 * That is the entire argument, and it needs no finance background to follow.
 */
export default function NoiseLabPage() {
  const workerRef = useRef<Worker | null>(null);
  const [, store] = useSession();

  const [ticker, setTicker] = useState("SPY");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: SWEEP_SIZE, arm: "real" as "real" | "noise" });
  const [arms, setArms] = useState<SweepArmResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  const run = () => {
    setRunning(true);
    setArms(null);
    setError(null);
    setProgress({ done: 0, total: SWEEP_SIZE, arm: "real" });

    workerRef.current?.terminate();
    const worker = new Worker(new URL("../lib/adversary/sweep.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<SweepMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        setProgress({ done: message.done, total: message.total, arm: message.arm });
      } else if (message.type === "complete") {
        setArms(message.arms);
        setRunning(false);
        // Both arms count against the search budget — using the generator is
        // supposed to make the user's own significance bar harder to clear.
        const all = message.arms.flatMap((arm) => arm.sharpes);
        store.recordTrials(all, true);
        worker.terminate();
      } else {
        setError(message.message);
        setRunning(false);
        worker.terminate();
      }
    };

    worker.onerror = () => {
      setError("The sweep worker failed to start.");
      setRunning(false);
    };

    worker.postMessage({ type: "sweep", ticker, count: SWEEP_SIZE, seed: 20260821, includeNoiseControl: true });
  };

  const real = arms?.find((a) => a.arm === "real");
  const noise = arms?.find((a) => a.arm === "noise");
  const pct = ((progress.done / progress.total) * 100).toFixed(0);

  return (
    <Layout showBackLink>
      <section className="py-9">
        <ScrollReveal variant="rise">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="eyebrow">
                <Dices size={15} />
                The demonstration
              </div>
              <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.02] tracking-[-.018em] text-foreground">
                One of these is real.
                <br />
                <span className="font-normal text-foreground/55">One is pure noise.</span>
              </h1>
            </div>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              The same search of {SWEEP_SIZE.toLocaleString()} strategies, run twice: once against data with structure,
              once against a random walk with zero drift. Compare the winners.
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal variant="drift" className="mt-6">
          <div className="rounded-[24px] border border-border bg-card p-5 md:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex-1">
                <span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
                  Search this series
                </span>
                <div className="mt-3 flex flex-wrap gap-2">
                  {INSTRUMENTS.filter((s) => s.isReal).map((series) => (
                    <button
                      key={series.ticker}
                      disabled={running}
                      onClick={() => setTicker(series.ticker)}
                      className={cn(
                        "rounded-full border px-4 py-2 text-xs transition-colors disabled:opacity-50",
                        ticker === series.ticker
                          ? "border-signal/60 bg-signal/10 text-foreground"
                          : "border-border text-muted-foreground hover:border-slate-600"
                      )}
                    >
                      {series.label}
                    </button>
                  ))}
                </div>
              </div>

              <ActionButton onClick={run} disabled={running}>
                {running ? `Searching ${pct}%` : `Search ${SWEEP_SIZE.toLocaleString()} strategies`}
              </ActionButton>
            </div>

            {running && (
              <div className="mt-5">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                  <span>{progress.arm === "real" ? "Searching real data" : "Searching pure noise"}</span>
                  <span>
                    {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-signal transition-all duration-200"
                    style={{ width: `${pct}%` }}
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

        {real && noise && (
          <>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {[
                { arm: real, title: "Best of 1,000 — real data", tone: "signal" as const },
                { arm: noise, title: "Best of 1,000 — pure noise", tone: "muted" as const }
              ].map(({ arm, title, tone }) => (
                <ScrollReveal
                  key={arm.arm}
                  variant={tone === "signal" ? "drift" : "drift-right"}
                  className="rounded-[24px] border border-border bg-card p-5"
                >
                  <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">{title}</div>
                  <div className="mt-3 flex items-baseline gap-4">
                    <span className="font-display text-4xl font-semibold tracking-[-.018em] text-foreground">
                      {arm.best.sharpeAnnual.toFixed(2)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Sharpe · {(arm.best.totalReturn * 100).toFixed(0)}% total
                    </span>
                  </div>
                  <div className="mt-4">
                    <EquityCurve
                      series={arm.best.equity}
                      stroke={tone === "signal" ? "rgb(var(--color-signal))" : "rgb(var(--color-muted-foreground))"}
                    />
                  </div>
                  <p className="mt-4 text-xs leading-5 text-muted-foreground">{describeSpec(arm.best.spec)}</p>
                </ScrollReveal>
              ))}
            </div>

            <ScrollReveal variant="settle" className="mt-5">
              <div className="rounded-[24px] border border-signal/30 bg-signal/[0.06] p-6">
                <div className="font-mono text-[10px] uppercase tracking-[.16em] text-signal-soft">What just happened</div>
                <p className="mt-3 max-w-3xl text-[15px] leading-7 text-slate-200">
                  The right-hand curve was found on data with{" "}
                  <strong className="font-semibold text-foreground">no structure at all</strong> — a random walk with
                  zero drift, where no edge can exist by construction. It still produced a Sharpe of{" "}
                  <strong className="font-semibold text-foreground">{noise.best.sharpeAnnual.toFixed(2)}</strong> and a
                  rising equity curve, because searching {SWEEP_SIZE.toLocaleString()} strategies and keeping the best
                  one is enough to manufacture that on its own.
                </p>
                <p className="mt-3 max-w-3xl text-[15px] leading-7 text-slate-200">
                  This is why an equity curve is not evidence. The question is never "does it look good" but "how many
                  did you try before this one looked good" — which is exactly what the Adversary's first attack charges
                  you for.
                </p>
                <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
                  {[
                    ["Real — best Sharpe", real.best.sharpeAnnual.toFixed(2)],
                    ["Noise — best Sharpe", noise.best.sharpeAnnual.toFixed(2)],
                    ["Strategies searched", (real.sharpes.length + noise.sharpes.length).toLocaleString()]
                  ].map(([label, value]) => (
                    <div key={label} className="bg-card px-4 py-3">
                      <div className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">
                        {label}
                      </div>
                      <div className="mt-1.5 text-xl text-foreground">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </ScrollReveal>
          </>
        )}
      </section>
    </Layout>
  );
}
