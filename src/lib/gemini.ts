import type { StrategySpec } from "./adversary/spec";

// Supplied at build time from .env (see .env.example). Note that anything
// prefixed VITE_ is inlined into the browser bundle, so a key set here is
// visible to anyone using the deployed site — keep it restricted to the
// Generative Language API and to the site's own referrer.
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_KEY ?? "";

const SCHEMA = `
export type SignalKind = "sma" | "ema" | "rsi" | "zscore" | "momentum" | "volatility" | "price" | "volume_ratio";
export type Comparator = "greater_than" | "less_than" | "crosses_above" | "crosses_below";

export type StrategySpec = {
  name: string;
  universe: string; // Set this to the requested ticker e.g., "AAPL"
  entry: {
    left: { kind: SignalKind; period: number };
    comparator: Comparator;
    right: { kind: SignalKind; period: number } | { constant: number };
    direction: "long" | "short";
  };
  exits: Array<
    | { kind: "opposite_signal" }
    | { kind: "stop_loss"; pct: number }
    | { kind: "take_profit"; pct: number }
    | { kind: "time_stop"; days: number }
    | { kind: "trailing_stop"; pct: number }
  >;
  sizing: 
    | { kind: "fixed_fraction"; pct: number }
    | { kind: "inverse_volatility"; lookback: number }
    | { kind: "equal_weight" };
};
`;

export async function generateStrategies(prompt: string, ticker: string, count: number = 5): Promise<StrategySpec[]> {
  if (!GEMINI_API_KEY) {
    throw new Error("No Gemini key configured. Set VITE_GEMINI_KEY in .env and rebuild.");
  }

  const systemInstruction = `You are a quantitative finance expert. Generate ${count} trading strategies that match the provided TypeScript schema perfectly for the stock ticker ${ticker}.
Return ONLY a valid JSON array of objects that conform to the StrategySpec type.
Here is the schema:
${SCHEMA}

Make the strategies diverse (e.g. trend, mean-reversion, breakout) and credible.`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        response_mime_type: "application/json",
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Failed to parse Gemini response.");

  try {
    const specs = JSON.parse(content);
    return Array.isArray(specs) ? specs : [specs];
  } catch (err) {
    throw new Error("Gemini returned invalid JSON.");
  }
}
