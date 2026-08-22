import { ChartNoAxesCombined, Crosshair, Swords, type LucideIcon } from "lucide-react";

export type Offering = {
  /** Route this offering lives at. */
  path: string;
  /** Short name, used in navigation. */
  name: string;
  /** One-line positioning statement. */
  tagline: string;
  /** Sentence used on marketing surfaces. */
  summary: string;
  /** Concrete things the tool actually does. */
  capabilities: string[];
  icon: LucideIcon;
};

/**
 * The product surface, defined once. Navigation, the home page and the
 * signed-in overview all read from here so they cannot drift apart.
 */
export const OFFERINGS: Offering[] = [
  {
    path: "/signal-room",
    name: "Strategy Maker",
    tagline: "Generate the pool",
    summary:
      "Generates a pool of candidate rules for the instrument you choose. It stops there — nothing is tested, ranked or endorsed until you send it onward.",
    capabilities: [
      "5, 10, 14 or 20 strategies tailored to your stock, index, forex pair or commodity",
      "Every entry, exit and sizing rule written out in plain English",
      "Lookbacks capped against the instrument's actual history",
      "Send any candidate straight to the Adversary"
    ],
    icon: Swords
  },
  {
    path: "/adversary",
    name: "Adversary",
    tagline: "It tries to kill your strategy",
    summary:
      "Eight ordeals per candidate, eliminating the fragile ones. Search cost, parameter stability, regime dependence, friction, noise and synthetic history — ending in one blunt verdict.",
    capabilities: [
      "Eight ordeals per candidate, eliminating the fragile ones",
      "Deflated Sharpe Ratio charged against every variant you have tried",
      "Parameter sweep that separates a plateau from a lucky spike",
      "DEAD / WOUNDED / SURVIVED, with what would have to change"
    ],
    icon: Crosshair
  },
  {
    path: "/back-tester",
    name: "Back Tester",
    tagline: "Set your terms, read the result",
    summary:
      "Takes a strategy from the Adversary and tests it on your terms — your instrument, window, capital, sizing, stops and costs — then reports what it did trade by trade.",
    capabilities: [
      "Instrument, test window, starting capital and position size you set yourself",
      "Stop loss, target, trailing stop and maximum holding period as toggles",
      "Brokerage and slippage in basis points, charged per side",
      "Equity curve, year-by-year table, full trade log, and the rule's stance at the last close"
    ],
    icon: ChartNoAxesCombined
  }
];
