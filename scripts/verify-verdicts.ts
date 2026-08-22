/** Do the attacks now discriminate, rather than failing everything? */
import { loadInstrument, INSTRUMENTS } from "../src/lib/adversary/instruments";
import { PLAYBOOK, playbookFor } from "../src/lib/adversary/playbook";
import { runBacktest, DEFAULT_COSTS } from "../src/lib/adversary/engine";
import { SignalCache } from "../src/lib/adversary/signals";
import {
  attackSearchCost, attackParameterStability, attackRegimeDependence,
  attackCostSensitivity, attackNoiseBenchmark, attackSyntheticMarkets,
  attackHaircut, attackOverfitting, buildVerdict
} from "../src/lib/adversary/attacks";
import { annualise } from "../src/lib/adversary/stats";
import { validateSpec } from "../src/lib/adversary/spec";

const counts = { SURVIVED: 0, WOUNDED: 0, DEAD: 0 };

for (const tk of ["^GSPC", "AAPL", "GC=F", "EURUSD=X"]) {
  const inst = INSTRUMENTS.find(i => i.ticker === tk)!;
  const bars = loadInstrument(tk);
  const cache = new SignalCache(bars);
  console.log(`\n── ${inst.label}`);

  for (const entry of playbookFor(inst.assetClass)) {
    const spec = entry.build(tk, inst.assetClass);
    if (validateSpec(spec).length) continue;
    const r = runBacktest(spec, bars, DEFAULT_COSTS, cache);
    const m = r.metrics;
    if (m.tradeCount === 0) continue;

    // A realistic search: the playbook the user browsed.
    const N = PLAYBOOK.length;
    const all = [
      attackSearchCost(m.sharpe, m.skew, m.kurt, m.observations, [], N),
      attackParameterStability(spec, bars, DEFAULT_COSTS, cache),
      attackRegimeDependence(r.returns, bars.dates),
      attackCostSensitivity(spec, bars, cache),
      attackNoiseBenchmark(m.sharpe, bars, DEFAULT_COSTS, cache, 200, 7),
      attackSyntheticMarkets(spec, bars, DEFAULT_COSTS, 60, 11),
      attackHaircut(m.sharpe, m.observations, N),
      attackOverfitting(spec, bars, DEFAULT_COSTS, cache)
    ];
    const v = buildVerdict(all, { sharpe: m.sharpe, skew: m.skew, kurt: m.kurt, observations: m.observations });
    counts[v.status]++;
    const fails = all.filter(a => a.status === "fail").length;
    const warns = all.filter(a => a.status === "warn").length;
    console.log(
      `   ${entry.name.padEnd(28)} SR ${annualise(m.sharpe).toFixed(2).padStart(6)}  ` +
      `${v.status.padEnd(9)} ${fails}F/${warns}W  now: ${r.stance.position}`
    );
  }
}
console.log(`\nTOTAL: ${counts.SURVIVED} survived, ${counts.WOUNDED} wounded, ${counts.DEAD} dead\n`);
