import type { AssetClass } from "./instruments";
import type { PoolCandidate } from "./pool";
import type { StrategySpec } from "./spec";

/**
 * Handing work between the three tools.
 *
 * A single strategy travels in the URL hash (see permalink.ts) because that
 * makes it shareable. A whole pool does not: twenty specs is several kilobytes
 * of base64, which produces an unreadable address bar and bumps against the
 * length limits of anything that might forward it.
 *
 * So a pool is written to sessionStorage and the URL carries only a marker.
 * sessionStorage rather than localStorage is deliberate — a race belongs to the
 * tab that started it, and a stale pool resurfacing in a new session weeks
 * later would be confusing rather than helpful.
 */
const POOL_KEY = "signalroom.race.pool.v1";
const WINNER_KEY = "signalroom.race.winner.v1";

export type RacePool = {
  ticker: string;
  assetClass: AssetClass;
  instrumentLabel: string;
  createdAt: string;
  candidates: PoolCandidate[];
};

/** The strategy that won a race, plus enough context to explain why. */
export type RaceWinner = {
  ticker: string;
  instrumentLabel: string;
  spec: StrategySpec;
  /** Ordeals passed, out of the battery it faced. */
  survived: number;
  ordealCount: number;
  robustness: number;
  fieldSize: number;
  sharpeAnnual: number;
  totalReturn: number;
  maxDrawdown: number;
  tradeCount: number;
  decidedAt: string;
};

function read<T>(key: string): T | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // A hand-edited or truncated entry is a normal thing to encounter, not an
    // error worth surfacing — the caller simply gets nothing.
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded, or storage disabled by the browser.
    return false;
  }
}

export const savePool = (pool: RacePool): boolean => write(POOL_KEY, pool);
export const readPool = (): RacePool | null => read<RacePool>(POOL_KEY);
export const clearPool = (): void => sessionStorage?.removeItem(POOL_KEY);

export const saveWinner = (winner: RaceWinner): boolean => write(WINNER_KEY, winner);
export const readWinner = (): RaceWinner | null => read<RaceWinner>(WINNER_KEY);
export const clearWinner = (): void => sessionStorage?.removeItem(WINNER_KEY);
