import Anthropic from "@anthropic-ai/sdk";

import {
  BOUNDED_SIGNALS,
  PERIOD_RANGE,
  SIGNAL_KINDS,
  validateSpec,
  type Comparator,
  type ExitRule,
  type SignalKind,
  type SignalSpec,
  type StrategySpec,
  type ValidationIssue
} from "./spec";

/**
 * English → strategy spec compiler (§7.2).
 *
 * Two independent paths, in this order:
 *
 *  1. `parseLocally` — a deterministic phrase parser that runs offline, with no
 *     key and no network. It handles the shapes people actually type ("50-day
 *     moving average crosses above the 200-day, 5% stop").
 *  2. `compileWithClaude` — a single Claude call for anything the local parser
 *     cannot reach, constrained by a system prompt containing the grammar.
 *
 * BOTH paths terminate in the same deterministic validator. The model returns
 * PARAMETERS, never logic, and nothing it produces reaches the engine without
 * passing `validateSpec`. That is a safety property (no arbitrary execution)
 * and a correctness property (no out-of-range or lookahead-capable spec).
 *
 * The compiler is never a dead end: whatever it manages to extract is returned
 * as a spec for the visual builder to display, alongside the issues that stopped
 * it being accepted outright.
 */

export type CompileResult = {
  spec: StrategySpec;
  /** Empty when the spec is accepted as-is. */
  issues: ValidationIssue[];
  source: "local" | "claude";
  /** Plain-English notes about what was and was not understood. */
  notes: string[];
};

/** The spec every compile starts from, so a partial parse is still runnable. */
export const BASE_SPEC: StrategySpec = {
  name: "Compiled strategy",
  universe: "SYN-BROAD",
  entry: {
    left: { kind: "sma", period: 50 },
    comparator: "crosses_above",
    right: { kind: "sma", period: 200 },
    direction: "long"
  },
  exits: [{ kind: "opposite_signal" }],
  sizing: { kind: "fixed_fraction", pct: 100 }
};

/* ------------------------------------------------------------------ */
/* Local deterministic parser                                          */
/* ------------------------------------------------------------------ */

const SIGNAL_PHRASES: { pattern: RegExp; kind: SignalKind }[] = [
  { pattern: /\bexponential\s+moving\s+average|\bema\b/i, kind: "ema" },
  { pattern: /\bsimple\s+moving\s+average|\bmoving\s+average\b|\bsma\b|\bmoving\s+avg\b/i, kind: "sma" },
  { pattern: /\brsi\b|\brelative\s+strength\b/i, kind: "rsi" },
  { pattern: /\bz[-\s]?score\b/i, kind: "zscore" },
  { pattern: /\bmomentum\b/i, kind: "momentum" },
  { pattern: /\bvolatilit(y|ies)\b/i, kind: "volatility" },
  { pattern: /\bvolume\b/i, kind: "volume_ratio" },
  { pattern: /\bprice\b|\bclose\b/i, kind: "price" }
];

const clampPeriod = (kind: SignalKind, period: number): number => {
  const [min, max] = PERIOD_RANGE[kind];
  return Math.min(Math.max(Math.round(period), min), max);
};

/**
 * Deterministic phrase parser. Conservative by design: it only claims what it
 * can positively identify, and reports everything it fell back on so the user
 * can see exactly which parts of their sentence were understood.
 */
export function parseLocally(text: string): CompileResult {
  const input = text.toLowerCase();
  const spec: StrategySpec = structuredClone(BASE_SPEC);
  const notes: string[] = [];

  // Direction.
  if (/\b(short|sell\s+when|go\s+short|bearish)\b/.test(input) && !/\blong\b/.test(input)) {
    spec.entry.direction = "short";
  } else {
    spec.entry.direction = "long";
  }

  // Comparator.
  if (/\bcross(es|ing)?\s+(above|over)\b|\bgolden\s+cross\b/.test(input)) spec.entry.comparator = "crosses_above";
  else if (/\bcross(es|ing)?\s+(below|under)\b|\bdeath\s+cross\b/.test(input)) spec.entry.comparator = "crosses_below";
  else if (/\b(above|greater\s+than|over|exceeds?|more\s+than)\b/.test(input)) spec.entry.comparator = "greater_than";
  else if (/\b(below|less\s+than|under|drops?\s+under|falls?\s+below)\b/.test(input)) spec.entry.comparator = "less_than";
  else notes.push("No comparison phrase found — defaulted to a crossover.");

  // Signal family. The first phrase that matches wins, since users lead with
  // the indicator they mean.
  const matched = SIGNAL_PHRASES.find((entry) => entry.pattern.test(input));
  const kind: SignalKind = matched?.kind ?? "sma";
  if (!matched) notes.push("No indicator recognised — defaulted to a simple moving average.");

  // Lookback periods: "50-day", "50 day", "sma(50)", or bare numbers.
  const periods = [...input.matchAll(/(\d+)[-\s]*(?:day|period|bar)?/g)]
    .map((match) => Number(match[1]))
    .filter((n) => Number.isFinite(n) && n > 0);

  // Percentages attach to exits, so keep them out of the period pool.
  const percents = [...input.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent)/g)].map((m) => Number(m[1]));
  const periodPool = periods.filter((n) => !percents.includes(n));

  spec.entry.left = { kind, period: clampPeriod(kind, periodPool[0] ?? PERIOD_RANGE[kind][0] * 2) };

  if (BOUNDED_SIGNALS.includes(kind)) {
    // Oscillators compare against a level, not another series. Prefer a number
    // that reads like a threshold over one that reads like a lookback.
    const threshold = periodPool[1] ?? (kind === "rsi" ? 30 : 0);
    spec.entry.right = { constant: threshold };
  } else {
    const rightKind: SignalKind = kind === "price" ? "sma" : kind;
    spec.entry.right = {
      kind: rightKind,
      period: clampPeriod(rightKind, periodPool[1] ?? spec.entry.left.period * 4)
    };
    if (periodPool.length < 2) notes.push("Only one lookback found — the second was inferred.");
  }

  // Exits.
  const exits: ExitRule[] = [{ kind: "opposite_signal" }];
  const stopMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)?\s*(?:trailing\s+stop)/);
  const plainStop = input.match(/(?:stop(?:\s+loss)?(?:\s+(?:of|at))?\s*)(\d+(?:\.\d+)?)\s*(?:%|percent)?/);
  const stopAfter = input.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*stop/);
  const takeMatch = input.match(
    /(?:take\s+profit|profit\s+target|target)(?:\s+(?:of|at))?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:take\s+profit|target)/
  );
  const timeMatch = input.match(/(?:after|hold(?:ing)?(?:\s+for)?|time\s+stop(?:\s+of)?)\s*(\d+)\s*(?:day|bar)/);

  if (stopMatch) exits.push({ kind: "trailing_stop", pct: Number(stopMatch[1]) });
  else if (stopAfter) exits.push({ kind: "stop_loss", pct: Number(stopAfter[1]) });
  else if (plainStop) exits.push({ kind: "stop_loss", pct: Number(plainStop[1]) });

  if (takeMatch) exits.push({ kind: "take_profit", pct: Number(takeMatch[1] ?? takeMatch[2]) });
  if (timeMatch) exits.push({ kind: "time_stop", days: Number(timeMatch[1]) });

  spec.exits = exits;

  // Sizing.
  if (/\binverse\s+volatilit|\bvol[-\s]?target|\brisk\s+parit/.test(input)) {
    spec.sizing = { kind: "inverse_volatility", lookback: 30 };
  } else if (/\bfull(y)?\s+invested|\ball\s+in|\bequal\s+weight/.test(input)) {
    spec.sizing = { kind: "equal_weight" };
  } else {
    const sizePct = input.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:of\s+)?(?:capital|equity|portfolio|position)/);
    spec.sizing = { kind: "fixed_fraction", pct: sizePct ? Number(sizePct[1]) : 100 };
  }

  return { spec, issues: validateSpec(spec), source: "local", notes };
}

/* ------------------------------------------------------------------ */
/* Claude compiler                                                     */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You convert plain-English descriptions of trading strategies into a strict JSON spec.

Return ONLY the JSON object. No preamble, no explanation, no markdown fences.

Schema:
{
  "name": string,
  "universe": string,
  "entry": {
    "left":  { "kind": SIGNAL, "period": number },
    "comparator": "greater_than" | "less_than" | "crosses_above" | "crosses_below",
    "right": { "kind": SIGNAL, "period": number } | { "constant": number },
    "direction": "long" | "short"
  },
  "exits": Array<
      { "kind": "opposite_signal" }
    | { "kind": "stop_loss", "pct": number }
    | { "kind": "take_profit", "pct": number }
    | { "kind": "time_stop", "days": number }
    | { "kind": "trailing_stop", "pct": number }
  >,
  "sizing": { "kind": "fixed_fraction", "pct": number }
          | { "kind": "inverse_volatility", "lookback": number }
          | { "kind": "equal_weight" }
}

SIGNAL is one of: ${SIGNAL_KINDS.join(", ")}.

Parameter ranges (inclusive):
${SIGNAL_KINDS.map((k) => `  ${k}: period ${PERIOD_RANGE[k][0]}–${PERIOD_RANGE[k][1]}`).join("\n")}
  stop_loss / take_profit / trailing_stop pct: 0.5–25
  time_stop days: 2–120
  fixed_fraction pct: 0–100

Rules:
- Bounded oscillators (${BOUNDED_SIGNALS.join(", ")}) must be compared against a
  {"constant": n}, never against another signal.
- Price-scale signals (sma, ema, price) must be compared against another
  price-scale signal, never against a constant.
- "price" ignores its period; send 1.
- Always include at least one exit. Include {"kind":"opposite_signal"} unless the
  description clearly rules it out.
- If the description omits something, choose a conventional value rather than
  inventing a field. Never add fields that are not in the schema.`;

/** Reads the user-supplied key. See `setApiKey` for why this is not an env var. */
const KEY_STORAGE = "adversary.anthropic.key";

export const getApiKey = (): string | null => {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
};

/**
 * Stores the user's own Anthropic key in localStorage.
 *
 * Deliberately NOT a build-time `VITE_` variable: this app is a static
 * client-side bundle, so a bundled key would ship to every visitor in plain
 * text and could be extracted and spent by anyone who loaded the page. A
 * bring-your-own-key field keeps the key on the machine that owns it.
 */
export const setApiKey = (key: string | null): void => {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage blocked — the compiler falls back to the local parser.
  }
};

/** Strips markdown fences the model was told not to emit but sometimes does. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/**
 * Coerce whatever came back into the spec shape. Anything missing or
 * unrecognised falls back to the local parse of the same sentence, so a
 * partially-correct model response still produces a runnable strategy.
 */
function coerce(raw: unknown, fallback: StrategySpec): StrategySpec {
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;
  const entry = (obj.entry ?? {}) as Record<string, unknown>;

  const signal = (value: unknown, backup: SignalSpec): SignalSpec => {
    if (!value || typeof value !== "object") return backup;
    const s = value as Record<string, unknown>;
    const kind = SIGNAL_KINDS.includes(s.kind as SignalKind) ? (s.kind as SignalKind) : backup.kind;
    const period = Number(s.period);
    return { kind, period: Number.isFinite(period) ? Math.round(period) : backup.period };
  };

  const right = (() => {
    const value = entry.right;
    if (value && typeof value === "object" && "constant" in (value as object)) {
      const constant = Number((value as Record<string, unknown>).constant);
      return Number.isFinite(constant) ? { constant } : fallback.entry.right;
    }
    return "kind" in fallback.entry.right
      ? signal(value, fallback.entry.right)
      : signal(value, { kind: "sma", period: 200 });
  })();

  const exits = Array.isArray(obj.exits)
    ? (obj.exits.filter(
        (e) => e && typeof e === "object" && typeof (e as Record<string, unknown>).kind === "string"
      ) as ExitRule[])
    : fallback.exits;

  return {
    name: typeof obj.name === "string" && obj.name ? obj.name : fallback.name,
    universe: fallback.universe,
    entry: {
      left: signal(entry.left, fallback.entry.left),
      comparator: (["greater_than", "less_than", "crosses_above", "crosses_below"] as Comparator[]).includes(
        entry.comparator as Comparator
      )
        ? (entry.comparator as Comparator)
        : fallback.entry.comparator,
      right,
      direction: entry.direction === "short" ? "short" : "long"
    },
    exits: exits.length ? exits : fallback.exits,
    sizing: (obj.sizing && typeof obj.sizing === "object" ? obj.sizing : fallback.sizing) as StrategySpec["sizing"]
  };
}

/**
 * One Claude call, constrained by the grammar in the system prompt. Falls back
 * to the local parse on any failure — no key, network error, refusal, or
 * unparseable output.
 */
export async function compileWithClaude(text: string, universe: string): Promise<CompileResult> {
  const local = parseLocally(text);
  local.spec.universe = universe;

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      ...local,
      issues: validateSpec(local.spec),
      notes: [...local.notes, "No Anthropic key set — parsed locally instead."]
    };
  }

  try {
    const client = new Anthropic({
      apiKey,
      // The key belongs to the person typing it and never leaves their browser.
      dangerouslyAllowBrowser: true
    });

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }]
    });

    if (response.stop_reason === "refusal") {
      return { ...local, issues: validateSpec(local.spec), notes: [...local.notes, "Claude declined; parsed locally."] };
    }

    const body = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const parsed = JSON.parse(extractJson(body)) as unknown;
    const spec = coerce(parsed, local.spec);
    spec.universe = universe;

    const issues = validateSpec(spec);
    return {
      spec,
      issues,
      source: "claude",
      notes: issues.length ? ["Claude's output failed validation — correct it in the builder below."] : []
    };
  } catch (error) {
    const reason =
      error instanceof Anthropic.AuthenticationError
        ? "That API key was rejected."
        : error instanceof Anthropic.RateLimitError
          ? "Rate limited by the API."
          : error instanceof Anthropic.APIError
            ? `API error ${error.status}.`
            : "Could not reach the API.";
    return { ...local, issues: validateSpec(local.spec), notes: [...local.notes, `${reason} Parsed locally instead.`] };
  }
}
