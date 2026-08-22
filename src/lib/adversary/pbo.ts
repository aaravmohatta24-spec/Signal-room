/**
 * Combinatorially Symmetric Cross-Validation (CSCV) and the Probability of
 * Backtest Overfitting (PBO).
 *
 * Source: Bailey, Borwein, López de Prado & Zhu, "The Probability of Backtest
 * Overfitting" (2015).
 *
 * The question PBO answers is narrower and sharper than "is this strategy
 * good": given a family of configurations and a selection rule that picks the
 * in-sample best, how often does that pick land BELOW the median out-of-sample?
 * If it does so more than half the time, the selection procedure itself is
 * worse than useless — you would do better choosing at random.
 *
 * That framing is why this belongs in Adversary rather than in a metrics panel.
 * It indicts the search, not the strategy.
 */

import { sharpeRatio } from "./stats";

/** All combinations of `k` indices drawn from `0..n-1`. */
export function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const current: number[] = [];

  const walk = (start: number) => {
    if (current.length === k) {
      out.push([...current]);
      return;
    }
    // Stop early once too few candidates remain to fill the selection.
    for (let i = start; i < n - (k - current.length) + 1; i++) {
      current.push(i);
      walk(i + 1);
      current.pop();
    }
  };

  walk(0);
  return out;
}

export type PboInput = {
  /**
   * One row per configuration, each row the per-bar returns of that config over
   * the SAME observation window. Rows must be equal length.
   */
  matrix: number[][];
  /** Number of disjoint subsets. Must be even. C(S, S/2) combinations result. */
  subsets?: number;
  /**
   * Observations dropped from the START of each contiguous block when that
   * block is used out-of-sample. Positions held across a block boundary would
   * otherwise leak in-sample information into the test set.
   */
  embargo?: number;
};

export type PboResult = {
  /** Fraction of splits where the in-sample winner fell below the OOS median. */
  pbo: number;
  /** Logit of the OOS relative rank of the IS winner, one per split. */
  logits: number[];
  /** Number of train/test splits evaluated. */
  splits: number;
  /** Number of configurations compared. */
  configs: number;
  /** Mean out-of-sample Sharpe of the in-sample winners, per observation. */
  meanOosSharpe: number;
  /** Mean in-sample Sharpe of those same winners — the optimism gap. */
  meanIsSharpe: number;
};

/**
 * Run CSCV and return the probability of backtest overfitting.
 *
 * `subsets = 8` gives C(8,4) = 70 splits, which is enough for a stable estimate
 * and cheap enough to run on the main thread. The published examples use 16
 * subsets (12,870 splits); that is a worker-sized job and is left as a knob.
 */
export function probabilityOfBacktestOverfitting({
  matrix,
  subsets = 8,
  embargo = 5
}: PboInput): PboResult {
  const configs = matrix.length;
  if (configs < 2) {
    return { pbo: 0, logits: [], splits: 0, configs, meanOosSharpe: 0, meanIsSharpe: 0 };
  }

  const S = subsets % 2 === 0 ? subsets : subsets + 1;
  const T = Math.min(...matrix.map((row) => row.length));
  const blockSize = Math.floor(T / S);
  if (blockSize <= embargo + 2) {
    return { pbo: 0, logits: [], splits: 0, configs, meanOosSharpe: 0, meanIsSharpe: 0 };
  }

  // Contiguous blocks preserve the serial structure of returns; shuffling
  // observations would destroy the volatility clustering the whole exercise
  // depends on.
  const blocks: { start: number; end: number }[] = [];
  for (let s = 0; s < S; s++) blocks.push({ start: s * blockSize, end: (s + 1) * blockSize });

  const gather = (row: number[], chosen: number[], applyEmbargo: boolean): number[] => {
    const out: number[] = [];
    for (const b of chosen) {
      const { start, end } = blocks[b];
      for (let i = applyEmbargo ? start + embargo : start; i < end; i++) out.push(row[i]);
    }
    return out;
  };

  const trainSets = combinations(S, S / 2);
  const logits: number[] = [];
  const oosWinners: number[] = [];
  const isWinners: number[] = [];

  for (const train of trainSets) {
    const test = blocks.map((_, i) => i).filter((i) => !train.includes(i));

    // In-sample: pick the winner the way a user would — the highest Sharpe.
    let best = 0;
    let bestSharpe = -Infinity;
    for (let c = 0; c < configs; c++) {
      const sr = sharpeRatio(gather(matrix[c], train, false));
      if (Number.isFinite(sr) && sr > bestSharpe) {
        bestSharpe = sr;
        best = c;
      }
    }

    // Out-of-sample: rank that winner against every other config.
    const oos = matrix.map((row) => {
      const sr = sharpeRatio(gather(row, test, true));
      return Number.isFinite(sr) ? sr : 0;
    });

    const winnerScore = oos[best];
    // Rank ascending, so rank `configs` is the best out-of-sample.
    const rank = oos.filter((sr) => sr < winnerScore).length + 1;
    // The (configs + 1) denominator keeps ω strictly inside (0, 1), so the
    // logit stays finite when the winner ranks first or last.
    const omega = rank / (configs + 1);
    logits.push(Math.log(omega / (1 - omega)));

    oosWinners.push(winnerScore);
    isWinners.push(bestSharpe);
  }

  const average = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);

  return {
    // λ ≤ 0 means the in-sample winner landed at or below the OOS median.
    pbo: logits.length ? logits.filter((l) => l <= 0).length / logits.length : 0,
    logits,
    splits: logits.length,
    configs,
    meanOosSharpe: average(oosWinners),
    meanIsSharpe: average(isWinners)
  };
}
