// Phase 4: are the positions, the velocities and the fluxes right, and are the ERRORS reported with them right?  Repeated injections of point sources with a
// pixel-integrated Gaussian PSF on white noise (the real PSF is not Gaussian and the real noise is not white: scratch/check_astrometry_real.mjs, VALIDATION §15,
// checks the same errors on the real images). Run: node scratch/test_astrometry.mjs
import { detectSources, findMoversInImages, apertureSnr, centroidSigmaPx, lineUncertainty, calibratedFluxErr, POSITION_NOISE_COEFF, SYSTEMATIC_SIGMA_PX, REAL_APERTURE_NOISE_FACTOR, MASKED_FIT_SIGMA_PX, DEFAULT_PSF_SIGMA_PX } from "../frontend/js/features/movers.js";
import { mulberry32, renderStar, crlbX, gaussianNoise, mean, sd, rms, within } from "./lib_inject.mjs";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const n = 49;
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/** Inject `trials` stars of the given flux (or a log-uniform flux range) and measure them with detectSources. -> [{ ex, ey, snr, sigmaPx, x0, y0, flux }] (the dots found within 2 px) and how many were missed */
function measure({ trials, flux, sigma, seed, psfSigmaPx }) {
  const rng = mulberry32(seed), out = []; let missed = 0;
  for (let t = 0; t < trials; t++) {
    const f = Array.isArray(flux) ? Math.exp(Math.log(flux[0]) + rng() * (Math.log(flux[1]) - Math.log(flux[0]))) : flux;
    const x0 = 12 + rng() * 25, y0 = 12 + rng() * 25;
    const dots = detectSources(renderStar(n, x0, y0, f, sigma, rng), n, { sigmaFloor: 1e-9, ...(psfSigmaPx ? { psfSigmaPx } : {}) });
    let best = null, bd = 2;
    for (const d of dots) { const r = Math.hypot(d.x - x0, d.y - y0); if (r < bd) { bd = r; best = d; } }
    if (!best) { missed++; continue; }
    out.push({ ex: best.x - x0, ey: best.y - y0, snr: best.snr, sigmaPx: best.sigmaPx, x0, y0, flux: f });
  }
  return { rows: out, missed };
}

// ================================================================= 1. the centroid: bias, phase bias, distance from the best possible
{
  const bright = measure({ trials: 1200, flux: 200, sigma: 0.356, seed: 11 });
  const meanBias = Math.max(Math.abs(mean(bright.rows.map((r) => r.ex))), Math.abs(mean(bright.rows.map((r) => r.ey))));
  check("centroid: no bias on average over all pixel phases (bright star, PSF 5.15 arcsec)", meanBias < 0.01, `mean error ${meanBias.toFixed(4)} px`);
  // the bias against the fractional position: an undersampled PSF pulls the centre of the star towards the centre of its pixel
  const bins = Array.from({ length: 10 }, () => []);
  for (const r of bright.rows) bins[Math.min(9, Math.floor((r.x0 - Math.floor(r.x0)) * 10))].push(r.ex);
  const sCurve = bins.map((b) => mean(b));
  check("centroid: THE PIXEL-PHASE BIAS exists and is small: up to 0.05 px towards the pixel centre, never more than 0.07 px (the reason for the floor B of centroidSigmaPx)",
    Math.max(...sCurve.map(Math.abs)) > 0.02 && Math.max(...sCurve.map(Math.abs)) < 0.07 && sCurve[2] > 0 && sCurve[7] < 0, sCurve.map((v) => v.toFixed(3)).join(" "));
  check("centroid: its rms error at high S/N is the phase bias, about 0.04 px (0.23 arcsec), not smaller", near(rms([...bright.rows.map((r) => r.ex), ...bright.rows.map((r) => r.ey)]), 0.037, 0.008));
  // The best possible error of an undersampled star depends strongly on where it sits in its pixel (a star in the middle of a pixel puts its light in one pixel and
  // says little about its position), so it is computed for each injected star and averaged in quadrature.
  const faint = measure({ trials: 800, flux: 40, sigma: 0.356, seed: 12 });
  const lim = Math.sqrt(mean(faint.rows.slice(0, 200).map((r) => crlbX(n, r.x0, r.y0, 40, 0.356) ** 2)));
  const ratio = rms(faint.rows.map((r) => r.ex)) / lim;
  check("centroid: at a flux of 40 times the pixel noise it is within 2 times the best possible (Cramer-Rao) error, averaged over the pixel phases (a fit of the PSF could do better)", ratio < 2 && ratio > 1, `${rms(faint.rows.map((r) => r.ex)).toFixed(3)} px against ${lim.toFixed(3)} px = ${ratio.toFixed(2)}`);
  const weak = measure({ trials: 800, flux: 20, sigma: 0.356, seed: 13 });
  const off = weak.rows.map((r) => Math.hypot(r.ex, r.ey));
  check("detection: a star of 20 times the pixel noise is found in at least 98 % of the trials; half of the positions are within 0.16 px (1 arcsec), none off by more than 0.7 px", weak.missed / 800 <= 0.02 && [...off].sort((a, b) => a - b)[Math.floor(off.length / 2)] < 0.16 && Math.max(...off) < 0.7, `${(100 - weak.missed / 8).toFixed(1)} % found; median ${[...off].sort((a, b) => a - b)[Math.floor(off.length / 2)].toFixed(3)} px, worst ${Math.max(...off).toFixed(2)} px`);
}

// ================================================================= 2. the error of a position: z = (measured - true) / sigmaPx should have a spread of 1
{
  const all = [];
  for (const [sigma, seed] of [[0.356, 101], [0.4, 102], [0.457, 103]]) {
    const { rows } = measure({ trials: 3000, flux: [10, 600], sigma, seed, psfSigmaPx: sigma });         // the PSF width is known: its floor B is used
    const z = rows.flatMap((r) => [r.ex / r.sigmaPx, r.ey / r.sigmaPx]);
    all.push(...z);
    const tertiles = [0, 1, 2].map((q) => { const s = [...rows].sort((a, b) => a.snr - b.snr); const part = s.slice(Math.floor((q * s.length) / 3), Math.floor(((q + 1) * s.length) / 3)); return sd(part.flatMap((r) => [r.ex / r.sigmaPx, r.ey / r.sigmaPx])); });
    check(`position error, PSF sigma ${sigma} px: the spread of z is 1 (0.9-1.1) overall and in each third of the S/N range (0.8-1.2)`, sd(z) > 0.9 && sd(z) < 1.1 && tertiles.every((t) => t > 0.8 && t < 1.2), `sd ${sd(z).toFixed(3)}; thirds ${tertiles.map((t) => t.toFixed(2)).join(" ")}`);
    // (not exactly 68 and 95: at high S/N the error is the pixel-phase bias, which is bounded, so the distribution is flatter than a Gaussian: fewer inside 1 sigma, more inside 2)
    check(`position error, PSF sigma ${sigma} px: 60-74 % of the errors are inside 1 sigma and 92-99.5 % inside 2 sigma`, within(z, 1) > 60 && within(z, 1) < 74 && within(z, 2) > 92 && within(z, 2) < 99.5, `${within(z, 1).toFixed(1)} % and ${within(z, 2).toFixed(1)} %`);
  }
  const blind = measure({ trials: 3000, flux: [10, 600], sigma: 0.457, seed: 104 });                      // the width is NOT told: the default is the cautious (narrowest) one
  const zb = blind.rows.flatMap((r) => [r.ex / r.sigmaPx, r.ey / r.sigmaPx]);
  check("position error with the default PSF width on a wider PSF: cautious, never optimistic (spread of z below 1)", sd(zb) < 1.0 && sd(zb) > 0.7, `sd ${sd(zb).toFixed(3)}`);
}

// ================================================================= 3. the model itself
{
  check("centroidSigmaPx: falls with S/N and ends at the phase floor", centroidSigmaPx(5) > centroidSigmaPx(10) && centroidSigmaPx(10) > centroidSigmaPx(100) && near(centroidSigmaPx(1e6), 0.036, 1e-3) && near(centroidSigmaPx(1e6, 0.457), 0.014, 1e-3));
  check("centroidSigmaPx: the statistical term is 1.05 px over the S/N (S/N 10: sqrt(0.105^2 + 0.036^2))", POSITION_NOISE_COEFF === 1.05 && near(centroidSigmaPx(10), Math.hypot(0.105, 0.036), 1e-9));
  check("centroidSigmaPx: the floor B is interpolated between the three measured widths and clamped outside them", near(centroidSigmaPx(1e6, 0.378), 0.030, 1e-3) && centroidSigmaPx(1e6, 0.2) === centroidSigmaPx(1e6, 0.356) && centroidSigmaPx(1e6, 0.9) === centroidSigmaPx(1e6, 0.457));
  check("centroidSigmaPx: no usable S/N gives a large error (0.3 px), never zero or NaN", centroidSigmaPx(0) === 0.3 && centroidSigmaPx(NaN) === 0.3 && centroidSigmaPx(-4) === 0.3 && centroidSigmaPx(Infinity) === 0.3);
  check("every dot carries its error; the star of a masked fit is not given a smaller one than the cautious 0.15 px", detectSources(renderStar(n, 24.3, 24.6, 100, 0.4, mulberry32(1)), n, { sigmaFloor: 1e-9 }).every((d) => d.sigmaPx > 0 && Number.isFinite(d.sigmaPx)) && MASKED_FIT_SIGMA_PX === 0.15 && DEFAULT_PSF_SIGMA_PX === 0.356);
}

// ================================================================= 4. lineUncertainty: the velocity error of a straight line through dots
{
  const t = [0, 0.01, 0.02, 0.33, 0.34, 0.35, 0.69, 0.7, 0.71, 1.09, 1.1];             // years: four survey passes
  const tm = mean(t), sxx = t.reduce((s, v) => s + (v - tm) ** 2, 0);
  const equal = lineUncertainty(t.map((x) => ({ t: x, sigma: 0.1 })), 0, { systematicPx: 0 });
  check("equal errors: the velocity error is sigma / sqrt(sum dt^2), and the mean position error sigma / sqrt(m)", near(equal.vErr, 0.1 / Math.sqrt(sxx), 1e-12) && near(equal.posErr, 0.1 / Math.sqrt(t.length), 1e-12) && equal.inflation === 1);
  const mixed = lineUncertainty(t.map((x, i) => ({ t: x, sigma: i < 3 ? 0.3 : 0.05 })), 0, { systematicPx: 0 });
  const wdt = t.reduce((s, x, i) => s + (x - tm) ** 2 * (i < 3 ? 0.3 : 0.05) ** 2, 0);
  check("different errors: the exact error of the least-squares line, sqrt(sum dt^2 sigma^2) / sum dt^2", near(mixed.vErr, Math.sqrt(wdt) / sxx, 1e-12));
  const scattered = lineUncertainty(t.map((x) => ({ t: x, sigma: 0.05 })), 0.15, { systematicPx: 0 });
  check("dots that scatter more than their errors say (rms 0.15 against 0.05): the error is scaled up by the ratio", near(scattered.inflation, 3, 1e-12) && near(scattered.vErr, 3 * 0.05 / Math.sqrt(sxx), 1e-12));
  check("a lucky small scatter never makes the error smaller than the model's", lineUncertainty(t.map((x) => ({ t: x, sigma: 0.1 })), 0.001, { systematicPx: 0 }).vErr === equal.vErr);
  const withSys = lineUncertainty(t.map((x) => ({ t: x, sigma: 0.1 })), 0);
  check("the systematic floor is added in quadrature (0.04 px per dot: velocity error sqrt(model^2 + floor^2 / sum dt^2))", SYSTEMATIC_SIGMA_PX === 0.04 && near(withSys.vErr, Math.hypot(0.1 / Math.sqrt(sxx), 0.04 / Math.sqrt(sxx)), 1e-12));
  check("one epoch only (no baseline): the velocity is not constrained (infinite error)", lineUncertainty([{ t: 1, sigma: 0.1 }, { t: 1, sigma: 0.1 }], 0).vErr === Infinity);

  // Is that error the SPREAD of the fitted velocity? Dots with known errors around a true line, ordinary least squares, 6000 trials.
  const rng = mulberry32(77), zs = [], zsRms = [];
  for (let k = 0; k < 6000; k++) {
    const sig = t.map(() => 0.04 + 0.2 * rng()), v = 1.7, x0 = 20;
    const xs = t.map((x, i) => x0 + v * (x - tm) + sig[i] * gaussianNoise(rng));
    const xm = mean(xs); const vFit = t.reduce((s, x, i) => s + (x - tm) * (xs[i] - xm), 0) / sxx;
    const resid = t.map((x, i) => xs[i] - xm - vFit * (x - tm)), rmsFit = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / (t.length - 2));
    const members = t.map((x, i) => ({ t: x, sigma: sig[i] }));
    zs.push((vFit - v) / lineUncertainty(members, 0, { systematicPx: 0 }).vErr);
    zsRms.push((vFit - v) / lineUncertainty(members, rmsFit, { systematicPx: 0 }).vErr);
  }
  check("the model error IS the spread of the fitted velocity: 6000 lines, spread of z = 1.00 (0.97-1.03), 68 % inside 1 sigma", sd(zs) > 0.97 && sd(zs) < 1.03 && within(zs, 1) > 66 && within(zs, 1) < 70, `sd ${sd(zs).toFixed(3)}, ${within(zs, 1).toFixed(1)} %`);
  check("with the observed scatter taken into account (it can only enlarge the error) the error is slightly cautious, never optimistic: spread of z 0.85-1.0", sd(zsRms) > 0.85 && sd(zsRms) <= 1.0, `sd ${sd(zsRms).toFixed(3)}`);
}

// ================================================================= 5. the velocity error of a MOVER found in injected images (the whole chain: dots -> link -> fit -> error)
{
  // four survey passes like real Barnard's Star D2 (18 images over 397 days), a star moving in a random direction
  const days = [0, 0.1, 0.2, 0.3, 0.4, 120, 120.1, 120.2, 120.3, 120.4, 250, 250.1, 250.2, 250.3, 250.4, 250.5, 397, 397.1];
  const mjds = days.map((d) => 60908 + d), tRef = (mjds[0] + mjds.at(-1)) / 2;
  for (const [speed, flux] of [[1.7, 40], [1.7, 200], [5, 40]]) {
    const rng = mulberry32(5000 + speed * 100 + flux), zs = [], reps = [], errs = [];
    let found = 0;
    const trials = 90;
    for (let k = 0; k < trials; k++) {
      const x0 = 19 + rng() * 10, y0 = 14 + rng() * 20, ang = rng() * 2 * Math.PI, vx = speed * Math.cos(ang), vy = speed * Math.sin(ang);
      const frames = mjds.map((m) => { const yrs = (m - tRef) / 365.25; return { mjd: m, grey: renderStar(n, x0 + vx * yrs, y0 + vy * yrs, flux, 0.4, rng) }; });
      const res = findMoversInImages(frames, n, { sigmaFloor: 1e-9, register: false });
      const c = res.candidates.find((q) => Math.hypot(q.x - x0, q.y - y0) < 1.5);
      if (!c) continue;
      found++;
      zs.push((c.vx - vx) / c.vErrPx, (c.vy - vy) / c.vErrPx); reps.push(c.vErrPx); errs.push(c.vx - vx, c.vy - vy);
      if (Math.abs(c.speedPx / c.significance - c.vErrPx) > 1e-9) { check("significance is speed / the reported velocity error", false); }
    }
    // the statistical error of the faint star is the whole error; for the bright one the systematic floor of 0.04 px (found on REAL stars) dominates, so the error is cautious
    const lo = flux === 40 ? 0.75 : 0.45;
    check(`mover ${speed} px/yr, flux ${flux} x noise: found ${found}/${trials}; the reported error is not optimistic (spread of z at most 1.15) and not wasteful (at least ${lo})`, found >= trials * 0.95 && sd(zs) <= 1.15 && sd(zs) >= lo,
      `spread of the fitted velocity ${sd(errs).toFixed(3)} px/yr, reported ${mean(reps).toFixed(3)}, sd(z) ${sd(zs).toFixed(2)}, ${within(zs, 1).toFixed(0)} % inside 1 sigma`);
  }
}

// ================================================================= 6. aperture flux
{
  for (const flux of [20, 200]) {
    const rng = mulberry32(900 + flux), ms = [], zs = [], zsOld = [];
    for (let k = 0; k < 2000; k++) {
      const x0 = 14 + rng() * 20, y0 = 14 + rng() * 20;
      const ap = apertureSnr(renderStar(n, x0, y0, flux, 0.4, rng), n, x0, y0, 2);
      if (!ap) continue;
      ms.push(ap.flux); zs.push((ap.flux - flux) / ap.errTotal); zsOld.push((ap.flux - flux) / ap.err);
    }
    check(`aperture flux ${flux}: unbiased to 1 % (white noise), and its error with the background term is the spread: sd(z) 0.96-1.04 (without the term: about 1.10)`, near(mean(ms) / flux, 1, 0.01) && sd(zs) > 0.96 && sd(zs) < 1.04 && sd(zsOld) > 1.05, `flux ${(mean(ms) / flux).toFixed(3)} x, sd(z) ${sd(zs).toFixed(3)}, without the term ${sd(zsOld).toFixed(3)}`);
  }
  const ap = apertureSnr(renderStar(n, 24, 24, 100, 0.4, mulberry32(3)), n, 24, 24, 2);
  check("the S/N the searches use is still flux / err (their thresholds were tuned with it); the error to REPORT is errTotal for synthetic data and 1.7 x err for real cutouts",
    ap.snr === ap.flux / ap.err && ap.errTotal > ap.err && ap.errTotal < 1.2 * ap.err && calibratedFluxErr(ap, false) === ap.errTotal && calibratedFluxErr(ap, true) === ap.err * REAL_APERTURE_NOISE_FACTOR && REAL_APERTURE_NOISE_FACTOR === 1.7 && ap.nInside >= 9 && ap.nRing >= 10);
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
