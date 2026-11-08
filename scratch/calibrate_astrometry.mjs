// The numbers of docs/VALIDATION.md §15 (Phase 4): how accurate are the positions, the velocities and the fluxes, and are the ERRORS reported with them right?
// Injected point sources (pixel-integrated Gaussian PSF on white noise); the same code as scratch/test_astrometry.mjs, with more trials and the tables printed.
//   node scratch/calibrate_astrometry.mjs            (about 1 minute)
// The same errors on the REAL images: node scratch/check_astrometry_real.mjs.

import { detectSources, findMoversInImages, apertureSnr, centroidSigmaPx, POSITION_NOISE_COEFF } from "../frontend/js/features/movers.js";
import { mulberry32, renderStar, crlbX, mean, sd, rms, within } from "./lib_inject.mjs";

const n = 49;
const pad = (v, w) => String(v).padStart(w);

function inject(trials, flux, sigma, seed) {
  const rng = mulberry32(seed), rows = []; let missed = 0;
  for (let t = 0; t < trials; t++) {
    const f = Array.isArray(flux) ? Math.exp(Math.log(flux[0]) + rng() * (Math.log(flux[1]) - Math.log(flux[0]))) : flux;
    const x0 = 12 + rng() * 25, y0 = 12 + rng() * 25;
    const dots = detectSources(renderStar(n, x0, y0, f, sigma, rng), n, { sigmaFloor: 1e-9 });
    let best = null, bd = 2;
    for (const d of dots) { const r = Math.hypot(d.x - x0, d.y - y0); if (r < bd) { bd = r; best = d; } }
    if (!best) { missed++; continue; }
    rows.push({ ex: best.x - x0, ey: best.y - y0, snr: best.snr, x0, y0, flux: f });
  }
  return { rows, missed };
}

// ---------------------------------------------------------------- A. accuracy of the position, against the best possible (Cramer-Rao, averaged over the pixel phases)
console.log("## A. The position of an injected star (detectSources), 1500 trials per row\n");
console.log("| PSF sigma (FWHM) | flux / pixel noise | found | bias x | bias y | rms per axis | best possible (CR) | rms / CR |\n|---|---|---|---|---|---|---|---|");
for (const sigma of [0.356, 0.457]) for (const flux of [12, 20, 40, 80, 200, 600]) {
  const { rows, missed } = inject(1500, flux, sigma, 1000 + Math.round(flux * 10));
  const cr = Math.sqrt(mean(rows.slice(0, 150).map((r) => crlbX(n, r.x0, r.y0, flux, sigma) ** 2)));
  const r = rms([...rows.map((q) => q.ex), ...rows.map((q) => q.ey)]);
  console.log(`| ${sigma} (${(sigma * 2.3548 * 6.14).toFixed(2)}″) | ${pad(flux, 4)} | ${(100 - missed / 15).toFixed(0)} % | ${mean(rows.map((q) => q.ex)).toFixed(3)} | ${mean(rows.map((q) => q.ey)).toFixed(3)} | ${r.toFixed(3)} | ${cr.toFixed(3)} | ${(r / cr).toFixed(2)} |`);
}
{
  const { rows } = inject(5000, 200, 0.356, 7);
  const bins = Array.from({ length: 10 }, () => []);
  for (const r of rows) bins[Math.min(9, Math.floor((r.x0 - Math.floor(r.x0)) * 10))].push(r.ex);
  console.log("\nBias in x against the position inside the pixel (flux 200, sigma 0.356; 0.5 = the pixel centre): " + bins.map((b, i) => `${(i / 10).toFixed(1)}: ${mean(b).toFixed(3)}`).join("  "));
}

// ---------------------------------------------------------------- B. the error model: sigma^2 = (A / dot S/N)^2 + B^2, and whether it is right
console.log("\n## B. The error of a position as a function of the dot's S/N: fit and check\n");
const edges = [4, 6, 8, 12, 20, 35, 60, 120, 400];
console.log("| PSF sigma | fitted A (px) | fitted B (px) | model in the code: A, B | spread of z (independent trials) | inside 1 / 2 sigma |\n|---|---|---|---|---|---|");
for (const sigma of [0.356, 0.4, 0.457]) {
  const { rows } = inject(14000, [8, 900], sigma, 31 + Math.round(sigma * 1000));
  const bins = edges.slice(1).map(() => ({ sq: 0, n: 0, snr: 0 }));
  for (const r of rows) { const k = edges.findIndex((e, i) => i > 0 && r.snr < e) - 1; if (k < 0 || k >= bins.length) continue; bins[k].sq += r.ex ** 2 + r.ey ** 2; bins[k].n += 2; bins[k].snr += 2 * r.snr; }
  const pts = bins.filter((b) => b.n > 40).map((b) => ({ snr: b.snr / b.n, v: b.sq / b.n, n: b.n }));
  let s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0;
  for (const p of pts) { const u = 1 / p.snr ** 2, w = p.n / p.v ** 2; s11 += w * u * u; s12 += w * u; s22 += w; t1 += w * u * p.v; t2 += w * p.v; }
  const det = s11 * s22 - s12 * s12, A = Math.sqrt(Math.max(0, (t1 * s22 - t2 * s12) / det)), B = Math.sqrt(Math.max(0, (s11 * t2 - s12 * t1) / det));
  // independent trials (another seed), z = error / the error the code attaches to the dot
  const z = (() => { const rng = mulberry32(9000 + Math.round(sigma * 1000)), out = []; for (let t = 0; t < 4000; t++) { const f = Math.exp(Math.log(8) + rng() * Math.log(900 / 8)), x0 = 12 + rng() * 25, y0 = 12 + rng() * 25;
    const dots = detectSources(renderStar(n, x0, y0, f, sigma, rng), n, { sigmaFloor: 1e-9, psfSigmaPx: sigma }); const b = dots.filter((d) => Math.hypot(d.x - x0, d.y - y0) < 2)[0]; if (b) out.push((b.x - x0) / b.sigmaPx, (b.y - y0) / b.sigmaPx); } return out; })();
  console.log(`| ${sigma} | ${A.toFixed(3)} | ${B.toFixed(3)} | ${POSITION_NOISE_COEFF}, ${centroidSigmaPx(1e9, sigma).toFixed(3)} | ${sd(z).toFixed(3)} | ${within(z, 1).toFixed(0)} % / ${within(z, 2).toFixed(0)} % |`);
}

// ---------------------------------------------------------------- C. the velocity of a mover and its reported error
console.log("\n## C. The velocity of an injected mover (18 images, 4 survey passes like Barnard's Star in D2), 150 trials per row\n");
console.log("The error the code reported BEFORE Phase 4 was a floor: 0.15 px / sqrt(sum dt^2) = 0.101 px/yr for every star.\n");
console.log("| speed px/yr | flux / noise | found | spread of the fitted velocity (px/yr) | error reported now (mean) | spread of z | inside 1 / 2 sigma |\n|---|---|---|---|---|---|---|");
const days = [0, 0.1, 0.2, 0.3, 0.4, 120, 120.1, 120.2, 120.3, 120.4, 250, 250.1, 250.2, 250.3, 250.4, 250.5, 397, 397.1];
const mjds = days.map((d) => 60908 + d), tRef = (mjds[0] + mjds.at(-1)) / 2;
for (const speed of [1.7, 5]) for (const flux of [40, 80, 200]) {
  const rng = mulberry32(5000 + speed * 100 + flux), zs = [], reps = [], errs = []; let found = 0;
  for (let k = 0; k < 150; k++) {
    const x0 = 19 + rng() * 10, y0 = 14 + rng() * 20, ang = rng() * 2 * Math.PI, vx = speed * Math.cos(ang), vy = speed * Math.sin(ang);
    const frames = mjds.map((m) => { const y = (m - tRef) / 365.25; return { mjd: m, grey: renderStar(n, x0 + vx * y, y0 + vy * y, flux, 0.4, rng) }; });
    const c = findMoversInImages(frames, n, { sigmaFloor: 1e-9, register: false }).candidates.find((q) => Math.hypot(q.x - x0, q.y - y0) < 1.5);
    if (!c) continue;
    found++; zs.push((c.vx - vx) / c.vErrPx, (c.vy - vy) / c.vErrPx); reps.push(c.vErrPx); errs.push(c.vx - vx, c.vy - vy);
  }
  console.log(`| ${speed} | ${flux} | ${found}/150 | ${sd(errs).toFixed(3)} | ${mean(reps).toFixed(3)} | ${sd(zs).toFixed(2)} | ${within(zs, 1).toFixed(0)} % / ${within(zs, 2).toFixed(0)} % |`);
}

// ---------------------------------------------------------------- D. the flux in the aperture
console.log("\n## D. The flux in an aperture of radius 2 px (white noise), 3000 trials per row\n");
console.log("| flux / pixel noise | measured / injected | spread of the flux | err (S/N for the thresholds) | errTotal | spread of (flux - injected) / err | ... / errTotal |\n|---|---|---|---|---|---|---|");
for (const flux of [20, 60, 200]) {
  const rng = mulberry32(900 + flux), ms = [], e1 = [], e2 = [], z1 = [], z2 = [];
  for (let k = 0; k < 3000; k++) { const x0 = 14 + rng() * 20, y0 = 14 + rng() * 20; const a = apertureSnr(renderStar(n, x0, y0, flux, 0.4, rng), n, x0, y0, 2); if (!a) continue; ms.push(a.flux); e1.push(a.err); e2.push(a.errTotal); z1.push((a.flux - flux) / a.err); z2.push((a.flux - flux) / a.errTotal); }
  console.log(`| ${flux} | ${(mean(ms) / flux).toFixed(3)} | ${sd(ms).toFixed(2)} | ${mean(e1).toFixed(2)} | ${mean(e2).toFixed(2)} | ${sd(z1).toFixed(2)} | ${sd(z2).toFixed(2)} |`);
}
