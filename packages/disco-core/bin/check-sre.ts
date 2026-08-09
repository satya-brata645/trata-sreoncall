/** Validate the pinned SRE spec against the newest artifact. Throwaway-safe: read-only. */
import { bindDashboard } from "../../../lib/artifacts/dashboard";
import { resolve } from "../src/resolve";
import { formatIssues } from "../src/validate";

const bound = bindDashboard("sre-oncall");
if (!bound) { console.error("no spec or no run — did you seed?"); process.exit(1); }

const r = resolve(bound.spec, bound.profile, bound.base, { now: Date.parse(bound.asOf) });
console.log(`run ${bound.runId} · ${bound.profile.tables.length} tables`);
console.log(`repairs: ${r.repairs.length}`);
for (const x of r.repairs) console.log(`  ${x.ruleId} @ ${x.where}: ${x.note}`);
console.log(`unresolved: ${r.unresolved.length}`);
if (r.unresolved.length) console.log(formatIssues(r.unresolved));
process.exit(r.unresolved.filter((i) => i.level === "error").length ? 1 : 0);
