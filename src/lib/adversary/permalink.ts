import { validateSpec, type StrategySpec } from "./spec";

/**
 * Shareable permalinks (§7.5).
 *
 * The link encodes the strategy spec and the verdict it earned, so a claim can
 * travel with its own refutation attached. That matters for the sceptic use
 * case in §4: someone shown a strategy can be handed a link that reproduces
 * both the rules and the verdict rather than a screenshot of an equity curve.
 *
 * Encoding is base64url over compact JSON — no server, no database, no
 * shortener. The whole payload lives in the URL, which keeps the "no backend"
 * property of §8.1 intact.
 */

export type SharedRun = {
  spec: StrategySpec;
  verdict?: {
    status: string;
    /** Attack id → status, enough to redraw the summary without re-running. */
    attacks: { id: string; name: string; status: string; headline: string }[];
    trialCount: number;
  };
};

/** UTF-8 safe base64url encode. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** UTF-8 safe base64url decode. */
function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeRun(run: SharedRun): string {
  return toBase64Url(JSON.stringify(run));
}

/**
 * Decode a shared run. Returns null rather than throwing on anything malformed
 * — a truncated or hand-edited link is a normal thing to receive, not an error
 * condition, and the spec is re-validated because the URL is user-controlled
 * input like any other.
 */
export function decodeRun(encoded: string): SharedRun | null {
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as SharedRun;
    if (!parsed?.spec?.entry || !Array.isArray(parsed.spec.exits)) return null;
    if (validateSpec(parsed.spec).length > 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build a full permalink. The app uses HashRouter, so the payload rides in the
 * hash route's query string: `#/adversary?run=<payload>`.
 */
export function buildPermalink(run: SharedRun, origin = window.location.origin + window.location.pathname): string {
  return `${origin}#/adversary?run=${encodeRun(run)}`;
}

/** Read a shared run out of the current hash route, if one is present. */
export function readPermalink(hash = window.location.hash): SharedRun | null {
  const query = hash.indexOf("?");
  if (query < 0) return null;
  const run = new URLSearchParams(hash.slice(query + 1)).get("run");
  return run ? decodeRun(run) : null;
}
