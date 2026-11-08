// planetLab.js – the Planet X Lab: which motion fits a set of positions, and how likely the search is to find a distant body (pure; no DOM, no network).
//
// 1. modelComparison()  Three explanations of the positions of one object are compared, each fitted by least squares:
//        stationary      it does not move at all                              (2 parameters: a position)
//        linear          it moves along a straight line                      (4: position and velocity)
//        parallax        a straight drift AND the swing of the Earth's orbit  (5: the same and the distance)
//    They are compared with the Bayesian information criterion, BIC = chi2 + k ln N (N = 2 numbers per position): the smaller the better; a model with more parameters has
//    to earn them. The distance is only quoted when it is CONSTRAINED: the parallax model must beat the straight line by DeltaBIC >= 10 and the 95 % range of the
//    distance (chi2 within 4 of the best, one parameter) must have both ends inside the distances that were tried and be no wider than a factor of 3; otherwise the answer is
//    a lower limit, an upper limit, or "not constrained", and a straight line is "no distance claimed".
// 2. injection and recovery   A synthetic body (a Gaussian PSF integrated over the pixels, at the distance and the brightness asked for, with a drift a body bound to the Sun
//    could have) is added to the REAL images on screen, where a real body would be (the swing of the Earth and the pointing shifts of each exposure included), and the app's
//    own search is run on them. The share of tries in which the body is found, at each distance and brightness, is a completeness map: a measurement of THIS search on THESE
//    images with an INJECTED (synthetic) body, not a statement about any real object.
//
// Approximations (also said in the interface): the Earth's position is the low-precision formula of parallax.js; the body's own motion is a straight line; the PSF is
// Gaussian (the real one is not, VALIDATION 15.7); the brightness is the total flux in the image's own unit converted with the pixel's solid angle (real, float pixels only).

import { fitParallax, parallaxOffsetArcsec, findDistantMovers, logGrid, ARCSEC_PER_RAD } from "./parallax.js";
import { detectSources, registerShifts, moverPositionAtMjd, normalCdf } from "./movers.js";

/** Name of this version of the lab (written into every result of it). First written 9 Nov 2026. */
export const VERSION = "planetlab-1";

const KMS_PER_AU_YR = 4.74047;
export const K_PARAMS = { stationary: 2, linear: 4, parallax: 5 };
export const MODEL_LABELS = { stationary: "Stationary", linear: "Straight line", parallax: "Straight drift + Earth parallax" };

/** Kass & Raftery (1995) as usually quoted, written from memory: DeltaBIC 0-2 not worth a mention, 2-6 positive, 6-10 strong, above 10 very strong. */
export function bicStrength(delta) {
  if (!(delta >= 2)) return "no real preference";
  if (delta < 6) return "positive evidence";
  if (delta < 10) return "strong evidence";
  return "very strong evidence";
}

/** The own drift of a body on a circular orbit around the Sun at `distanceAU` (29.78 / sqrt(r) km/s), times `fraction`, in arcsec per year as seen from the Earth. */
export function ownDriftArcsecPerYear(distanceAU, fraction = 0.8) {
  const kms = (29.78 / Math.sqrt(distanceAU)) * fraction;
  return (kms / KMS_PER_AU_YR / distanceAU) * ARCSEC_PER_RAD;
}

/** The largest displacement (arcsec) the Earth's swing gives a body at `distanceAU` on the dates `mjds`, relative to the middle date: how big the field must be. */
export function swingArcsec(ra, dec, mjds, distanceAU) {
  const mid = (Math.min(...mjds) + Math.max(...mjds)) / 2;
  return Math.max(...mjds.map((m) => { const p = parallaxOffsetArcsec(ra, dec, m, mid, distanceAU); return Math.hypot(p.east, p.north); }));
}

// ------------------------------------------------------------------ 1. which motion fits

/** The distances (smallest and largest) whose chi-square is within `delta` of the best, and whether either end is the edge of what was tried. */
export function rangeAtDelta(scan, best, delta) {
  const within = scan.filter((s) => s.chi2 <= best.chi2 + delta);
  const lo = Math.min(...within.map((s) => s.distanceAU)), hi = Math.max(...within.map((s) => s.distanceAU));
  return { lo, hi, touchesLow: lo <= scan[0].distanceAU * (1 + 1e-9), touchesHigh: hi >= scan.at(-1).distanceAU * (1 - 1e-9) };
}

const fmtAU = (v) => (v >= 1000 ? `${Math.round(v / 10) * 10}` : `${Math.round(v)}`);

/**
 * Compare the three models on the positions of one object.
 * obs: [{ mjd, east, north, sigma }] in arcsec (tangent plane, any fixed origin; east is left on the picture), sigma per axis in arcsec.
 * { ra, dec }: the direction. Returns { usable, N, models: [{ id, label, params, chi2, dof, reducedChi2, bic, deltaBic, usable }], preferred, strength, distance, notes }.
 */
export function modelComparison(obs, { ra, dec, mjdRef = null, distancesAU = logGrid(20, 20000, 240) }) {
  const m = obs.length, N = 2 * m;
  if (m < 3) return { usable: false, N, reason: "at least 3 positions are needed", models: [] };
  const ref = mjdRef ?? obs.reduce((s, o) => s + o.mjd, 0) / m;
  const coarse = fitParallax(obs, { ra, dec, mjdRef: ref, distancesAU });
  // The coarse grid has steps of about 3 %: with good positions the 1 sigma range of the distance is narrower than a step. A second, fine scan around the minimum (from where chi2 is
  // within 9 of the best, one grid step wider each side) gives the best distance and its ranges; whether a range reaches the edge of what was tried is decided on the coarse grid.
  const step = distancesAU[1] / distancesAU[0], wide = rangeAtDelta(coarse.scan, coarse.best, 9);
  const fine = !wide.touchesLow && !wide.touchesHigh ? fitParallax(obs, { ra, dec, mjdRef: ref, distancesAU: logGrid(wide.lo / step, wide.hi * step, 800) }) : coarse;
  const fit = fine.best.chi2 <= coarse.best.chi2 ? { ...fine, linear: coarse.linear } : coarse;
  const w = obs.map((o) => 1 / (o.sigma * o.sigma)), sw = w.reduce((a, b) => a + b, 0);
  const meanE = obs.reduce((s, o, i) => s + w[i] * o.east, 0) / sw, meanN = obs.reduce((s, o, i) => s + w[i] * o.north, 0) / sw;
  const stationary = obs.reduce((s, o, i) => s + w[i] * ((o.east - meanE) ** 2 + (o.north - meanN) ** 2), 0);
  // A straight line is the parallax model at an infinite distance, so the parallax model can never fit worse than it: the scan only tries finite distances, and where none
  // of them beats the straight line the parallax model is the straight line (and the extra parameter is paid for in the BIC all the same).
  const raw = { stationary, linear: fit.linear.chi2, parallax: Math.min(fit.best.chi2, fit.linear.chi2) };
  const models = Object.keys(K_PARAMS).map((id) => {
    const params = K_PARAMS[id], chi2 = raw[id], dof = N - params;
    return { id, label: MODEL_LABELS[id], params, chi2, dof, reducedChi2: dof >= 1 ? chi2 / dof : null, bic: chi2 + params * Math.log(N), usable: dof >= 1 };
  });
  const usable = models.filter((x) => x.usable);
  const best = usable.reduce((b, x) => (x.bic < b.bic ? x : b), usable[0]);
  for (const x of models) x.deltaBic = x.bic - best.bic;
  const runnerUp = usable.filter((x) => x !== best).reduce((b, x) => (!b || x.bic < b.bic ? x : b), null);
  const strength = runnerUp ? bicStrength(runnerUp.bic - best.bic) : "no other model to compare with";

  // the distance, only when it is constrained
  const lin = models.find((x) => x.id === "linear"), par = models.find((x) => x.id === "parallax");
  const gain = lin.usable && par.usable ? lin.bic - par.bic : null;              // how much the parallax model beats the straight line
  const r68 = rangeAtDelta(fit.scan, fit.best, 1), r95 = rangeAtDelta(fit.scan, fit.best, 4);
  const edge95 = rangeAtDelta(coarse.scan, coarse.best, 4);                      // does the 95 % range reach the edge of the distances tried? (coarse grid: it covers them all)
  r95.touchesLow = edge95.touchesLow; r95.touchesHigh = edge95.touchesHigh;
  let distance;
  if (best.id !== "parallax" || gain === null || gain < 10) {
    distance = { status: "not-claimed", text: best.id === "parallax"
      ? "The parallax model is only slightly better than a straight line (ΔBIC below 10): no distance is claimed."
      : `${best.label === MODEL_LABELS.stationary ? "The object does not move" : "A straight line explains the positions"} at least as well as a swing with distance: no distance is claimed.` };
  } else if (!r95.touchesLow && !r95.touchesHigh && r95.hi / r95.lo <= 3) {
    distance = { status: "constrained", bestAU: fit.best.distanceAU, range68AU: [r68.lo, r68.hi], range95AU: [r95.lo, r95.hi],
      text: `Constrained: about ${fmtAU(fit.best.distanceAU)} AU (95 % range ${fmtAU(r95.lo)}–${fmtAU(r95.hi)} AU).` };
  } else if (r95.touchesHigh && !r95.touchesLow) {
    distance = { status: "lower-limit", lowerAU: r95.lo, text: `Only a lower limit: farther than about ${fmtAU(r95.lo)} AU (95 %); the swing is too small to say how much farther.` };
  } else if (r95.touchesLow && !r95.touchesHigh) {
    distance = { status: "upper-limit", upperAU: r95.hi, text: `Only an upper limit: nearer than about ${fmtAU(r95.hi)} AU (95 %).` };
  } else {
    distance = { status: "unconstrained", text: `Not constrained: the 95 % range ${fmtAU(r95.lo)}–${fmtAU(r95.hi)} AU is too wide (or reaches the edge of the distances tried, ${fmtAU(distancesAU[0])}–${fmtAU(distancesAU.at(-1))} AU).` };
  }
  const notes = [];
  if (best.reducedChi2 !== null && best.reducedChi2 > 3) notes.push(`Even the preferred model fits badly (χ²/dof = ${best.reducedChi2.toFixed(1)}): the positions are noisier than assumed, or none of these motions is the right one.`);
  if (m < 5) notes.push(`Only ${m} positions: the models have few degrees of freedom left, so the comparison is weak.`);
  return { usable: true, N, models, preferred: best.id, strength, distance, notes, mjdRef: ref };
}

/**
 * The observations of a candidate for modelComparison: its dots (points: [{ frame, x, y }], pixel coordinates registered to a common frame; east is LEFT, north UP)
 * on the dates of the images, with the error per axis the searches use for a dot (sigmaPx, default 0.15 px = the parallax search's floor, VALIDATION 15.6).
 */
export function observationsOf(points, mjds, scaleArcsec, { sigmaPx = 0.15 } = {}) {
  return points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(mjds[p.frame])).map((p) => ({
    mjd: mjds[p.frame], east: -p.x * scaleArcsec, north: -p.y * scaleArcsec, sigma: sigmaPx * scaleArcsec,
  }));
}

// ------------------------------------------------------------------ 2. injection and recovery

/** The same registration the search makes (pointing errors between the exposures, from the field stars), as pixel shifts per image. */
export function registrationOf(frames) {
  return registerShifts(frames.map((f) => ({ mjd: f.mjd, sources: f.sources }))).map((s) => (Math.abs(s.dx) > 0.05 || Math.abs(s.dy) > 0.05 ? s : { dx: 0, dy: 0 }));
}

/**
 * Where an injected body is on each image (pixels, "edge" coordinates), and the images with it added.
 * spec = { distanceAU, fluxMilliJy, fx, fy (where it is on the middle date, image fractions), driftEast, driftNorth (arcsec per year, east is LEFT on the picture),
 *          psfSigmaPx (default 0.4) }. geo = { ra, dec, n, scaleArcsec }. shifts[k] = { dx, dy }: the field's displacement on image k (the registration), so that the
 * body sits where a real one would. arrays[k] are the real pixels in MJy/sr (Float32Array n*n); they are copied, never changed.
 */
export function injectDistantMover({ arrays, mjds, geo, spec, shifts }) {
  const n = geo.n, scale = geo.scaleArcsec;
  const mid = (Math.min(...mjds) + Math.max(...mjds)) / 2;
  const sigma = spec.psfSigmaPx ?? 0.4;
  const omega = (scale / ARCSEC_PER_RAD) ** 2;                                   // sr per pixel
  const total = spec.fluxMilliJy / (omega * 1e9);                                // image units x pixels (MJy/sr x pixels), the sum over the star
  const truth = [], out = [];
  mjds.forEach((mjd, k) => {
    const dt = (mjd - mid) / 365.25, par = parallaxOffsetArcsec(geo.ra, geo.dec, mjd, mid, spec.distanceAU);
    const x = spec.fx * n - (par.east + spec.driftEast * dt) / scale + (shifts[k]?.dx ?? 0);
    const y = spec.fy * n - (par.north + spec.driftNorth * dt) / scale + (shifts[k]?.dy ?? 0);
    truth.push({ x, y });
    const img = Float32Array.from(arrays[k]);
    const x0 = Math.max(0, Math.floor(x - 5 * sigma - 1)), x1 = Math.min(n - 1, Math.ceil(x + 5 * sigma + 1));
    const y0 = Math.max(0, Math.floor(y - 5 * sigma - 1)), y1 = Math.min(n - 1, Math.ceil(y + 5 * sigma + 1));
    for (let j = y0; j <= y1; j++) {
      const cy = normalCdf((j + 1 - y) / sigma) - normalCdf((j - y) / sigma);
      for (let i = x0; i <= x1; i++) {
        const cx = normalCdf((i + 1 - x) / sigma) - normalCdf((i - x) / sigma);
        if (Number.isFinite(img[j * n + i])) img[j * n + i] += total * cx * cy;
      }
    }
    out.push(img);
  });
  return { arrays: out, truth };
}

/**
 * Is a candidate of findDistantMovers the injected body? Its place on every image (the straight-drift part plus the displacement of that image, as the app draws it) must be
 * within `radiusPx` of the truth on at least half of the images; and its distance within a factor `distanceFactor` of the true one counts as "distance right".
 */
export function matchesInjection(candidate, truth, mjds, distanceAU, { radiusPx = 3, distanceFactor = 1.5 } = {}) {
  let near = 0;
  mjds.forEach((mjd, k) => {
    const p = moverPositionAtMjd(candidate, mjd), s = candidate.shifts?.[k] ?? { dx: 0, dy: 0 };
    if (Math.hypot(p.x + s.dx - truth[k].x, p.y + s.dy - truth[k].y) <= radiusPx) near++;
  });
  const found = near >= Math.ceil(mjds.length / 2);
  const ratio = candidate.distanceAU / distanceAU;
  return { found, distanceRight: found && ratio >= 1 / distanceFactor && ratio <= distanceFactor };
}

/**
 * One try: inject, detect the dots, run the app's search, and say whether the body was found.
 * context = { arrays, masks (or null), mjds, geo, shifts, detectOptions, searchOptions }.
 */
export function recoveryTrial(context, spec) {
  const { arrays, masks, mjds, geo, shifts, detectOptions = { sigmaFloor: 1e-9 }, searchOptions = {} } = context;
  const injected = injectDistantMover({ arrays, mjds, geo, spec, shifts });
  const frames = injected.arrays.map((a, k) => ({ mjd: mjds[k], sources: detectSources(a, geo.n, { ...detectOptions, mask: masks?.[k] ?? null }) }));
  const { candidates, reason } = findDistantMovers(frames, geo, searchOptions);
  if (reason) return { found: false, distanceRight: false, candidates: 0, reason };
  let found = false, distanceRight = false, rms = null;
  for (const c of candidates) {
    const r = matchesInjection(c, injected.truth, mjds, spec.distanceAU);
    found ||= r.found; distanceRight ||= r.distanceRight;
    if (r.found && Number.isFinite(c.rms) && (rms === null || c.rms < rms)) rms = c.rms;       // how well the dots of the body agree with its model, px (the best matching candidate)
  }
  return { found, distanceRight, candidates: candidates.length, rms };
}

/** The 95 % Wilson score interval of k successes in n tries: [low, high] as fractions (honest at 0 and n, unlike k/n +- sqrt). */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** The cells of a completeness map, row by row (brightest first), each with an index. */
export function gridCells(distancesAU, fluxesMilliJy) {
  const cells = [];
  [...fluxesMilliJy].sort((a, b) => b - a).forEach((flux, row) => distancesAU.forEach((d, col) => cells.push({ row, col, distanceAU: d, fluxMilliJy: flux, tries: 0, found: 0, distanceRight: 0, rms: [] })));
  return cells;
}

/**
 * Run the grid: for each cell, `trials` tries with a fresh random place and direction of drift. `run(spec)` does one try (recoveryTrial in the app, a stand-in in tests);
 * onProgress(done, total, cell) after each; stop() true ends it early. Returns the cells (tries / found / distanceRight counted, interval added) and whether it finished.
 */
export async function runCompleteness({ distancesAU, fluxesMilliJy, trials, rng, run, onProgress = () => {}, stop = () => false, margin = 0.25 }) {
  const cells = gridCells(distancesAU, fluxesMilliJy);
  const total = cells.length * trials;
  let done = 0, finished = true;
  outer: for (const cell of cells) {
    for (let t = 0; t < trials; t++) {
      if (stop()) { finished = false; break outer; }
      const angle = rng() * 2 * Math.PI, drift = ownDriftArcsecPerYear(cell.distanceAU, 0.5 + 0.5 * rng());
      const spec = { distanceAU: cell.distanceAU, fluxMilliJy: cell.fluxMilliJy, fx: margin + (1 - 2 * margin) * rng(), fy: margin + (1 - 2 * margin) * rng(),
        driftEast: drift * Math.cos(angle), driftNorth: drift * Math.sin(angle) };
      const r = await run(spec);
      cell.tries++; if (r.found) cell.found++; if (r.distanceRight) cell.distanceRight++;
      if (r.found && Number.isFinite(r.rms)) cell.rms.push(r.rms);
      done++;
      onProgress(done, total, cell);
    }
  }
  for (const c of cells) {
    c.fraction = c.tries ? c.found / c.tries : null; c.interval = c.tries ? wilson(c.found, c.tries) : null;
    const sorted = [...c.rms].sort((a, b) => a - b);
    c.rmsMedian = sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : null;
  }
  return { cells, finished, done, total };
}

/** A small seeded generator (mulberry32), so that a map can be repeated: the same seed gives the same places and drifts. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * A list of numbers typed by a person: "300, 600 1200" -> [300, 600, 1200] (commas, spaces or semicolons), sorted, without repeats.
 * -> { values, error }: error is a sentence when the text is unusable (not a number, outside [min, max], fewer than 1 or more than maxCount).
 */
export function parseNumberList(text, { min = -Infinity, max = Infinity, maxCount = 8, what = "value" } = {}) {
  const parts = String(text ?? "").split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return { values: [], error: `Give at least one ${what}.` };
  const values = [];
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isFinite(v)) return { values: [], error: `“${p}” is not a number.` };
    if (v < min || v > max) return { values: [], error: `${p} is outside ${min}–${max} (${what}).` };
    values.push(v);
  }
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length > maxCount) return { values: [], error: `At most ${maxCount} ${what}s (every one is a row or a column of tries).` };
  return { values: unique, error: "" };
}

/** The text of a cell of the map: "7 / 10" and the share as a percent. */
export const cellText = (c) => (c.tries ? `${c.found} / ${c.tries}` : "–");

/** The map as CSV: a header of what it is and how it was made (the provenance), then one row per cell. */
export function completenessCsv(cells, provenance) {
  const head = Object.entries(provenance).map(([k, v]) => `# ${k}: ${String(v).replace(/\s+/g, " ")}`);
  const rows = cells.map((c) => [c.distanceAU, c.fluxMilliJy, c.tries, c.found, c.distanceRight, c.fraction === null ? "" : c.fraction.toFixed(4), c.interval ? c.interval[0].toFixed(4) : "", c.interval ? c.interval[1].toFixed(4) : ""].join(","));
  return [...head, "distance_au,flux_mjy,tries,found,distance_right,fraction_found,wilson95_low,wilson95_high", ...rows].join("\n") + "\n";
}

/** A word for the share found, for colour-blind-safe cells that also say the number: "none", "some", "most", "all". */
export function completenessWord(fraction) {
  if (fraction === null || fraction === undefined) return "not run";
  if (fraction === 0) return "none";
  if (fraction >= 0.95) return "all or nearly all";
  if (fraction >= 0.5) return "most";
  return "some";
}
