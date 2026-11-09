// How fast are the searches, and do they still give EXACTLY the same answers?   Run:
//
//   node scratch/benchmark.mjs                 the table: median time of each scenario and the digest of what it found
//   node scratch/benchmark.mjs --check         compare the digests with scratch/benchmark_baseline.json (exit 1 if one differs) and show the timings against the baseline
//   node scratch/benchmark.mjs --write         write a new baseline (do it only when a scientific change was meant: say so in the commit)
//   node scratch/benchmark.mjs --repeats 5     more repeats for the median
//
// Three deterministic scenarios (a seeded generator, synthetic images with a pixel-integrated Gaussian PSF on white noise): the dots of 30 images, the search for movers in 18 images, the
// search for a distant body in 12 images of a 30 arcmin field. For each: the median time, and a DIGEST of the scientific output (the candidates, their numbers to 5 significant digits, in a
// canonical form). A change that makes a search faster but changes what it finds changes the digest: that is what "identical scientific output" means in practice, and test_benchmark.mjs
// fails on it. Timings are not tested (they depend on the machine); they are written down so that "before" and "after" can be compared.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import { detectSources, findMoversInImages } from "../frontend/js/features/movers.js";
import { findDistantMovers } from "../frontend/js/features/parallax.js";
import { injectDistantMover, registrationOf } from "../frontend/js/features/planetLab.js";
import { mulberry32, renderStar } from "./lib_inject.mjs";

const BASELINE = new URL("./benchmark_baseline.json", import.meta.url);

/** A value in a canonical form: numbers to 5 significant digits, keys sorted, nothing that is not data. */
export function canon(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Number(v.toPrecision(5)) : String(v);
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => typeof v[k] !== "function").map((k) => [k, canon(v[k])]));
  return v;
}
export const digest = (v) => createHash("sha1").update(JSON.stringify(canon(v))).digest("hex").slice(0, 16);

// ---------------------------------------------------------------- the scenarios
function dotsScenario() {
  const n = 293, rng = mulberry32(101);
  const stars = Array.from({ length: 60 }, () => ({ x: 10 + rng() * (n - 20), y: 10 + rng() * (n - 20), flux: 40 + rng() * 400 }));
  const images = Array.from({ length: 30 }, () => renderStar(n, 0, 0, 0, 0.4, rng, { noise: 1, extra: stars.map((s) => ({ ...s, x: s.x + 0.3 * (rng() - 0.5), y: s.y + 0.3 * (rng() - 0.5) })) }));
  return { name: "detect: the dots of 30 images of 293 x 293 px", run: () => images.map((img) => detectSources(img, n, { sigmaFloor: 1e-9 }).map((d) => ({ x: d.x, y: d.y, snr: d.snr, sigmaPx: d.sigmaPx }))) };
}
function moversScenario() {
  const n = 49, rng = mulberry32(202), days = [0, 0.1, 0.2, 0.3, 0.4, 120, 120.1, 120.2, 120.3, 120.4, 250, 250.1, 250.2, 250.3, 250.4, 250.5, 397, 397.1];
  const mjds = days.map((d) => 60908 + d), ref = (mjds[0] + mjds.at(-1)) / 2;
  const fixed = Array.from({ length: 14 }, () => ({ x: 6 + rng() * 37, y: 6 + rng() * 37, flux: 60 + rng() * 300 }));
  const frames = mjds.map((m) => { const yr = (m - ref) / 365.25; return { mjd: m, grey: renderStar(n, 0, 0, 0, 0.4, rng, { noise: 1, extra: [...fixed, { x: 20 + 1.7 * yr, y: 28 - 0.9 * yr, flux: 120 }] }) }; });
  return { name: "movers: 18 images of 49 x 49 px, one mover among 14 stars", run: () => findMoversInImages(frames, n, { sigmaFloor: 1e-9, register: false }) };
}
function distantScenario() {
  const n = 293, geo = { ra: 136.5, dec: 16.6, n, scaleArcsec: 6.14 }, rng = mulberry32(303);
  const days = [0, 0.1, 0.2, 120, 120.1, 120.2, 250, 250.1, 250.2, 397, 397.1, 397.2], mjds = days.map((d) => 60908 + d);
  const stars = Array.from({ length: 40 }, () => ({ x: 15 + rng() * (n - 30), y: 15 + rng() * (n - 30), flux: 60 + rng() * 240 }));
  const arrays = mjds.map((_, k) => renderStar(n, 0, 0, 0, 0.4, rng, { noise: 1, extra: stars.map((s) => ({ x: s.x + 0.7 * Math.sin(k), y: s.y - 0.5 * Math.cos(k), flux: s.flux })) }));
  const plain = arrays.map((a, k) => ({ mjd: mjds[k], sources: detectSources(a, n, { sigmaFloor: 1e-9 }) }));
  const shifts = registrationOf(plain);
  return { name: "distant: a body at 800 AU in 12 images of a 30 arcmin field (inject, detect, search)", run: () => {
    const inj = injectDistantMover({ arrays, mjds, geo, spec: { distanceAU: 800, fluxMilliJy: 40, fx: 0.5, fy: 0.5, driftEast: 20, driftNorth: -8 }, shifts });
    const frames = inj.arrays.map((a, k) => ({ mjd: mjds[k], sources: detectSources(a, n, { sigmaFloor: 1e-9 }) }));
    const { candidates, stats } = findDistantMovers(frames, geo, {});
    return { stats: { seeds: stats.seeds, triples: stats.triples }, candidates: candidates.map((c) => ({ x: c.x, y: c.y, vx: c.vx, vy: c.vy, distanceAU: c.distanceAU, parallaxSigma: c.parallaxSigma, nDet: c.nDet, rms: c.rms })) };
  } };
}
export const scenarios = () => [dotsScenario(), moversScenario(), distantScenario()];

/** Run a scenario `repeats` times: the median time (ms) and the digest of its (first) output. */
export function measure(scenario, repeats = 3) {
  const times = []; let out = null;
  for (let i = 0; i < repeats; i++) { const t0 = performance.now(); const r = scenario.run(); times.push(performance.now() - t0); if (i === 0) out = r; }
  times.sort((a, b) => a - b);
  return { name: scenario.name, ms: times[Math.floor(times.length / 2)], digest: digest(out) };
}

// ---------------------------------------------------------------- the command line
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const args = process.argv.slice(2), has = (f) => args.includes(f);
  const repeats = Number(args[args.indexOf("--repeats") + 1]) || 3;
  const results = scenarios().map((s) => measure(s, repeats));
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
  console.log(`Node ${process.version}, ${os.cpus()[0]?.model ?? "?"}, ${os.platform()}; median of ${repeats}\n`);
  console.log("| scenario | median time (ms) | digest of the output |" + (base ? " baseline time (ms) | same output as the baseline |" : "") + "\n|---|---|---|" + (base ? "---|---|" : ""));
  let differ = 0;
  for (const r of results) {
    const b = base?.scenarios?.find((x) => x.name === r.name);
    if (b && b.digest !== r.digest) differ++;
    console.log(`| ${r.name} | ${r.ms.toFixed(0)} | \`${r.digest}\` |` + (base ? ` ${b ? b.ms.toFixed(0) : "–"} | ${b ? (b.digest === r.digest ? "yes" : "**NO**") : "not in the baseline"} |` : ""));
  }
  if (has("--write")) {
    writeFileSync(BASELINE, JSON.stringify({ made: new Date().toISOString().slice(0, 10), node: process.version, machine: `${os.cpus()[0]?.model ?? "?"}, ${os.platform()}`, scenarios: results }, null, 2) + "\n");
    console.log(`\nbaseline written: ${BASELINE.pathname}`);
  }
  if (has("--check") && differ) { console.error(`\n${differ} scenario(s) give a different output from the baseline: a scientific change, or a bug.`); process.exit(1); }
}
