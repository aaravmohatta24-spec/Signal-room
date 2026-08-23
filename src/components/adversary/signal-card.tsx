import { ArrowDown, ArrowUp, Minus, TriangleAlert } from "lucide-react";

import type { BacktestResult } from "@/lib/adversary/engine";
import type { Verdict } from "@/lib/adversary/attacks";
import type { StrategySpec } from "@/lib/adversary/spec";
import type { Bars } from "@/lib/adversary/signals";
import { annualise } from "@/lib/adversary/stats";
import { cn } from "@/lib/utils";

/**
 * The result panel: what the rule says right now, what it did historically, and
 * whether any of it withstood scrutiny.
 *
 * The ordering is deliberate. The current signal is the first thing a person
 * looks for, so hiding it would just push them to a worse tool — but it is
 * presented as the state of a rule, with the verdict attached to it, never as a
 * recommendation. A signal from a strategy that failed its tests is displayed
 * with that failure alongside it, not in a separate tab they can skip.
 */
const STANCE = {
  long: { label: "LONG", icon: ArrowUp, tone: "text-emerald-300", ring: "border-emerald-500/40 bg-emerald-950/25" },
  short: { label: "SHORT", icon: ArrowDown, tone: "text-red-300", ring: "border-red-500/40 bg-red-950/25" },
  flat: { label: "FLAT", icon: Minus, tone: "text-slate-300", ring: "border-border bg-muted/40" }
} as const;

const VERDICT_COPY: Record<Verdict["status"], { line: string; action: string }> = {
  SURVIVED: {
    line: "Nothing here managed to kill it.",
    action:
      "That is failure to disprove an edge, not proof of one. The honest next step is out-of-sample: paper-trade it forward and see whether the result holds on data it has never seen."
  },
  WOUNDED: {
    line: "It withstood most of the attacks, but not all of them.",
    action:
      "Treat this as a hypothesis worth tracking, not a plan worth funding. Fix the specific failure below before it goes anywhere near real money."
  },
  DEAD: {
    line: "This does not survive scrutiny.",
    action:
      "The historical numbers above are what a search of this size produces from luck alone. Do not trade this; the equity curve is the search talking, not an edge."
  }
};

const money = (v: number, dp = 2) =>
  v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(dp);
const pct = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;

/** Stop and target levels implied by the exit rules, from the entry price. */
function levelsFor(spec: StrategySpec, entry: number, direction: "long" | "short") {
  const sign = direction === "long" ? 1 : -1;
  const stop = spec.exits.find((e) => e.kind === "stop_loss");
  const target = spec.exits.find((e) => e.kind === "take_profit");
  const trail = spec.exits.find((e) => e.kind === "trailing_stop");
  const time = spec.exits.find((e) => e.kind === "time_stop");

  return {
    stop: stop && "pct" in stop ? entry * (1 - (sign * stop.pct) / 100) : null,
    stopPct: stop && "pct" in stop ? stop.pct : null,
    target: target && "pct" in target ? entry * (1 + (sign * target.pct) / 100) : null,
    targetPct: target && "pct" in target ? target.pct : null,
    trailPct: trail && "pct" in trail ? trail.pct : null,
    timeDays: time && "days" in time ? time.days : null
  };
}

export function SignalCard({
  result,
  spec,
  bars,
  verdict,
  instrumentLabel
}: {
  result: BacktestResult;
  spec: StrategySpec;
  bars: Bars;
  verdict: Verdict | null;
  instrumentLabel: string;
}) {
  const { stance, metrics } = result;
  const style = STANCE[stance.position];
  const Icon = style.icon;
  const lastPrice = bars.close[bars.close.length - 1];

  const open = stance.position !== "flat";
  const entryTrade = open ? result.trades[result.trades.length - 1] : null;
  // When a position is open there is no closed trade for it yet, so take the
  // entry from the stance rather than the trade log.
  const entryPrice = open
    ? lastPrice / (1 + (stance.unrealised ?? 0) * (stance.position === "long" ? 1 : -1))
    : null;
  const levels = entryPrice ? levelsFor(spec, entryPrice, stance.position as "long" | "short") : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Current signal */}
      <div className={cn("border-b border-border p-5", style.ring)}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
              Signal as of {stance.asOf}
            </div>
            <div className="mt-2 flex items-center gap-2.5">
              <Icon size={26} className={style.tone} aria-hidden />
              <span className={cn("font-display text-3xl font-semibold tracking-[-.018em]", style.tone)}>
                {style.label}
              </span>
              <span className="text-lg text-muted-foreground">{instrumentLabel}</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              {open ? (
                <>
                  Held {stance.barsHeld} bar{stance.barsHeld === 1 ? "" : "s"} since {stance.since}
                  {stance.unrealised !== null && (
                    <>
                      {" · "}
                      <span className={stance.unrealised >= 0 ? "text-emerald-300" : "text-red-300"}>
                        {pct(stance.unrealised)} open
                      </span>
                    </>
                  )}
                </>
              ) : (
                <>
                  No position. {stance.barsSinceSignal === null
                    ? "The entry condition has never been met on this data."
                    : `Entry condition last true ${stance.barsSinceSignal} bar${stance.barsSinceSignal === 1 ? "" : "s"} ago.`}
                </>
              )}
            </p>
          </div>

          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Last close</div>
            <div className="mt-1 font-display text-2xl font-semibold tracking-[-.018em] text-foreground">
              {money(lastPrice)}
            </div>
          </div>
        </div>

        {/* Levels the rule implies, only when a position is actually open. */}
        {open && levels && entryPrice && (
          <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
            {[
              ["Entry", money(entryPrice), "text-foreground"],
              [
                "Stop",
                levels.stop ? `${money(levels.stop)} (${levels.stopPct}%)` : levels.trailPct ? `${levels.trailPct}% trail` : "—",
                levels.stop || levels.trailPct ? "text-red-300" : "text-muted-foreground"
              ],
              [
                "Target",
                levels.target ? `${money(levels.target)} (${levels.targetPct}%)` : "on signal reversal",
                levels.target ? "text-emerald-300" : "text-muted-foreground"
              ],
              [
                "Time stop",
                levels.timeDays ? `${levels.timeDays - stance.barsHeld} bars left` : "none",
                "text-foreground"
              ]
            ].map(([label, value, tone]) => (
              <div key={label} className="bg-card px-3 py-2.5">
                <div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">{label}</div>
                <div className={cn("mt-1 text-sm", tone)}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historical record */}
      <div className="p-5">
        <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
          Historical record ({(metrics.observations / 252).toFixed(0)} years)
        </div>
        <div className="mt-3 grid gap-px overflow-hidden rounded-xl border border-border bg-border grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Total return", pct(metrics.totalReturn, 0)],
            ["CAGR", pct(metrics.cagr)],
            ["Sharpe", annualise(metrics.sharpe).toFixed(2)],
            ["Max drawdown", pct(-metrics.maxDrawdown, 0)],
            ["Win rate", `${(metrics.winRate * 100).toFixed(0)}%`],
            ["Trades", String(metrics.tradeCount)]
          ].map(([label, value]) => (
            <div key={label} className="bg-card px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">{label}</div>
              <div className="mt-1 text-base text-foreground">{value}</div>
            </div>
          ))}
        </div>

        {/* The verdict, in plain language, attached to the signal above. */}
        {verdict ? (
          <div className="mt-4 rounded-xl border border-border bg-background/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[.12em]",
                  verdict.status === "SURVIVED"
                    ? "border-emerald-500/40 bg-emerald-950/25 text-emerald-300"
                    : verdict.status === "WOUNDED"
                      ? "border-amber-500/40 bg-amber-950/25 text-amber-300"
                      : "border-red-500/40 bg-red-950/25 text-red-300"
                )}
              >
                {verdict.status}
              </span>
              <span className="text-sm font-medium text-foreground">{VERDICT_COPY[verdict.status].line}</span>
            </div>

            <p className="mt-2.5 text-sm leading-6 text-slate-400">{VERDICT_COPY[verdict.status].action}</p>

            {verdict.reasons.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                {verdict.reasons.slice(0, 3).map((reason) => (
                  <li key={reason} className="flex gap-2 text-xs leading-5 text-slate-400">
                    <span className="text-muted-foreground">—</span>
                    {reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-4 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs leading-5 text-amber-200/90">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            These figures have not been challenged yet. Run the attacks before drawing any conclusion from them — a
            good-looking record is exactly what an overfit strategy produces.
          </p>
        )}
      </div>
    </div>
  );
}
