import { ChartNoAxesCombined, Crosshair, Radar, Swords, type LucideIcon } from "lucide-react";

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
      "Generates 14 distinct strategies tailored to the instrument you choose — a stock, an index, a forex pair or a commodity.",
    capabilities: [
      "14 distinct strategies tailored to your stock, index, forex pair or commodity",
      "Index, stock, forex and commodity instruments to pick from",
      "Every condition, sizing rule and fee stated up front",
      "Runs in a Web Worker, streamed live with per-stage progress"
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
    path: "/signal-room",
    name: "Back Tester",
    tagline: "Deep validation of the survivor",
    summary:
      "Ten-year validation of the survivor, with entry, exit and sizing rules, plus the metrics and equity curve that produced them.",
    capabilities: [
      "Ten-year validation of the survivor, with entry, exit and sizing rules",
      "Total return, CAGR, Sharpe and max drawdown",
      "Equity curve rendered from every bar in the test",
      "Expected trade count, win rate and drawdown to prepare for"
    ],
    icon: ChartNoAxesCombined
  },
  {
    path: "/signal-room",
    name: "Current signal",
    tagline: "As of the latest close",
    summary:
      "Current signal, entry price, stop and target as of the latest close — read on the close, filled at the next day's open.",
    capabilities: [
      "Current signal, entry price, stop and target as of the latest close",
      "Signals read on the close; orders fill at the next day's open",
      "15bps round-trip assumed in costs",
      "Paper-trade it forward before committing capital"
    ],
    icon: Radar
  }
];
