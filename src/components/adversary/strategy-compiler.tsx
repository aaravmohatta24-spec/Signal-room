import { useState } from "react";
import { KeyRound, Sparkles, Wand2 } from "lucide-react";

import { compileWithClaude, getApiKey, setApiKey, type CompileResult } from "@/lib/adversary/compiler";
import type { StrategySpec } from "@/lib/adversary/spec";
import { cn } from "@/lib/utils";

/**
 * English → spec compiler UI (§7.2).
 *
 * The visual builder below it is always the fallback: whatever this produces —
 * including a partial or rejected parse — lands in the builder for the user to
 * correct. The compiler is a shortcut, never a gate.
 */
const EXAMPLES = [
  "buy when the 50-day moving average crosses above the 200-day, exit on a 5% stop loss",
  "go long when RSI(14) drops below 30, take profit at 8%, size by inverse volatility",
  "short when the 20-day z-score is above 2, hold for 10 days maximum"
];

export function StrategyCompiler({
  universe,
  onCompiled
}: {
  universe: string;
  onCompiled: (spec: StrategySpec) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState(getApiKey() ?? "");

  const compile = async (input: string) => {
    if (!input.trim()) return;
    setBusy(true);
    try {
      const compiled = await compileWithClaude(input, universe);
      setResult(compiled);
      // Even an invalid spec is handed to the builder — the user can see what
      // was understood and fix the rest by hand.
      onCompiled(compiled.spec);
    } finally {
      setBusy(false);
    }
  };

  const saveKey = () => {
    setApiKey(key.trim() || null);
    setShowKey(false);
  };

  return (
    <div className="rounded-[24px] border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
          02 / Describe it
        </span>
        <button
          onClick={() => setShowKey((open) => !open)}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground hover:text-foreground"
        >
          <KeyRound size={12} />
          {getApiKey() ? "Key set" : "Add key"}
        </button>
      </div>

      {showKey && (
        <div className="mt-3 rounded-xl border border-border bg-background/50 p-3">
          <p className="text-[11px] leading-5 text-muted-foreground">
            Optional. Without a key the description is parsed locally, which handles most common phrasings. A key
            enables the Claude compiler for unusual ones. It is stored in this browser only and is never sent anywhere
            except to Anthropic.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="sk-ant-…"
              className="min-w-0 flex-1 rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-signal"
            />
            <button
              onClick={saveKey}
              className="shrink-0 rounded-lg border border-signal/50 bg-signal/10 px-3 py-2 text-xs text-foreground hover:bg-signal/20"
            >
              Save
            </button>
          </div>
        </div>
      )}

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        placeholder="Describe a strategy in plain English…"
        className="mt-3 w-full resize-none rounded-xl border border-border bg-muted px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition-colors focus:border-signal"
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            onClick={() => {
              setText(example);
              compile(example);
            }}
            className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-signal/50 hover:text-foreground"
          >
            <Sparkles size={10} className="mr-1 inline" />
            {example.split(",")[0]}
          </button>
        ))}
      </div>

      <button
        onClick={() => compile(text)}
        disabled={busy || !text.trim()}
        className={cn(
          "mt-3 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors",
          busy || !text.trim()
            ? "border-border text-muted-foreground"
            : "border-signal/50 bg-signal/10 text-foreground hover:bg-signal/20"
        )}
      >
        <Wand2 size={14} />
        {busy ? "Compiling…" : "Compile to a strategy"}
      </button>

      {result && (
        <div className="mt-3 space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">
            Compiled {result.source === "claude" ? "via Claude" : "locally"}
          </p>
          {result.notes.map((note) => (
            <p key={note} className="text-[11px] leading-5 text-amber-300/80">
              {note}
            </p>
          ))}
          {result.issues.map((issue) => (
            <p key={issue.field + issue.message} className="text-[11px] leading-5 text-red-300">
              {issue.message}
            </p>
          ))}
          {!result.notes.length && !result.issues.length && (
            <p className="text-[11px] leading-5 text-emerald-300/80">
              Understood cleanly. Check the builder below before running it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
