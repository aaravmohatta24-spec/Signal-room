/**
 * The strategy grammar (§7.1).
 *
 * Strategies are composed from a constrained grammar rather than arbitrary
 * code. That makes execution safe and deterministic, and — the reason it
 * matters here — makes the search space enumerable, which is what the generator
 * needs in order to measure the null distribution of Sharpe ratios.
 */

export const SIGNAL_KINDS = [
  "sma",
  "ema",
  "rsi",
  "zscore",
  "momentum",
  "volatility",
  "price",
  "volume_ratio",
  "supertrend",
  "donchian"
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

export type SignalSpec = {
  kind: SignalKind;
  /** Lookback in bars. Ignored by `price`. */
  period: number;
};

export const COMPARATORS = ["greater_than", "less_than", "crosses_above", "crosses_below"] as const;
export type Comparator = (typeof COMPARATORS)[number];

export type EntryRule = {
  left: SignalSpec;
  comparator: Comparator;
  /** Compare against another signal, or against a constant threshold. */
  right: SignalSpec | { constant: number };
  /** Long on true, or short on true. */
  direction: "long" | "short";
};

export type ExitRule =
  | { kind: "opposite_signal" }
  | { kind: "stop_loss"; pct: number }
  | { kind: "take_profit"; pct: number }
  | { kind: "time_stop"; days: number }
  | { kind: "trailing_stop"; pct: number };

export type SizingRule =
  | { kind: "fixed_fraction"; pct: number }
  | { kind: "inverse_volatility"; lookback: number }
  | { kind: "equal_weight" };

export type StrategySpec = {
  name: string;
  universe: string;
  entry: EntryRule;
  exits: ExitRule[];
  sizing: SizingRule;
};

/** Permitted parameter ranges, used for validation and by the generator. */
export const PERIOD_RANGE: Record<SignalKind, [number, number]> = {
  sma: [5, 250],
  ema: [5, 250],
  // Lower bound is 2, not 5: Connors' RSI(2) is a well-known short-term
  // reversal setup, and excluding it would put a strategy people actually run
  // outside the grammar the tool can judge.
  rsi: [2, 50],
  zscore: [10, 120],
  momentum: [5, 250],
  volatility: [10, 120],
  price: [1, 1],
  volume_ratio: [5, 60],
  // Supertrend's ATR lookback. 10 is conventional; below ~7 it flips on noise.
  supertrend: [7, 30],
  // Donchian breakout window. 20 and 55 are the classic turtle pair.
  donchian: [10, 120]
};

export const PCT_RANGE: [number, number] = [0.5, 25];
export const TIME_STOP_RANGE: [number, number] = [2, 120];

/** Signals whose natural comparison is against a constant, not another series. */
export const BOUNDED_SIGNALS: SignalKind[] = [
  "rsi", "zscore", "momentum", "volume_ratio",
  // Both are compared against a level, never against another series: supertrend
  // is a direction (+1/-1) and donchian is a 0-100 position in its own range.
  "supertrend", "donchian"
];

export type ValidationIssue = { field: string; message: string };

/**
 * Deterministic validation (§7.2). This runs on every spec regardless of where
 * it came from — the generator, the visual builder, or a parsed description —
 * so that no invalid strategy can reach the engine.
 */
export function validateSpec(spec: StrategySpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const checkSignal = (signal: SignalSpec, field: string) => {
    if (!SIGNAL_KINDS.includes(signal.kind)) {
      issues.push({ field, message: `Unknown signal "${signal.kind}".` });
      return;
    }
    const [min, max] = PERIOD_RANGE[signal.kind];
    if (!Number.isFinite(signal.period) || signal.period < min || signal.period > max) {
      issues.push({ field, message: `${signal.kind} period must be between ${min} and ${max}.` });
    }
  };

  checkSignal(spec.entry.left, "entry.left");
  if ("kind" in spec.entry.right) {
    checkSignal(spec.entry.right, "entry.right");
    // Crossover between two different signal families is legal but comparing a
    // bounded oscillator against a price series is a unit mismatch.
    const leftBounded = BOUNDED_SIGNALS.includes(spec.entry.left.kind);
    const rightBounded = BOUNDED_SIGNALS.includes(spec.entry.right.kind);
    if (leftBounded !== rightBounded) {
      issues.push({
        field: "entry",
        message: "Cannot compare a bounded oscillator against a price-scale signal."
      });
    }
  } else if (!Number.isFinite(spec.entry.right.constant)) {
    issues.push({ field: "entry.right", message: "Threshold must be a number." });
  }

  if (!COMPARATORS.includes(spec.entry.comparator)) {
    issues.push({ field: "entry.comparator", message: "Unknown comparator." });
  }

  if (!spec.exits.length) {
    issues.push({ field: "exits", message: "At least one exit rule is required." });
  }

  for (const [i, exit] of spec.exits.entries()) {
    if ("pct" in exit && (exit.pct < PCT_RANGE[0] || exit.pct > PCT_RANGE[1])) {
      issues.push({ field: `exits[${i}]`, message: `Percentage must be ${PCT_RANGE[0]}–${PCT_RANGE[1]}%.` });
    }
    if (exit.kind === "time_stop" && (exit.days < TIME_STOP_RANGE[0] || exit.days > TIME_STOP_RANGE[1])) {
      issues.push({ field: `exits[${i}]`, message: `Time stop must be ${TIME_STOP_RANGE[0]}–${TIME_STOP_RANGE[1]} days.` });
    }
  }

  if (spec.sizing.kind === "fixed_fraction" && (spec.sizing.pct <= 0 || spec.sizing.pct > 100)) {
    issues.push({ field: "sizing", message: "Exposure must be between 0 and 100%." });
  }

  return issues;
}

/** Stable, human-readable description used in the UI and in share links. */
export function describeSpec(spec: StrategySpec): string {
  const signalText = (s: SignalSpec) => (s.kind === "price" ? "price" : `${s.kind}(${s.period})`);
  const comparatorText: Record<Comparator, string> = {
    greater_than: "is above",
    less_than: "is below",
    crosses_above: "crosses above",
    crosses_below: "crosses below"
  };
  const right = "kind" in spec.entry.right ? signalText(spec.entry.right) : String(spec.entry.right.constant);
  const exits = spec.exits
    .map((exit) => {
      switch (exit.kind) {
        case "opposite_signal":
          return "the signal reverses";
        case "stop_loss":
          return `a ${exit.pct}% stop`;
        case "take_profit":
          return `a ${exit.pct}% target`;
        case "time_stop":
          return `${exit.days} days elapse`;
        case "trailing_stop":
          return `a ${exit.pct}% trailing stop`;
      }
    })
    .join(", or ");

  return `Go ${spec.entry.direction} when ${signalText(spec.entry.left)} ${comparatorText[spec.entry.comparator]} ${right}. Exit when ${exits}.`;
}

/** Numeric parameters exposed to the stability sweep (§7.4, attack 2). */
export function numericParams(spec: StrategySpec): { path: string; value: number; min: number; max: number }[] {
  const params: { path: string; value: number; min: number; max: number }[] = [];

  if (spec.entry.left.kind !== "price") {
    const [min, max] = PERIOD_RANGE[spec.entry.left.kind];
    params.push({ path: "entry.left.period", value: spec.entry.left.period, min, max });
  }

  if ("kind" in spec.entry.right && spec.entry.right.kind !== "price") {
    const [min, max] = PERIOD_RANGE[spec.entry.right.kind];
    params.push({ path: "entry.right.period", value: spec.entry.right.period, min, max });
  } else if (!("kind" in spec.entry.right)) {
    params.push({ path: "entry.right.constant", value: spec.entry.right.constant, min: -100, max: 100 });
  }

  return params;
}

/** Immutably set one of the paths produced by `numericParams`. */
export function withParam(spec: StrategySpec, path: string, value: number): StrategySpec {
  const next: StrategySpec = structuredClone(spec);
  if (path === "entry.left.period") next.entry.left.period = Math.round(value);
  if (path === "entry.right.period" && "kind" in next.entry.right) next.entry.right.period = Math.round(value);
  if (path === "entry.right.constant" && !("kind" in next.entry.right)) next.entry.right.constant = value;
  return next;
}
