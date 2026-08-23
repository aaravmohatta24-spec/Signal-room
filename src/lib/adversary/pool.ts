import { DEFAULT_COSTS, runBacktest } from "./engine";
import { maxLookbackFor, type AssetClass } from "./instruments";
import { randomSpec } from "./generator";
import { seededRandom } from "./data";
import { PLAYBOOK, playbookFor, type PlaybookEntry } from "./playbook";
import type { Bars } from "./signals";
import { describeSpec, validateSpec, type StrategySpec } from "./spec";

/**
 * Pool construction, shared by the Strategy Maker page and the pipeline worker.
 *
 * This used to live inside the worker, which meant the page could only see a
 * pool by running the whole red-team pass. Splitting it out lets the Strategy
 * Maker present the candidates on their own — named, with the premise and the
 * standard criticism attached — and hand the same objects to the Adversary
 * afterwards, so the strategies raced are exactly the ones displayed.
 */
export type PoolOrigin = "playbook" | "generated";

export type PoolCandidate = {
  spec: StrategySpec;
  origin: PoolOrigin;
  /** Plain-English rules, precomputed so every surface renders them alike. */
  description: string;
  /** Playbook metadata, absent for generated draws. */
  family: PlaybookEntry["family"] | "generated";
  premise: string;
  caveat: string;
  /** Long-form documentation, present for playbook entries. */
  indicator: string;
  timeframe: string;
  mechanics: string;
  tradeCount: number;
};

/** Structural fingerprint, used to keep the pool free of duplicates. */
export function signatureOf(spec: StrategySpec): string {
  const right = "kind" in spec.entry.right
    ? `${spec.entry.right.kind}:${spec.entry.right.period}`
    : `const:${spec.entry.right.constant}`;
  const exits = spec.exits.map((e) => e.kind).sort().join("|");
  return [
    spec.entry.left.kind, spec.entry.left.period, spec.entry.comparator,
    right, spec.entry.direction, exits, spec.sizing.kind
  ].join("/");
}

/**
 * The criticism attached to a generated draw.
 *
 * A random rule has no literature behind it, so it gets the honest general
 * objection rather than a borrowed one: it was selected by search, and search
 * over a large grammar finds attractive-looking rules in noise by construction.
 */
const GENERATED_CAVEAT =
  "Drawn at random from the rule grammar, not from any published result. Searching a large space " +
  "produces good-looking rules on noise alone, so this needs to clear a higher bar than a setup " +
  "with a prior behind it.";

const GENERATED_PREMISE =
  "No prior claim — this is a candidate the search produced, included so the pool is not limited to " +
  "strategies that were already popular.";

const GENERATED_INDICATOR =
  "Assembled from the rule grammar rather than taken from a named setup, so the indicator, its lookback " +
  "and its threshold were all chosen by the sampler. Read the entry condition above for exactly what it " +
  "measures; there is no established interpretation of this particular combination.";

const GENERATED_TIMEFRAME =
  "Daily bars, read on the close, with orders assumed to fill at the next open. Holding period is set by " +
  "whichever exit fires first rather than by any intended horizon.";

const GENERATED_MECHANICS =
  "Enter when the condition above is true, exit on the first exit rule that triggers. Lookbacks are capped " +
  "against the length of the series so the rule cannot ask for more history than the instrument has.";

/**
 * Build a pool for an instrument: the conventional setups for its asset class
 * first, then fresh draws to fill the remainder.
 *
 * Playbook entries come first deliberately. A pool of pure random draws would
 * measure only whether the search can beat noise; anchoring it in the setups
 * people actually run means the race says something about those too.
 */
export function buildPool(
  ticker: string,
  assetClass: AssetClass,
  poolSize: number,
  seed: number,
  bars: Bars
): PoolCandidate[] {
  const cap = maxLookbackFor(bars.close.length);
  const pool: PoolCandidate[] = [];
  const seen = new Set<string>();

  const add = (spec: StrategySpec, origin: PoolOrigin, entry?: PlaybookEntry) => {
    if (validateSpec(spec).length) return false;
    const signature = signatureOf(spec);
    if (seen.has(signature)) return false;
    let tradeCount = 0;
    try {
      tradeCount = runBacktest(spec, bars, DEFAULT_COSTS).metrics.tradeCount;
    } catch {
      return false;
    }
    // A rule that never fires is not a strategy, and it would occupy a slot the
    // race could give to one that does.
    if (tradeCount < 5) return false;
    seen.add(signature);
    pool.push({
      spec,
      origin,
      description: describeSpec(spec),
      family: entry?.family ?? "generated",
      premise: entry?.premise ?? GENERATED_PREMISE,
      caveat: entry?.caveat ?? GENERATED_CAVEAT,
      indicator: entry?.indicator ?? GENERATED_INDICATOR,
      timeframe: entry?.timeframe ?? GENERATED_TIMEFRAME,
      mechanics: entry?.mechanics ?? GENERATED_MECHANICS,
      tradeCount
    });
    return true;
  };

  for (const entry of playbookFor(assetClass)) {
    if (pool.length >= poolSize) break;
    add(entry.build(ticker, assetClass), "playbook", entry);
  }

  // If the asset class has few conventional setups, widen to the whole playbook
  // before falling back to random draws — a named strategy applied outside its
  // usual market is still more informative than noise.
  for (const entry of PLAYBOOK) {
    if (pool.length >= poolSize) break;
    add(entry.build(ticker, assetClass), "playbook", entry);
  }

  const rand = seededRandom(seed);
  let attempts = 0;
  while (pool.length < poolSize && attempts < poolSize * 60) {
    attempts++;
    const spec = randomSpec(rand, ticker, pool.length, cap);
    spec.name = `Generated ${pool.length + 1}`;
    add(spec, "generated");
  }

  return pool;
}
