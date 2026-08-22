import { useCallback, useEffect, useState } from "react";

/**
 * Session trial counter (§8.4).
 *
 * Every backtest ever run in this browser increments the count, and it persists
 * across refreshes. That persistence is deliberate: the user cannot escape
 * their own search history by reloading the page, and the significance bar they
 * have to clear rises with every variant they try.
 */
const KEY = "adversary.session.v1";

export type SessionState = {
  trialCount: number;
  generatorSweeps: number;
  /** Per-observation Sharpe of every trial run, used to measure the null. */
  trialSharpes: number[];
  verdicts: { status: string; at: string }[];
};

const EMPTY: SessionState = { trialCount: 0, generatorSweeps: 0, trialSharpes: [], verdicts: [] };

/** Cap the stored sample so localStorage cannot grow without bound. */
const MAX_STORED_SHARPES = 5000;

function read(): SessionState {
  if (typeof localStorage === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    return {
      trialCount: parsed.trialCount ?? 0,
      generatorSweeps: parsed.generatorSweeps ?? 0,
      trialSharpes: Array.isArray(parsed.trialSharpes) ? parsed.trialSharpes : [],
      verdicts: Array.isArray(parsed.verdicts) ? parsed.verdicts : []
    };
  } catch {
    return EMPTY;
  }
}

function write(state: SessionState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked — the counter degrades to in-memory, which is a
    // worse experience but not a broken one.
  }
}

const listeners = new Set<(state: SessionState) => void>();
let current = read();

function update(next: SessionState) {
  current = next;
  write(next);
  listeners.forEach((listener) => listener(next));
}

export const sessionStore = {
  get: () => current,

  /** Record backtests. `sharpes` are per-observation. */
  recordTrials(sharpes: number[], fromGenerator = false) {
    const merged = [...current.trialSharpes, ...sharpes.filter(Number.isFinite)];
    update({
      ...current,
      trialCount: current.trialCount + sharpes.length,
      generatorSweeps: current.generatorSweeps + (fromGenerator ? sharpes.length : 0),
      trialSharpes: merged.slice(-MAX_STORED_SHARPES)
    });
  },

  recordVerdict(status: string) {
    update({
      ...current,
      verdicts: [...current.verdicts, { status, at: new Date().toISOString() }].slice(-200)
    });
  },

  reset() {
    update({ ...EMPTY });
  }
};

export function useSession(): [SessionState, typeof sessionStore] {
  const [state, setState] = useState(current);

  useEffect(() => {
    const listener = (next: SessionState) => setState(next);
    listeners.add(listener);
    setState(current);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return [state, sessionStore];
}

/** Formats the running search cost for display in the UI. */
export function useSearchCostLabel(): string {
  const [state] = useSession();
  return useCallback(() => {
    if (state.trialCount === 0) return "No searches recorded yet.";
    return `${state.trialCount.toLocaleString()} strategies searched this session. Your significance threshold has risen accordingly.`;
  }, [state.trialCount])();
}
