// Is the reported error of a velocity right on REAL SPHEREx frames, and how often does a search fail?   Needs a backend that serves only the real files
// (SPHEREX_DATA_DIR=backend/data/real, port 8003). No new download.
//
//   node scratch/validate_uncertainty_real.mjs --api http://localhost:8003 --field "Barnard D2" --trials 30 --seed 1
//
// Fake movers (Gaussian stars with the PSF of the headers, integrated over the pixels) are added to the real frames along straight paths of KNOWN velocity, exactly as
// calibrate_real.mjs does, and the unchanged detector is run. For every recovered fake the velocity error is compared with the truth:
//   z = (measured - true) / error, per axis, with three errors: the calibrated one the app reports (vErrPx), the NOMINAL one (the S/N model alone: vModelPx), and
//   the statistical + scatter part without the systematic floor. If an error is right, about 68 % of the z are inside +-1 and 95 % inside +-2.
// Failures are counted, not hidden: not found at all; found but on a different path (a wrong candidate); found but more than 3 sigma off the truth.
// Also: an empty-field control (every frame rotated/mirrored and shifted at random, so no correspondence is left): how many empty fields list a candidate, and how large the largest
// "significance" of such a false candidate is (so a reader can see what a given significance is worth).
// What it does NOT cover: real variable stars, the real PSF, the pointing of the files (the stars supply their own shifts), objects fainter than 12 detector-noise units.

import { detectSources, findMovers, registerShifts, moverPositionAtMjd, passIndices } from "../frontend/js/features/movers.js";
import { velocityBudget } from "../frontend/js/features/uncertainty.js";
import { loadField, mulberry32, parseArgs, dihedral, wrapShift, wilson } from "./lib_real.mjs";

const FIELDS = {
  "Barnard D2": { ra: 269.4462, dec: 4.769, det: "D2" }, "Barnard D6": { ra: 269.4462, dec: 4.769, det: "D6" },
  "Epsilon Indi B D2": { ra: 331.0965, dec: -56.8006, det: "D2" }, "Epsilon Indi B D6": { ra: 331.0965, dec: -56.8006, det: "D6" },
  "WISE 0855 D2": { ra: 133.7598, dec: -7.2422, det: "D2" }, "WISE 0855 D6": { ra: 133.7598, dec: -7.2422, det: "D6" },
};
const AMPS = [15, 26, 50];                    // total flux in units of the detector's own noise (as calibrate_real.mjs)
const SPEEDS = [4, 10, 30];                   // arcsec per year
const MARGIN = 4;
const FWHM_ARCSEC = { D2: 5.15, D6: 6.61 };

const args = parseArgs();
const api = args.api ?? "http://localhost:8003", trials = Number(args.trials ?? 30), nulls = Number(args.nulls ?? 100), seed = Number(args.seed ?? 1);
const field = FIELDS[args.field];
if (!field) { console.error(`--field must be one of: ${Object.keys(FIELDS).join(", ")}`); process.exit(2); }
const SIGMA_PSF = FWHM_ARCSEC[field.det] / 2.3548 / 6.14;
const erf = (x) => { const a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a); return x < 0 ? -y : y; };
const boxShare = (lo, hi, mu) => 0.5 * (erf((hi - mu) / (SIGMA_PSF * Math.SQRT2)) - erf((lo - mu) / (SIGMA_PSF * Math.SQRT2)));
const pixelShare = (i, j, x, y) => boxShare(i, i + 1, x) * boxShare(j, j + 1, y);

const { frames, arrays, masks, n, scale } = await loadField(api, field.ra, field.dec, 5, field.det);
const N = frames.length, mjds = frames.map((f) => f.mjd);
const detect = (imgs, ms) => imgs.map((a, k) => ({ mjd: mjds[k], sources: detectSources(a, n, { sigmaFloor: 1e-9, mask: ms[k] }) }));
function detectorNoise(img) {
  const g = Float32Array.from(img, (v) => (Number.isFinite(v) ? v : 0)), tmp = new Float32Array(n * n), sm = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) tmp[y * n + x] = (g[y * n + Math.max(0, x - 1)] + 2 * g[y * n + x] + g[y * n + Math.min(n - 1, x + 1)]) / 4;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) sm[y * n + x] = (tmp[Math.max(0, y - 1) * n + x] + 2 * tmp[y * n + x] + tmp[Math.min(n - 1, y + 1) * n + x]) / 4;
  const s = Array.from(sm).sort((a, b) => a - b);
  return s[Math.floor(0.8413 * s.length)] - s[Math.floor(0.5 * s.length)];
}
const noise = arrays.map(detectorNoise);
const baseDots = detect(arrays, masks);
const shifts = registerShifts(baseDots).map((s) => (Math.abs(s.dx) > 0.05 || Math.abs(s.dy) > 0.05 ? s : { dx: 0, dy: 0 }));
const baseCands = findMovers(baseDots, { area: n * n }).candidates;
const midMjd = (mjds[0] + mjds[N - 1]) / 2, t = mjds.map((m) => (m - midMjd) / 365.25);
const passes = passIndices(mjds).at(-1) + 1;
const samePath = (c, truth, tol = 1.5) => {
  const d = truth.map((p, k) => { const q = moverPositionAtMjd(c, mjds[k]); return Math.hypot(q.x - p.x, q.y - p.y); }).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] <= tol;
};

// ------------------------------------------------------------------ fakes
const rng = mulberry32(seed);
const z = { calibrated: [], nominal: [], noFloor: [] };           // per axis
const zBright = [];                                                 // calibrated z of the brightest fakes only (a faint fake is often "found" by a chance line near its path)
const tally = { trials: 0, skipped: 0, notFound: 0, found: 0, wrongOnly: 0, over3: 0, wrongExtra: 0 };
const cells = [];
for (const amp of AMPS) for (const sp of SPEEDS) {
  const cell = { amp, sp, trials: 0, found: 0, zc: [] };
  const vpx = sp / scale;
  for (let trial = 0; trial < trials; trial++) {
    let truth = null, vx = 0, vy = 0;
    for (let tries = 0; tries < 300 && !truth; tries++) {
      const th = rng() * 2 * Math.PI;
      vx = vpx * Math.cos(th); vy = vpx * Math.sin(th);
      const x0 = MARGIN + rng() * (n - 2 * MARGIN), y0 = MARGIN + rng() * (n - 2 * MARGIN);
      const path = t.map((tk, k) => ({ x: x0 + vx * tk, y: y0 + vy * tk, sx: shifts[k].dx, sy: shifts[k].dy }));
      if (path.every((p) => p.x + p.sx >= MARGIN && p.x + p.sx <= n - MARGIN && p.y + p.sy >= MARGIN && p.y + p.sy <= n - MARGIN)) truth = path;
    }
    if (!truth) { tally.skipped++; continue; }
    const imgs = arrays.map((a, k) => {
      const img = Float32Array.from(a), flux = amp * noise[k], px = truth[k].x + truth[k].sx, py = truth[k].y + truth[k].sy;
      for (let j = Math.max(0, Math.floor(py - 4)); j <= Math.min(n - 1, Math.ceil(py + 4)); j++) for (let i = Math.max(0, Math.floor(px - 4)); i <= Math.min(n - 1, Math.ceil(px + 4)); i++) img[j * n + i] += flux * pixelShare(i, j, px, py);
      return img;
    });
    const out = findMovers(detect(imgs, masks), { area: n * n });
    cell.trials++; tally.trials++;
    const hits = out.candidates.filter((c) => samePath(c, truth));
    const extra = out.candidates.filter((c) => !samePath(c, truth) && !baseCands.some((b) => samePath(b, truth.map((_, k) => moverPositionAtMjd(c, mjds[k])))));
    if (extra.length) tally.wrongExtra++;
    // "another candidate" means one that is neither the fake nor a candidate the uninjected field already has (Barnard's Star itself is one)
    if (!hits.length) { if (extra.length) tally.wrongOnly++; else tally.notFound++; continue; }
    const c = hits.sort((a, b) => b.significance - a.significance)[0];
    cell.found++; tally.found++;
    const trueV = [vx, vy], got = [c.vx, c.vy];
    const nominal = c.vModelPx, noFloor = c.vModelPx * c.inflation, calibrated = c.vErrPx;
    for (let a = 0; a < 2; a++) {
      const d = got[a] - trueV[a];
      z.calibrated.push(d / calibrated); z.nominal.push(d / nominal); z.noFloor.push(d / noFloor);
      cell.zc.push(d / calibrated);
      if (amp === AMPS.at(-1)) zBright.push(d / calibrated);
    }
    if (Math.hypot((got[0] - trueV[0]) / calibrated, (got[1] - trueV[1]) / calibrated) > 3) tally.over3++;
  }
  cells.push(cell);
}

const within = (arr, k) => arr.filter((v) => Math.abs(v) <= k).length;
const pct = (k, m) => `${(100 * k / Math.max(1, m)).toFixed(0)} % (${k}/${m})`;
const rms = (arr) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / Math.max(1, arr.length));
console.log(`## ${args.field}: ${N} images, ${passes} survey passes, ${n} x ${n} px of ${scale}", seed ${seed}, ${trials} fakes per cell, ${AMPS.length * SPEEDS.length} cells`);
console.log(`\n### Does the reported velocity error cover the truth? (${z.calibrated.length / 2} recovered fakes, ${z.calibrated.length} axes)\n`);
console.log("| error used | inside 1 sigma (68 % expected) | inside 2 sigma (95 % expected) | rms of z (1 expected) |\n|---|---|---|---|");
for (const [name, label] of [["calibrated", "calibrated (what the app reports)"], ["noFloor", "statistical + scatter, no systematic floor"], ["nominal", "nominal (S/N model alone)"]]) {
  console.log(`| ${label} | ${pct(within(z[name], 1), z[name].length)} | ${pct(within(z[name], 2), z[name].length)} | ${rms(z[name]).toFixed(2)} |`);
}
const medAbs = (arr) => { const a = arr.map(Math.abs).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
console.log(`\nMedian |z| of all recovered fakes (calibrated; 0.67 expected for a Gaussian error): ${medAbs(z.calibrated).toFixed(2)}; share beyond 3 sigma on one axis: ${pct(z.calibrated.filter((v) => Math.abs(v) > 3).length, z.calibrated.length)}.`);
console.log(`Brightest fakes only (flux ${AMPS.at(-1)} x noise): inside 1 sigma ${pct(within(zBright, 1), zBright.length)}, inside 2 sigma ${pct(within(zBright, 2), zBright.length)}, median |z| ${medAbs(zBright).toFixed(2)}, rms ${rms(zBright).toFixed(2)}.`);
console.log("\n### Failures (nothing hidden)\n");
console.log(`- Fakes placed: ${tally.trials} (${tally.skipped} paths could not be placed inside the field and were skipped).`);
console.log(`- Found on the right path: ${pct(tally.found, tally.trials)}.`);
console.log(`- Not found, no candidate at all: ${pct(tally.notFound, tally.trials)}. Not found but another candidate was listed: ${pct(tally.wrongOnly, tally.trials)}.`);
console.log(`- Found but more than 3 sigma (calibrated, both axes together) from the true velocity: ${pct(tally.over3, Math.max(1, tally.found))} of the found.`);
console.log(`- Runs that listed a false candidate besides the fake: ${pct(tally.wrongExtra, tally.trials)}.`);
console.log("\n| flux / noise | speed (arcsec/yr) | found | median abs z (calibrated) | rms z |\n|---|---|---|---|---|");
for (const c of cells) console.log(`| ${c.amp} | ${c.sp} | ${pct(c.found, c.trials)} | ${c.zc.length ? medAbs(c.zc).toFixed(2) : "-"} | ${c.zc.length ? rms(c.zc).toFixed(2) : "-"} |`);

// ------------------------------------------------------------------ empty-field control
const rng2 = mulberry32(seed + 7919);
let withCand = 0; const maxSig = [];
for (let r = 0; r < nulls; r++) {
  const imgs = [], ms = [];
  for (let k = 0; k < N; k++) {
    const d = Math.floor(rng2() * 8), sx = Math.floor(rng2() * n), sy = Math.floor(rng2() * n);
    imgs.push(wrapShift(dihedral(arrays[k], n, d), n, sx, sy));
    ms.push(masks[k] ? wrapShift(dihedral(masks[k], n, d), n, sx, sy) : null);
  }
  const cands = findMovers(detect(imgs, ms), { area: n * n }).candidates;
  if (cands.length) { withCand++; maxSig.push(Math.max(...cands.map((c) => c.significance))); }
}
const [lo, hi] = wilson(withCand, nulls);
console.log(`\n### Empty-field control: ${nulls} scrambled copies of the field\n`);
console.log(`- Copies that list at least one candidate with the default rule: ${pct(withCand, nulls)} (95 % interval ${(100 * lo).toFixed(1)}-${(100 * hi).toFixed(1)} %).`);
console.log(`- Largest significance among those false candidates: ${maxSig.length ? Math.max(...maxSig).toFixed(0) : "none"} sigma (so a significance below this is not by itself a reason to believe a line).`);
console.log(`\nJSON ${JSON.stringify({ field: args.field, N, passes, trials, seed, z: Object.fromEntries(Object.entries(z).map(([k, v]) => [k, { n: v.length, in1: within(v, 1), in2: within(v, 2), rms: rms(v), medianAbs: medAbs(v) }])), bright: { n: zBright.length, in1: within(zBright, 1), in2: within(zBright, 2), medianAbs: medAbs(zBright), rms: rms(zBright) }, tally, nulls, nullWithCandidate: withCand, nullMaxSignificance: maxSig.length ? Math.max(...maxSig) : null })}`);
