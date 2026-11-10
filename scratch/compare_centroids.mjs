// Windowed centroid or PSF fit?  The position error of both, on injected stars, against the Cramer-Rao limit.   Run:
//
//   node scratch/compare_centroids.mjs [--trials 1500] [--seed 1]
//
// A star (a Gaussian integrated over each pixel, as the SPHEREx PSF is: scratch/lib_inject.mjs) of a given total flux is put at a random place inside a pixel on white noise of
// unit standard deviation; the detector (detectSources) finds it and gives the windowed centroid it always gave; fitPsfCentroid then refines that position by least squares
// with the true PSF width. For each total flux and PSF width the table gives, per axis: how often the star was found, the rms error of each estimator, the Cramer-Rao
// limit (the best any unbiased estimator can do), and the pixel-phase bias (the largest mean error over 8 bins of the star's place inside its pixel).
// Everything is synthetic: it says how well each ESTIMATOR measures an ideal star; the real images (a PSF that is not exactly Gaussian, neighbours, correlated noise) are
// the subject of scratch/check_astrometry_real.mjs.

import { detectSources, fitPsfCentroid } from "../frontend/js/features/movers.js";
import { mulberry32, renderStar, crlbX, rms } from "./lib_inject.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const TRIALS = Number(args.trials ?? 1500), SEED = Number(args.seed ?? 1);
const N = 31, BINS = 8;
const median = (img) => { const s = Float32Array.from(img).sort(); return s[s.length >> 1]; };

console.log("| PSF sigma (px) | total flux | found | windowed rms (px) | PSF-fit rms (px) | Cramer-Rao (px) | fit / limit | windowed phase bias | PSF-fit phase bias |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const sigma of [0.356, 0.457]) {
  for (const flux of [20, 40, 80, 160, 320, 640]) {
    const rng = mulberry32(SEED * 1000 + Math.round(flux) + Math.round(sigma * 1000));
    const ew = [], ef = [], binW = Array.from({ length: BINS }, () => []), binF = Array.from({ length: BINS }, () => []);
    let found = 0, limit = 0;
    for (let t = 0; t < TRIALS; t++) {
      const x0 = 15 + rng(), y0 = 15 + rng();
      const img = renderStar(N, x0, y0, flux, sigma, rng);
      const dots = detectSources(img, N, { psfSigmaPx: sigma, edgeMargin: 4, sigmaFloor: 1e-9 }).filter((d) => Math.hypot(d.x - x0, d.y - y0) < 2);
      if (!dots.length) continue;
      const d = dots.reduce((a, b) => (Math.hypot(a.x - x0, a.y - y0) <= Math.hypot(b.x - x0, b.y - y0) ? a : b));
      found++;
      const fit = fitPsfCentroid(img, N, Math.floor(d.x), Math.floor(d.y), { sigma, start: d, background: median(img) });
      limit += crlbX(N, x0, y0, flux, sigma, 1);
      ew.push(d.x - x0, d.y - y0);
      const f = fit ?? d;                                   // a fit that fails keeps the windowed position, as the detector would
      ef.push(f.x - x0, f.y - y0);
      const bx = Math.min(BINS - 1, Math.floor((x0 % 1) * BINS)), by = Math.min(BINS - 1, Math.floor((y0 % 1) * BINS));
      binW[bx].push(d.x - x0); binF[bx].push(f.x - x0); binW[by].push(d.y - y0); binF[by].push(f.y - y0);
    }
    if (found < 50) { console.log(`| ${sigma} | ${flux} | ${found} / ${TRIALS} | – | – | – | – | – | – |`); continue; }
    const biasOf = (bins) => Math.max(...bins.filter((b) => b.length > 20).map((b) => Math.abs(b.reduce((a, v) => a + v, 0) / b.length)));
    const cr = limit / found;
    console.log(`| ${sigma} | ${flux} | ${(100 * found / TRIALS).toFixed(0)} % | ${rms(ew).toFixed(3)} | ${rms(ef).toFixed(3)} | ${cr.toFixed(3)} | ${(rms(ef) / cr).toFixed(2)} | ${biasOf(binW).toFixed(3)} | ${biasOf(binF).toFixed(3)} |`);
  }
}

// ---------------------------------------------------------------- the error model of each estimator: sigma^2 = (A / snr)^2 + B^2, with snr the dot's own S/N (detectSources)
// The same method as section B of scratch/calibrate_astrometry.mjs (so the windowed row must reproduce the A and B written in movers.js): flux log-uniform from 8 to 900,
// the dots grouped by S/N into the same bins, the mean square error per axis of each bin, then a weighted least-squares line of it against 1 / snr^2 (weights 1 / variance^2).
const EDGES = [4, 6, 8, 12, 20, 35, 60, 120, 400];
console.log("");
console.log("| PSF sigma (px) | estimator | A (px) | B (px) | dots |");
console.log("|---|---|---|---|---|");
for (const sigma of [0.356, 0.4, 0.457]) {
  const rng = mulberry32(SEED * 7919 + Math.round(sigma * 1000));
  const rows = { windowed: [], fit: [] };
  for (let t = 0; t < TRIALS * 12; t++) {
    const x0 = 15 + rng(), y0 = 15 + rng(), flux = Math.exp(Math.log(8) + rng() * (Math.log(900) - Math.log(8)));
    const img = renderStar(N, x0, y0, flux, sigma, rng);
    const dots = detectSources(img, N, { psfSigmaPx: sigma, edgeMargin: 4, sigmaFloor: 1e-9 }).filter((d) => Math.hypot(d.x - x0, d.y - y0) < 2);
    if (!dots.length) continue;
    const d = dots.reduce((a, b) => (Math.hypot(a.x - x0, a.y - y0) <= Math.hypot(b.x - x0, b.y - y0) ? a : b));
    const fit = fitPsfCentroid(img, N, Math.floor(d.x), Math.floor(d.y), { sigma, start: d, background: median(img) }) ?? d;
    rows.windowed.push({ snr: d.snr, sq: (d.x - x0) ** 2 + (d.y - y0) ** 2 });
    rows.fit.push({ snr: d.snr, sq: (fit.x - x0) ** 2 + (fit.y - y0) ** 2 });
  }
  for (const [name, list] of Object.entries(rows)) {
    const bins = EDGES.slice(1).map(() => ({ sq: 0, n: 0, snr: 0 }));
    for (const r of list) { const k = EDGES.findIndex((e, i) => i > 0 && r.snr < e) - 1; if (k < 0 || k >= bins.length) continue; bins[k].sq += r.sq; bins[k].n += 2; bins[k].snr += 2 * r.snr; }
    const pts = bins.filter((b) => b.n > 40).map((b) => ({ snr: b.snr / b.n, v: b.sq / b.n, n: b.n }));
    let s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0;
    for (const p of pts) { const u = 1 / p.snr ** 2, w = p.n / p.v ** 2; s11 += w * u * u; s12 += w * u; s22 += w; t1 += w * u * p.v; t2 += w * p.v; }
    const det = s11 * s22 - s12 * s12;
    const A = Math.sqrt(Math.max(0, (t1 * s22 - t2 * s12) / det)), B = Math.sqrt(Math.max(0, (s11 * t2 - s12 * t1) / det));
    console.log(`| ${sigma} | ${name === "fit" ? "PSF fit" : "windowed centroid"} | ${A.toFixed(3)} | ${B.toFixed(3)} | ${list.length} |`);
  }
}
