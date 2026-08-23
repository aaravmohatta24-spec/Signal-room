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
  /** The indicator itself: what it computes and what that number means. */
  indicator: string;
  /** Bar size, typical holding period, and how often the rule is checked. */
  timeframe: string;
  /** How the rule actually trades, start to finish. */
  mechanics: string;
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
    indicator:
      "Two simple moving averages of the closing price. A simple moving average is the plain arithmetic mean of the last N closes, recomputed every bar, so it lags price by roughly half its window. The pair is read against each other rather than against price: the faster average reacts to recent closes, the slower one still carries older ones, and the gap between them measures how far the recent past has pulled away from the longer past.",
    timeframe:
      "Daily bars, checked once per day after the close. Positions are held until the averages cross back, which historically means weeks to several months. Expect a handful of trades a year, not a handful a week.",
    mechanics:
      "Go long on the bar where the fast average finishes above the slow average, having been below it on the previous bar. Hold while it stays above. Exit on the bar where it crosses back below. The cross must complete on a closing basis, so an intraday poke through that reverses by the close does not count. Entry and exit are the same condition read in opposite directions, so the rule is always either long or flat and never short.",
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
    indicator:
      "One long simple moving average of the close, used as a dividing line rather than as a signal in its own right. Price above it means the last N closes average lower than today; below means the opposite. On an index this is the crudest possible statement of regime, and that is its value: one parameter, and it has been the same number for decades, so there is almost nothing to overfit.",
    timeframe:
      "Daily bars, read after the close. Holding periods are long. The rule stays invested through entire bull markets and steps aside for entire bear markets, so it may trade only a few times a year.",
    mechanics:
      "Hold a full long position while the close sits above the average. Move entirely to cash on the first close below it. Re-enter on the first close back above. There is no stop and no target, because the average is the stop. The rule accepts that it will re-enter higher than it exited on every false signal, and pays that cost in exchange for never sitting through the deep part of a sustained decline.",
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
    indicator:
      "Two exponential moving averages, 12 and 26 periods, the pair underneath MACD. An exponential average weights recent closes more heavily and never entirely forgets an old bar, so it turns faster than a simple average of the same length. What this rule trades is the crossover itself, not the smoothed histogram usually built on top of it.",
    timeframe:
      "Daily bars, evaluated on the close. Faster than the 50/200 pair: holds of one to several weeks and noticeably more trades per year, which is precisely why costs matter more here than they do on a slower rule.",
    mechanics:
      "Enter long when the 12-period EMA closes above the 26-period EMA. Exit when it closes back below. A percentage stop sits underneath as a second exit, so a fast adverse move does not have to wait for two lagging averages to catch up before the position is closed.",
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
    indicator:
      "The Relative Strength Index over a 2-period lookback. RSI compares the average size of up-closes against down-closes across its window and maps the result onto 0 to 100, so 50 is balance, high is stretched upward and low is stretched downward. At two periods it is deliberately twitchy. This is the Connors short-term reversal setting, not the standard 14.",
    timeframe:
      "Daily bars. Very short holds, typically two to five days, and the rule fires often. That frequency is the point and also the risk: turnover is high enough that fees and slippage can consume the entire edge.",
    mechanics:
      "Buy when RSI(2) closes below its lower threshold, meaning the last two days have been almost entirely down moves. Exit on a move back above the exit threshold, on a percentage stop, or after a fixed number of days, whichever arrives first. The time stop matters more than usual: without it a position entered on a stretched reading can sit through a genuine downtrend waiting for a bounce that never comes.",
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
    indicator:
      "RSI at the conventional 14-period setting, read against the classic 30 and 70 levels. Over 14 bars the index is far steadier than the 2-period version, so a reading under 30 describes a fortnight of persistent selling rather than two bad days.",
    timeframe:
      "Daily bars, read on the close. Holds run one to several weeks, long enough for a genuine bounce to develop and short enough that a fixed time stop still means something.",
    mechanics:
      "Enter long when RSI(14) crosses up through the oversold threshold, not merely while it sits below it. Waiting for the cross means buying the turn rather than catching the falling knife on the way down. Exit on a percentage stop or when the holding period expires.",
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
    indicator:
      "A rolling z-score of the close: how many standard deviations today sits from its own N-period mean. Identical arithmetic to a Bollinger band, expressed as a number instead of drawn as a line. Minus two means the close is two standard deviations below its recent average, which on a normally distributed series would happen about one day in forty.",
    timeframe:
      "Daily bars. Mean reversion is a short-horizon effect, so holds run days to a couple of weeks and the rule expects to be out again quickly.",
    mechanics:
      "Buy when the z-score drops below the negative band. Exit when it returns toward the mean, or on a percentage stop. The whole rule is a bet that the dispersion is temporary. The stop is the part that matters, because the one thing that destroys a reversion strategy is a series that keeps making new lows: each one looks like a better entry, right up until the position is unrecoverable.",
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
    indicator:
      "Twelve-month price momentum: percentage change in the close over roughly 250 trading days. No smoothing and no bands, just the trailing one-year return, which is the form the momentum literature has used since Jegadeesh and Titman.",
    timeframe:
      "Daily bars, but a fundamentally slow signal. Positions are held for months and the rule may make only a few round trips a year. Size is set from 60-day volatility rather than fixed, so exposure falls automatically when the market turns rough.",
    mechanics:
      "Hold long while the trailing twelve-month return sits above a small positive threshold. Exit when it falls back through. Size inversely to recent volatility, so a calm market receives more capital than a violent one for the same signal. The threshold is above zero rather than at zero to avoid churning in and out of a series hovering around flat.",
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
    indicator:
      "Supertrend, built from Average True Range. True range is the widest of the bar's own high-to-low span and its two gaps from the previous close, so a market that opens away from yesterday is not recorded as having been quiet. ATR is the Wilder-smoothed average of that. Bands are placed a multiple of ATR either side of the bar midpoint and then ratchet: the lower band only rises while price holds above it, the upper only falls. The indicator reports which side price is on as a single direction.",
    timeframe:
      "Daily bars on a 10-period ATR. Measured across twenty years of the S&P 500 the direction holds for about 32 bars at a time, so this rule changes its mind roughly once every six or seven weeks rather than daily.",
    mechanics:
      "Hold long while the direction reads up. Exit when a close breaks the trailing band and flips it down. A percentage stop sits underneath as a backstop. Because the band is derived from ATR, the exit sits further away in a violent market and closer in a calm one, keeping the distance roughly constant in risk terms rather than in price terms.",
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
    indicator:
      "The Donchian channel — the highest high and lowest low of the previous N bars — expressed as the close's position inside that range on a 0 to 100 scale. The window deliberately excludes the current bar, so a close that clears the range reads above 100 and one that breaks below reads under 0. That overshoot is the breakout and is not clipped away.",
    timeframe:
      "Daily bars on a 20-day window, the original turtle short-term channel. Holds vary enormously: most trades stop out within days while the few that work can run for months. A 120-day maximum holding period caps the tail.",
    mechanics:
      "Go long on the close that clears essentially the whole prior 20-day range. Ride it with a trailing stop set from the asset class's volatility, and close the position if it has not resolved within the maximum holding period. Expect a low win rate with a long right tail: most attempts fail small and a minority pay for all of them, which is far harder to run than the statistics make it sound.",
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
    indicator:
      "Medium-horizon momentum, measured as percentage change over the last 55 bars, crossing up through a positive threshold. Fifty-five is a Donchian number and roughly a quarter of a trading year: long enough that noise averages out, short enough to catch a move while it is still moving.",
    timeframe:
      "Daily bars. Positions are held with a trailing stop and a 90-day cap, so a working trade runs for weeks to a few months.",
    mechanics:
      "Enter long when quarterly momentum crosses up through the threshold, meaning strength has newly appeared rather than merely persisted. Trail a stop at roughly twice the asset class's normal stop distance to give the move room, and exit on that trailing stop or the time cap. This is strength-buying: it deliberately pays up rather than waiting for a pullback that may never arrive.",
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
    indicator:
      "A trend condition — price above its long moving average — combined with realised volatility, computed as the annualised standard deviation of daily log returns over a rolling window. The trend decides direction; the volatility decides size.",
    timeframe:
      "Daily bars, read on the close. Direction changes slowly, as with any long-average trend rule, but position size is recalculated continuously as volatility moves.",
    mechanics:
      "Take a long position while price sits above the long average, sized inversely to recent volatility so the expected risk contribution stays roughly constant instead of the position size staying constant. In practice that means a large position in a quiet market and a small one in a violent market for the same signal. It usually improves drawdown more than it improves return, which is a trade most people say they want until they see the return.",
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
    indicator:
      "Realised volatility used as the signal rather than as a sizing input: annualised standard deviation of daily log returns over a rolling window, compared against a fixed level. A reading above that level means the market has recently been moving far more than usual, in either direction.",
    timeframe:
      "Daily bars. Short holds of days to a couple of weeks. Volatility clusters, but spikes mean-revert on roughly that horizon.",
    mechanics:
      "Enter long once volatility has spiked past the threshold, betting on the calm that usually follows rather than on direction. Exit on a stop or when the holding period expires. The failure mode is worth stating plainly: volatility spikes are correlated with crashes, so this rule buys into exactly the conditions that produce the largest losses. The stop is not optional.",
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
