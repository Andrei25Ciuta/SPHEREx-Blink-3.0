// A golden test of the scientific output: three deterministic scenarios (scratch/benchmark.mjs) must still give exactly the digest written in scratch/benchmark_baseline.json.
// A faster search that finds something different fails here. If a scientific change was MEANT, write a new baseline (node scratch/benchmark.mjs --write) and say so in the commit.
// The timings are not tested (they depend on the machine).   Run: node scratch/test_benchmark.mjs
import { readFileSync } from "node:fs";
import { canon, digest, scenarios, measure } from "./benchmark.mjs";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

// ---------------------------------------------------------------- the digest
check("canon: numbers to 5 significant digits, so a change in the 6th digit is not a change, and one in the 5th is", digest({ a: 1.2345678 }) === digest({ a: 1.2345699 }) && digest({ a: 1.23456 }) !== digest({ a: 1.23466 }) && canon(123456.789) === 123460);
check("canon: the order of the keys does not matter, the order of a list does; a function is not data; a NaN or an infinity is written as text, not lost",
  digest({ a: 1, b: 2 }) === digest({ b: 2, a: 1 }) && digest([1, 2]) !== digest([2, 1]) && digest({ a: 1, f: () => 1 }) === digest({ a: 1 }) && digest({ a: NaN }) !== digest({ a: 0 }) && digest({ a: Infinity }) !== digest({ a: NaN }));
check("digest: 16 hex digits, the same for the same data", /^[0-9a-f]{16}$/.test(digest([1, { x: "y" }])) && digest([1, { x: "y" }]) === digest([1, { x: "y" }]));

// ---------------------------------------------------------------- the golden outputs
const baseline = JSON.parse(readFileSync(new URL("./benchmark_baseline.json", import.meta.url), "utf8"));
check("baseline: three scenarios, each with a name, a 16-digit digest and a positive time, made on a date with a Node version", baseline.scenarios.length === 3 && baseline.scenarios.every((s) => /^[0-9a-f]{16}$/.test(s.digest) && s.ms > 0 && s.name.length > 10) && /^\d{4}-\d{2}-\d{2}$/.test(baseline.made) && /^v\d+/.test(baseline.node));
const now = scenarios().map((s) => measure(s, 1));
for (const r of now) {
  const b = baseline.scenarios.find((x) => x.name === r.name);
  check(`golden output: ${r.name}`, Boolean(b) && b.digest === r.digest, b ? `${r.digest} against ${b.digest}` : "not in the baseline");
}
check("the scenarios are the ones of the baseline, in the same order", now.map((r) => r.name).join("|") === baseline.scenarios.map((s) => s.name).join("|"));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
