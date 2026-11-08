// How likely is the app's distant-body search to find a body of a given distance and brightness in a REAL field?  The numbers of docs/VALIDATION.md section 16.
//
//   node scratch/planet_lab_map.mjs [--api http://localhost:8003] [--ra 269.4462 --dec 4.769 --fov 5 --det D2] [--distances 1800,3000,5000] [--fluxes 10,25,50,100,300] [--trials 8] [--seed 1]
//
// The same thing as the Planet X Lab of the page (features/planetLab.js), from the command line: synthetic bodies (a Gaussian PSF integrated over the pixels, a drift of 0.5-1.0 times the
// circular speed in a random direction, a random place in the middle half of the field) are added to the real images of one detector, where a real body would be (the swing of the Earth and the
// pointing shifts of each exposure included), and findDistantMovers is run with its default options on the dots detectSources finds. A try succeeds when a candidate lies within 3 px of the body on
// at least half of the images. The images are real, the bodies are SYNTHETIC: this measures the search, it finds nothing. Run it against a backend that serves only the real files
// (SPHEREX_DATA_DIR=backend/data/real, port 8003). No download. The flux is the same in every image (a body with a spectrum would not be).

import { loadField, parseArgs } from "./lib_real.mjs";
import { detectSources, passIndices } from "../frontend/js/features/movers.js";
import { VERSION as SEARCH_VERSION, parallaxOffsetArcsec } from "../frontend/js/features/parallax.js";
import { VERSION as LAB_VERSION, recoveryTrial, runCompleteness, registrationOf, mulberry32, parseNumberList, swingArcsec, completenessWord, wilson } from "../frontend/js/features/planetLab.js";

const args = parseArgs();
const api = args.api ?? "http://localhost:8003";
const ra = Number(args.ra ?? 269.4462), dec = Number(args.dec ?? 4.769), fov = Number(args.fov ?? 5), det = args.det ?? "D2";
const distances = parseNumberList(args.distances ?? "1800,3000,5000", { min: 50, max: 20000, maxCount: 8, what: "distance" });
const fluxes = parseNumberList(args.fluxes ?? "10,25,50,100,300", { min: 0.01, max: 1e5, maxCount: 8, what: "flux" });
if (distances.error || fluxes.error) { console.error(distances.error || fluxes.error); process.exit(2); }
const trials = Number(args.trials ?? 8), seed = Number(args.seed ?? 1);

const f = await loadField(api, ra, dec, fov, det);
if (f.frames.length < 3) { console.log(`only ${f.frames.length} images: nothing to do`); process.exit(0); }
const mjds = f.frames.map((x) => x.mjd);
const detectOptions = { sigmaFloor: 1e-9 };
const plain = f.arrays.map((a, k) => ({ mjd: mjds[k], sources: detectSources(a, f.n, { ...detectOptions, mask: f.masks[k] }) }));
const shifts = registrationOf(plain);
const context = { arrays: f.arrays, masks: f.masks, mjds, geo: f.geo, shifts, detectOptions };

const started = Date.now();
const result = await runCompleteness({ distancesAU: distances.values, fluxesMilliJy: fluxes.values, trials, rng: mulberry32(seed), run: (spec) => recoveryTrial(context, spec) });

console.log(`Planet X Lab ${LAB_VERSION}, search ${SEARCH_VERSION}: ${f.frames.length} real images of ${det}, RA ${ra} Dec ${dec}, ${fov}' field (${f.n} x ${f.n} px of ${f.scale.toFixed(2)}"), ${trials} tries per cell, seed ${seed}, ${((Date.now() - started) / 1000).toFixed(0)} s.`);
console.log(`Dates: ${mjds[0].toFixed(1)} to ${mjds.at(-1).toFixed(1)} (MJD). The injected bodies are synthetic.\n`);
const header = distances.values.map((d) => { const s = swingArcsec(ra, dec, mjds, d); return `${d} AU (swing ${(s / 60).toFixed(1)}')${s > (f.n * f.scale) / 2 ? " leaves the field" : ""}`; });
console.log(`| flux (mJy) | ${header.join(" | ")} |`);
console.log(`|---|${header.map(() => "---").join("|")}|`);
for (const flux of [...fluxes.values].sort((a, b) => b - a)) {
  const row = distances.values.map((d) => {
    const c = result.cells.find((x) => x.fluxMilliJy === flux && x.distanceAU === d);
    const [lo, hi] = wilson(c.found, c.tries);
    return `${c.found} / ${c.tries} (${completenessWord(c.fraction)}; 95 %: ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)} %)${c.distanceRight !== c.found ? `, distance right in ${c.distanceRight}` : ""}`;
  });
  console.log(`| ${flux} | ${row.join(" | ")} |`);
}
// where a body would be on the first image of each survey pass (its own drift left out): how far apart the passes put it. The Earth is back at the same place after a year, so two passes about
// a year apart see the body at nearly the same place.
{
  const pass = passIndices(mjds), firsts = [];
  pass.forEach((p, k) => { if (firsts[p] === undefined) firsts[p] = k; });
  const mid = (mjds[0] + mjds.at(-1)) / 2;
  const at = (k, d) => { const o = parallaxOffsetArcsec(ra, dec, mjds[k], mid, d); return { x: -o.east / f.scale, y: -o.north / f.scale }; };
  const pairs = [];
  for (let a = 0; a < firsts.length; a++) for (let b = a + 1; b < firsts.length; b++) pairs.push([a, b]);
  console.log(`\nSeparation (pixels) between the places of a body on the first image of each pass (${firsts.length} passes, MJD ${firsts.map((k) => mjds[k].toFixed(0)).join(", ")}):`);
  console.log(`| distance | ${pairs.map(([a, b]) => `pass ${a + 1}-${b + 1} (${(mjds[firsts[b]] - mjds[firsts[a]]).toFixed(0)} d)`).join(" | ")} |`);
  console.log(`|---|${pairs.map(() => "---").join("|")}|`);
  for (const d of distances.values) console.log(`| ${d} AU | ${pairs.map(([a, b]) => { const p = at(firsts[a], d), q = at(firsts[b], d); return Math.hypot(p.x - q.x, p.y - q.y).toFixed(1); }).join(" | ")} |`);
}
// how well the dots of the found bodies agree with the model, against the 0.15 px floor the parallax search gives every dot (a floor that has never been calibrated)
const rms = result.cells.flatMap((c) => c.rms).sort((a, b) => a - b);
if (rms.length) {
  const q = (p) => rms[Math.min(rms.length - 1, Math.floor(p * rms.length))];
  console.log(`\nRms of the dots of the ${rms.length} bodies that were found, about their model: median ${q(0.5).toFixed(3)} px, 10th-90th percentile ${q(0.1).toFixed(3)}-${q(0.9).toFixed(3)} px (the search never trusts a dot better than 0.15 px).`);
}
