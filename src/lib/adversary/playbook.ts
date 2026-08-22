import type { AssetClass } from "./instruments";
import type { StrategySpec } from "./spec";

/**
 * The playbook: well-known strategies, tuned per asset class.
 *
 * These are the setups people actually run, and they are here so a user can
 * test the thing they already believe rather than only random draws. Parameters
 * are not universal — a 2-standard-deviation band means something different on
 * a currency cross than on a small-cap index — so each entry adapts to the
 * asset class it is applied to.
 *
 * Every entry also carries the standard criticism of it. A strategy library
 * that lists only the premise is a sales brochure.
 */
export type PlaybookEntry = {
  id: string;
  name: string;
  family: "trend" | "mean-reversion" | "momentum" | "breakout" | "volatility";
  premise: string;
  caveat: string;
  /** Asset classes where this setup is conventionally used. */
  suits: AssetClass[];
  build: (ticker: string, assetClass: AssetClass) => StrategySpec;
};

const make = (
  ticker: string,
  name: string,
  entry: StrategySpec["entry"],
  exits: StrategySpec["exits"],
  sizing: StrategySpec["sizing"] = { kind: "fixed_fraction", pct: 100 }
): StrategySpec => ({ name, universe: ticker, entry, exits, sizing });

/** Faster parameters where the series is noisier, slower where it trends. */
const speedFor = (assetClass: AssetClass) => {
  switch (assetClass) {
    case "forex":
      // FX trends are persistent but shallow; longer lookbacks, tighter stops.
      return { fast: 20, slow: 100, rsi: 14, band: 2.0, stop: 2, hold: 15 };
    case "commodity":
      return { fast: 30, slow: 120, rsi: 14, band: 2.2, stop: 6, hold: 20 };
    case "index":
      return { fast: 50, slow: 200, rsi: 14, band: 2.0, stop: 5, hold: 10 };
    case "stock":
      // Single names are noisier than the index they sit in.
      return { fast: 40, slow: 150, rsi: 14, band: 2.3, stop: 8, hold: 10 };
    default:
      return { fast: 50, slow: 200, rsi: 14, band: 2.0, stop: 5, hold: 10 };
  }
};

export const PLAYBOOK: PlaybookEntry[] = [
  {
    id: "ma-cross",
    name: "Moving-average crossover",
    family: "trend",
    premise: "Go long when the faster average crosses above the slower one — the golden cross, in its general form.",
    caveat: "Signals arrive well after the move begins and whipsaw badly in range-bound markets.",
    suits: ["index", "stock", "forex", "commodity"],
    build: (t, a) => {
      const p = speedFor(a);
      return make(
        t,
        `${p.fast}/${p.slow} crossover`,
        { left: { kind: "sma", period: p.fast }, comparator: "crosses_above", right: { kind: "sma", period: p.slow }, direction: "long" },
        [{ kind: "opposite_signal" }]
      );
    }
  },
  {
    id: "trend-filter",
    name: "Long-term trend filter",
    family: "trend",
    premise: "Hold only while price sits above its long-run average. The simplest regime filter there is.",
    caveat: "On a rising index this is close to buy-and-hold — compare it against simply owning the thing.",
    suits: ["index", "stock", "commodity"],
    build: (t, a) => {
      const p = speedFor(a);
      return make(
        t,
        `Above the ${p.slow}-day`,
        { left: { kind: "price", period: 1 }, comparator: "greater_than", right: { kind: "sma", period: p.slow }, direction: "long" },
        [{ kind: "opposite_signal" }]
      );
    }
  },
  {
    id: "ema-macd",
    name: "EMA 12/26 (MACD pair)",
    family: "trend",
    premise: "The two averages underneath the MACD, traded directly on their crossover.",
    caveat: "High turnover. The edge is usually eaten by spread and slippage before it reaches you.",
    suits: ["index", "stock", "forex", "commodity"],
    build: (t) =>
      make(
        t,
        "EMA 12/26 crossover",
        { left: { kind: "ema", period: 12 }, comparator: "crosses_above", right: { kind: "ema", period: 26 }, direction: "long" },
        [{ kind: "opposite_signal" }]
      )
  },
  {
    id: "rsi2",
    name: "RSI(2) short-term reversal",
    family: "mean-reversion",
    premise: "Connors' setup — buy extreme two-day oversold readings and hold for a few days.",
    caveat: "Wins often and loses enormously. The payoff is heavily left-skewed, which a Sharpe ratio hides.",
    suits: ["index", "stock"],
    build: (t, a) => {
      const p = speedFor(a);
      return make(
        t,
        "RSI(2) reversal",
        { left: { kind: "rsi", period: 2 }, comparator: "less_than", right: { constant: 10 }, direction: "long" },
        [{ kind: "time_stop", days: 5 }, { kind: "stop_loss", pct: p.stop }]
      );
    }
  },
  {
    id: "rsi-oversold",
    name: "RSI oversold bounce",
    family: "mean-reversion",
    premise: "The textbook setup: buy as the 14-day RSI climbs back out of oversold territory.",
    caveat: "In a real downtrend RSI stays oversold for weeks while price keeps falling.",
    suits: ["index", "stock", "forex", "commodity"],
    build: (t, a) => {
      const p = speedFor(a);
      return make(
        t,
        "RSI oversold bounce",
        { left: { kind: "rsi", period: p.rsi }, comparator: "crosses_above", right: { constant: 30 }, direction: "long" },
        [{ kind: "opposite_signal" }, { kind: "stop_loss", pct: p.stop }, { kind: "take_profit", pct: p.stop * 2 }]
      );
    }
  },
  {
    id: "bollinger-reversion",
    name: "Band reversion",
    family: "mean-reversion",
    premise: "A Bollinger-style bet — buy when price is stretched well below its own recent mean.",
    caveat: "Assumes the mean is stable. During a repricing it is not, and the band follows price down.",
    suits: ["index", "stock", "forex", "commodity"],
    build: (t, a) => {
      const p = speedFor(a);
      return make(
        t,
        `${p.band}σ band reversion`,
        { left: { kind: "zscore", period: 20 }, comparator: "less_than", right: { constant: -p.band }, direction: "long" },
        [{ kind: "time_stop", days: p.hold }, { kind: "stop_loss", pct: p.stop }]
      );
    }
  },
  {
    id: "momentum-12m",
    name: "12-month momentum",
    family: "momentum",
    premise: "The most durable anomaly in the literature — own what has already risen over the past year.",
    caveat: "Suffers rare, violent crashes at market turns that undo years of gains at once.",
    suits: ["index", "stock", "commodity", "forex"],
    build: (t) =>
      make(
        t,
        "12-month momentum",
        { left: { kind: "momentum", period: 250 }, comparator: "greater_than", right: { constant: 5 }, direction: "long" },
        [{ kind: "opposite_signal" }],
        { kind: "inverse_volatility", lookback: 60 }
      )
  },
  {
    id: "supertrend",
    name: "Supertrend follower",
    family: "trend",
    premise:
      "Hold the position while ATR bands say the trend is intact, and flip only when price closes through the " +
      "band. Sizing the stop by volatility keeps the exit the same distance away in risk terms whether the " +
      "market is calm or violent.",
    caveat:
      "One of the most heavily optimised indicators in retail trading, which is exactly why its backtests " +
      "flatter it. The period and multiplier are almost always fitted to the chart being shown, and it still " +
      "whipsaws in a range like every other trend follower.",
    suits: ["index", "stock", "commodity", "forex"],
    build: (t, a) => {
      const p = speedFor(a);
      return make(
        t,
        "Supertrend follower",
        // Direction is +1 or -1, so "above 0" is the whole uptrend condition.
        { left: { kind: "supertrend", period: 10 }, comparator: "greater_than", right: { constant: 0 }, direction: "long" },
        [{ kind: "opposite_signal" }, { kind: "stop_loss", pct: p.stop * 2 }]
      );
    }
  },
  {
    id: "donchian",
    name: "Donchian breakout",
    family: "breakout",
    premise:
      "The original turtle rule: buy when the close finishes at the top of its own prior N-day range, and let " +
      "a trailing stop decide when the move is over.",
    caveat:
      "The published edge dates from the 1980s and has been arbitraged hard since. Expect a low win rate and " +
      "long stretches underwater between the few breakouts that run.",
    suits: ["index", "stock", "commodity", "forex"],
    build: (t, a) => {
      const p = speedFor(a);
      return make(
        t,
        "Donchian breakout",
        // The window excludes the current bar, so 98 means the close cleared
        // nearly the whole range that existed before it.
        { left: { kind: "donchian", period: 20 }, comparator: "crosses_above", right: { constant: 98 }, direction: "long" },
        [{ kind: "trailing_stop", pct: p.stop * 2.5 }, { kind: "time_stop", days: 120 }]
      );
    }
  },
  {
    id: "breakout",
    name: "Range breakout",
    family: "breakout",
    premise: "Turtle-style: buy strength that clears its recent range and ride it with a trailing stop.",
    caveat: "Long strings of small losses punctuated by rare large wins. Most people quit before the wins.",
    suits: ["index", "stock", "commodity", "forex"],
    build: (t, a) => {
      const p = speedFor(a);
      return make(
        t,
        "Range breakout",
        { left: { kind: "momentum", period: 55 }, comparator: "crosses_above", right: { constant: 8 }, direction: "long" },
        [{ kind: "trailing_stop", pct: p.stop * 2 }, { kind: "time_stop", days: 90 }]
      );
    }
  },
  {
    id: "vol-target",
    name: "Volatility-targeted trend",
    family: "volatility",
    premise: "Trend-following with position size scaled inversely to volatility — how most managed futures funds run.",
    caveat: "Sizing smooths the ride but cannot rescue a signal that has no edge to begin with.",
    suits: ["index", "commodity", "forex"],
    build: (t, a) => {
      const p = speedFor(a);
      return make(
        t,
        "Vol-targeted trend",
        { left: { kind: "sma", period: p.fast }, comparator: "crosses_above", right: { kind: "sma", period: p.slow }, direction: "long" },
        [{ kind: "opposite_signal" }],
        { kind: "inverse_volatility", lookback: 60 }
      );
    }
  },
  {
    id: "vol-spike-fade",
    name: "Volatility spike fade",
    family: "volatility",
    premise: "Buy panic — enter when realised volatility spikes, on the theory that fear overshoots.",
    caveat: "Indistinguishable from catching a falling knife until well after the fact.",
    suits: ["index", "stock", "commodity"],
    build: (t, a) => {
      const p = speedFor(a);
      return make(
        t,
        "Volatility spike fade",
        { left: { kind: "volatility", period: 20 }, comparator: "crosses_above", right: { constant: 35 }, direction: "long" },
        [{ kind: "time_stop", days: 15 }, { kind: "stop_loss", pct: p.stop * 1.5 }],
        { kind: "fixed_fraction", pct: 50 }
      );
    }
  }
];

/** The playbook entries conventionally used on a given asset class. */
export const playbookFor = (assetClass: AssetClass): PlaybookEntry[] =>
  PLAYBOOK.filter((entry) => entry.suits.includes(assetClass));
