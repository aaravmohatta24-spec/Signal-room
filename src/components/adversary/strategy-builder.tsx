import { Shuffle, TriangleAlert } from "lucide-react";

import { COMPARATORS, PERIOD_RANGE, SIGNAL_KINDS, type Comparator, type SignalKind, type StrategySpec, type ValidationIssue } from "@/lib/adversary/spec";
import { randomSpec } from "@/lib/adversary/generator";
import { instrumentByTicker, maxLookbackFor } from "@/lib/adversary/instruments";
import { playbookFor } from "@/lib/adversary/playbook";
import { cn } from "@/lib/utils";

/**
 * Visual strategy builder.
 *
 * Built against the grammar directly, so it can only ever produce specs the
 * engine understands — there is no path from this UI to an invalid strategy
 * beyond out-of-range numbers, which the validator catches and reports inline.
 */
const COMPARATOR_LABEL: Record<Comparator, string> = {
  greater_than: "is above",
  less_than: "is below",
  crosses_above: "crosses above",
  crosses_below: "crosses below"
};

const SIGNAL_LABEL: Record<SignalKind, string> = {
  sma: "Simple MA",
  ema: "Exponential MA",
  rsi: "RSI",
  zscore: "Z-score",
  momentum: "Momentum",
  volatility: "Volatility",
  price: "Price",
  volume_ratio: "Volume ratio",
  supertrend: "Supertrend direction",
  donchian: "Donchian range position"
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const controlClass =
  "w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-signal";

export function StrategyBuilder({
  spec,
  onChange,
  issues,
  ticker,
  barCount
}: {
  spec: StrategySpec;
  onChange: (next: StrategySpec) => void;
  issues: ValidationIssue[];
  /** Instrument the generated strategy should target. */
  ticker?: string;
  /** Length of that instrument's series, used to cap lookbacks. */
  barCount?: number;
}) {
  // Strategies are drawn from the grammar rather than loaded from a fixed list,
  // and lookbacks are capped against the length of the series so nothing is
  // generated that the available data cannot evaluate.
  const targetTicker = ticker ?? spec.universe;
  const targetClass = instrumentByTicker(targetTicker)?.assetClass ?? "stock";
  const playbook = playbookFor(targetClass);

  const generate = () => {
    const cap = barCount ? maxLookbackFor(barCount) : Infinity;
    const next = randomSpec(Math.random, ticker ?? spec.universe, Math.floor(Math.random() * 1e6), cap);
    onChange({ ...next, universe: ticker ?? spec.universe });
  };

  const update = (mutate: (draft: StrategySpec) => void) => {
    const next = structuredClone(spec);
    mutate(next);
    onChange(next);
  };

  const rightIsSignal = "kind" in spec.entry.right;
  const stopLoss = spec.exits.find((e) => e.kind === "stop_loss");
  const takeProfit = spec.exits.find((e) => e.kind === "take_profit");

  const toggleExit = (kind: "stop_loss" | "take_profit", enabled: boolean, pct: number) =>
    update((draft) => {
      draft.exits = draft.exits.filter((e) => e.kind !== kind);
      if (enabled) draft.exits.push({ kind, pct } as never);
    });

  return (
    <div className="rounded-[24px] border border-border bg-card p-5">
      <span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">02 / Strategy</span>

      {/* Two ways in: a known setup, or a fresh draw from the grammar. */}
      <div className="mt-4 space-y-3">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
            Load a known strategy
          </span>
          <div className="mt-2 grid gap-1.5">
            {playbook.map((entry) => {
              const active = spec.name === entry.build(targetTicker, targetClass).name;
              return (
                <button
                  key={entry.id}
                  onClick={() => onChange(entry.build(targetTicker, targetClass))}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    active ? "border-signal/60 bg-signal/10" : "border-border hover:border-slate-600"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground">{entry.name}</span>
                    <span className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
                      {entry.family}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{entry.premise}</p>
                  {active && (
                    <p className="mt-1.5 flex gap-1.5 text-xs leading-5 text-amber-300/85">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                      {entry.caveat}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            Parameters adapt to the asset class — a 2σ band means something different on a currency cross than on a
            small-cap index.
          </p>
        </div>

        <button
          onClick={generate}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground transition-colors hover:border-signal/60 hover:bg-signal/5"
        >
          <Shuffle size={15} className="text-signal-soft" />
          Or generate a random one
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <Field label="Direction">
          <div className="grid grid-cols-2 gap-2">
            {(["long", "short"] as const).map((direction) => (
              <button
                key={direction}
                onClick={() => update((draft) => void (draft.entry.direction = direction))}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm capitalize transition-colors",
                  spec.entry.direction === direction
                    ? "border-signal/60 bg-signal/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-slate-600"
                )}
              >
                {direction}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Signal">
            <select
              className={controlClass}
              value={spec.entry.left.kind}
              onChange={(event) =>
                update((draft) => {
                  const kind = event.target.value as SignalKind;
                  draft.entry.left.kind = kind;
                  const [min, max] = PERIOD_RANGE[kind];
                  draft.entry.left.period = Math.min(Math.max(draft.entry.left.period, min), max);
                })
              }
            >
              {SIGNAL_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {SIGNAL_LABEL[kind]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Lookback">
            <input
              type="number"
              className={controlClass}
              value={spec.entry.left.period}
              disabled={spec.entry.left.kind === "price"}
              onChange={(event) => update((draft) => void (draft.entry.left.period = Number(event.target.value)))}
            />
          </Field>
        </div>

        <Field label="Condition">
          <select
            className={controlClass}
            value={spec.entry.comparator}
            onChange={(event) => update((draft) => void (draft.entry.comparator = event.target.value as Comparator))}
          >
            {COMPARATORS.map((comparator) => (
              <option key={comparator} value={comparator}>
                {COMPARATOR_LABEL[comparator]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Compared against">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() =>
                update((draft) => {
                  draft.entry.right = { kind: "sma", period: 200 };
                })
              }
              className={cn(
                "rounded-lg border px-3 py-2 text-sm transition-colors",
                rightIsSignal ? "border-signal/60 bg-signal/10 text-foreground" : "border-border text-muted-foreground"
              )}
            >
              Another signal
            </button>
            <button
              onClick={() => update((draft) => void (draft.entry.right = { constant: 30 }))}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm transition-colors",
                !rightIsSignal ? "border-signal/60 bg-signal/10 text-foreground" : "border-border text-muted-foreground"
              )}
            >
              A number
            </button>
          </div>
        </Field>

        {rightIsSignal && "kind" in spec.entry.right ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Signal">
              <select
                className={controlClass}
                value={spec.entry.right.kind}
                onChange={(event) =>
                  update((draft) => {
                    if (!("kind" in draft.entry.right)) return;
                    const kind = event.target.value as SignalKind;
                    draft.entry.right.kind = kind;
                    const [min, max] = PERIOD_RANGE[kind];
                    draft.entry.right.period = Math.min(Math.max(draft.entry.right.period, min), max);
                  })
                }
              >
                {SIGNAL_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {SIGNAL_LABEL[kind]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lookback">
              <input
                type="number"
                className={controlClass}
                value={spec.entry.right.period}
                disabled={spec.entry.right.kind === "price"}
                onChange={(event) =>
                  update((draft) => {
                    if ("kind" in draft.entry.right) draft.entry.right.period = Number(event.target.value);
                  })
                }
              />
            </Field>
          </div>
        ) : (
          <Field label="Threshold">
            <input
              type="number"
              className={controlClass}
              value={"constant" in spec.entry.right ? spec.entry.right.constant : 0}
              onChange={(event) =>
                update((draft) => {
                  if (!("kind" in draft.entry.right)) draft.entry.right.constant = Number(event.target.value);
                })
              }
            />
          </Field>
        )}

        <div className="border-t border-border pt-4">
          <span className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Exits</span>

          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3">
              <input
                id="stop-loss"
                type="checkbox"
                checked={Boolean(stopLoss)}
                onChange={(event) => toggleExit("stop_loss", event.target.checked, 5)}
                className="h-4 w-4 accent-[rgb(var(--color-signal))]"
              />
              <label htmlFor="stop-loss" className="flex-1 text-sm text-slate-300">
                Stop loss
              </label>
              <input
                type="number"
                className="w-20 rounded-lg border border-border bg-muted px-2 py-1 text-sm text-foreground outline-none focus:border-signal"
                value={stopLoss && "pct" in stopLoss ? stopLoss.pct : 5}
                disabled={!stopLoss}
                onChange={(event) => toggleExit("stop_loss", true, Number(event.target.value))}
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                id="take-profit"
                type="checkbox"
                checked={Boolean(takeProfit)}
                onChange={(event) => toggleExit("take_profit", event.target.checked, 10)}
                className="h-4 w-4 accent-[rgb(var(--color-signal))]"
              />
              <label htmlFor="take-profit" className="flex-1 text-sm text-slate-300">
                Take profit
              </label>
              <input
                type="number"
                className="w-20 rounded-lg border border-border bg-muted px-2 py-1 text-sm text-foreground outline-none focus:border-signal"
                value={takeProfit && "pct" in takeProfit ? takeProfit.pct : 10}
                disabled={!takeProfit}
                onChange={(event) => toggleExit("take_profit", true, Number(event.target.value))}
              />
            </div>
          </div>
        </div>

        <Field label="Position sizing">
          <select
            className={controlClass}
            value={spec.sizing.kind}
            onChange={(event) =>
              update((draft) => {
                const kind = event.target.value as StrategySpec["sizing"]["kind"];
                draft.sizing =
                  kind === "fixed_fraction"
                    ? { kind, pct: 100 }
                    : kind === "inverse_volatility"
                      ? { kind, lookback: 30 }
                      : { kind: "equal_weight" };
              })
            }
          >
            <option value="fixed_fraction">Fixed fraction</option>
            <option value="inverse_volatility">Inverse volatility</option>
            <option value="equal_weight">Full exposure</option>
          </select>
        </Field>

        {issues.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-red-500/30 bg-red-950/20 p-3">
            {issues.map((issue) => (
              <li key={issue.field + issue.message} className="text-xs leading-5 text-red-300">
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
