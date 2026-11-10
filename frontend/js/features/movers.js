// movers.js – "Find movers": look for dots that change position between dates.
//
// Pure maths on grey images (no DOM), so it also runs in Node tests.
//
//   1. detectSources()  per image: bright local peaks (>= 5 sigma after a light smoothing),
//                       each centred to sub-pixel accuracy.
//   2. findMovers()     every pair of dots from two DIFFERENT survey passes proposes a straight
//                       line  position(t) = p0 + v * t.  A line is kept when dots from at least
//                       3 passes lie close to it, and is then re-fitted by least squares.
//                       Still stars come out as lines with v ~ 0, movers as lines whose velocity
//                       is significantly different from 0.
//
// What it does NOT do (v1, on purpose):
//   * It uses POSITIONS only, never brightness: through SPHEREx's variable filter the same star
//     has a different brightness in every image, so brightness says nothing about motion.
//   * Motion smaller than ~1 pixel (6") over the whole observed period looks like a still star.
//   * A mover that blends with a bright star, or moves faster than maxSpeedPxPerYear, is missed.
//   * It needs images of ONE detector from at least 3 survey passes (about 6 months apart), and
//     works on the 8-bit pictures the player shows.

import { canvasToSky, skyToCanvas, mjdToYear } from "../geometry.js";
import { positionAtEpoch } from "../targets.js";

/** Name of this version of the mover search (provenance.js writes it into every result). Change it whenever a change may alter what the search finds. First written 8 Nov 2026.
 *  movers-2: the error of a velocity comes from the errors of the dots (lineUncertainty), not from a floor of 0.15 px: significances change (Phase 4). */
export const VERSION = "movers-2";

export const DEFAULTS = {
  detectSigma: 5,          // a dot must stand this many sigma above the background
  edgeMargin: 2,            // px: peaks closer to the border have unreliable centres
  matchRadiusPx: 1.5,       // a dot supports a line if it is this close to the predicted spot
  staticRadiusPx: 1.2,      // dots this close in two passes are tried first (still stars, slow movers)
  minPassGapDays: 30,       // images less than this apart are one survey pass
  maxSpeedPxPerYear: 60,    // fastest motion we look for (60 px/yr = 370"/yr)
  minDetections: 3,         // a line needs this many dots ... and at least this fraction of the images:
  maxFalseAlarm: 1,          // drop candidates for which this many CHANCE lines are expected in the whole field (see falseAlarm below)
  area: 0,                   // image area in px^2 for that estimate; 0 = take the bounding box of the dots
  minDetectionFraction: 0.6,   // was 0.5: with 6 images and ~9 dots each, 3 chance matches gave 3 false candidates on real data (Epsilon Indi B, D6)
  maxRmsPx: 0.8,            // the dots must lie this close to their fitted line (rms)
  minMotionPx: 0.8,         // total motion over the observed period (about 5")
  minSignificance: 6,       // speed divided by its uncertainty
  centroidFloorPx: 0.15,    // never trust a dot's position better than this (used by the PARALLAX search; the straight-line search takes its errors from the dots: lineUncertainty)
  sigmaFloor: 0.5,          // smallest noise (in grey levels) we believe; use ~1e-9 for real (float) pixel values
};
const GRID_CELL = 8;        // px, for the neighbour lookup

// ------------------------------------------------------------------ position uncertainty (Phase 4)

/**
 * How well is a dot's position known? Fitted on injected point sources (pixel-integrated Gaussian PSF, white noise, 14 000 trials per width, 8 Nov 2026):
 *     sigma^2 = (A / snr)^2 + B^2        per axis, in pixels, snr = the dot's own S/N (detectSources)
 * A = 1.04-1.06 px whatever the PSF; B, the floor left by the PIXEL PHASE (an undersampled PSF pulls the centroid towards the pixel centre by up to 0.05 px),
 * is 0.036 / 0.024 / 0.014 px for PSF sigma = 0.356 / 0.40 / 0.457 px (FWHM 5.15 / 5.8 / 6.61 arcsec at 6.14 arcsec per pixel: the median PSF_FWHM of the D2 and D6 headers).
 * The real PSF is not a Gaussian and real noise is not white, so this is the error of an ideal case: the scatter of the dots of a track (lineUncertainty)
 * and a systematic floor are added on top. scratch/test_astrometry.mjs checks the model on injections, scratch/check_astrometry_real.mjs on real stars.
 */
export const POSITION_NOISE_COEFF = 1.05;
const PHASE_FLOOR_PX = [[0.356, 0.036], [0.4, 0.024], [0.457, 0.014]];       // [PSF sigma px, B px], measured; outside this range the nearest value is used
export const DEFAULT_PSF_SIGMA_PX = 0.356;                                   // D2 (the narrowest, so the largest floor B): the cautious default
export const MASKED_FIT_SIGMA_PX = 0.15;                                     // a star positioned by the masked Gaussian fit (a saturated core): not covered by the model above

/**
 * The same for a position refined by fitPsfCentroid (a PSF of the true width fitted by least squares): measured on the same injections as above
 * (scratch/compare_centroids.mjs): A = 0.715-0.729 px and B = 0.001 px, so there is no pixel-phase floor and the coefficient is 0.73. A small floor stays
 * for what a Gaussian does not know about the real PSF.
 */
export const PSF_FIT_NOISE_COEFF = 0.73;
export const PSF_FIT_FLOOR_PX = 0.005;

export function centroidSigmaPx(snr, psfSigmaPx = DEFAULT_PSF_SIGMA_PX, { psfFit = false } = {}) {
  if (!(snr > 0) || !Number.isFinite(snr)) return 0.3;                       // no usable S/N: say so with a large error
  if (psfFit) return Math.hypot(PSF_FIT_NOISE_COEFF / snr, PSF_FIT_FLOOR_PX);
  const t = PHASE_FLOOR_PX;
  let B = t[0][1];
  if (psfSigmaPx >= t.at(-1)[0]) B = t.at(-1)[1];
  else if (psfSigmaPx > t[0][0]) {
    const k = t.findIndex((p, i) => i > 0 && psfSigmaPx <= p[0]);
    B = t[k - 1][1] + ((psfSigmaPx - t[k - 1][0]) / (t[k][0] - t[k - 1][0])) * (t[k][1] - t[k - 1][1]);
  }
  return Math.hypot(POSITION_NOISE_COEFF / snr, B);
}

/** What the images do not tell us, added in quadrature to a fitted track (registration of the exposures on the field stars, a PSF that is not Gaussian): px per axis. */
export const SYSTEMATIC_SIGMA_PX = 0.04;       // the floor that real fixed stars brighter than S/N 60 need (0.055 px scatter against 0.038 modelled: scratch/check_astrometry_real.mjs, VALIDATION §15)

/**
 * Uncertainty of a straight-line fit through dots (position = p0 + v t), propagated from the errors of the dots.
 *   members : [{ t (years), sigma (px per axis, centroidSigmaPx) }]
 *   rms     : the scatter of the dots about the fit, per axis, with the degrees of freedom taken out (px)
 * The velocity of the ordinary least-squares line has the exact error  sqrt(sum dt_i^2 sigma_i^2) / sum dt_i^2  (dt = t - mean t); it is multiplied by
 * max(1, rms / model rms) when the dots scatter more than their errors say (never made smaller by a lucky small rms: with 3 dots one degree of freedom
 * says almost nothing), and combined with the systematic floor.
 * -> { sigmaPos: what to expect of one dot (px), vErr: error of each velocity component (px/yr), posErr: error of the mean position (px), sxx, inflation }
 */
export function lineUncertainty(members, rms, { systematicPx = SYSTEMATIC_SIGMA_PX } = {}) {
  const m = members.length;
  const tm = members.reduce((s, d) => s + d.t, 0) / m;
  let sxx = 0, wdt = 0, sumVar = 0;
  for (const d of members) { const dt = d.t - tm; sxx += dt * dt; wdt += dt * dt * d.sigma * d.sigma; sumVar += d.sigma * d.sigma; }
  const modelRms = Math.sqrt(sumVar / m);
  const inflation = Number.isFinite(rms) && modelRms > 0 ? Math.max(1, rms / modelRms) : 1;
  const sigmaPos = Math.hypot(modelRms * inflation, systematicPx);
  const vModel = sxx > 1e-12 ? Math.sqrt(wdt) / sxx : Infinity;
  return {
    sigmaPos, inflation, sxx,
    vModel, modelRms, systematicPx,                  // the parts of vErr, for the uncertainty budget (uncertainty.js)
    vErr:Math.hypot(vModel * inflation, sxx > 1e-12 ? systematicPx / Math.sqrt(sxx) : 0),
    posErr: Math.hypot((Math.sqrt(sumVar) / m) * inflation, systematicPx / Math.sqrt(m)),
  };
}

/** P(X >= k) for X ~ Binomial(trials, p), summed from the top (no cancellation for tiny tails). */
export function binomialTail(trials, p, k) {
  if (k <= 0) return 1;
  if (k > trials || p <= 0) return 0;
  if (p >= 1) return 1;
  const logFact = [0];
  for (let i = 1; i <= trials; i++) logFact.push(logFact[i - 1] + Math.log(i));
  let sum = 0;
  for (let i = k; i <= trials; i++) sum += Math.exp(logFact[trials] - logFact[i] - logFact[trials - i] + i * Math.log(p) + (trials - i) * Math.log1p(-p));
  return Math.min(1, sum);
}

/** Area (px^2) covered by the dots of all images: the bounding box (used when the caller does not say how big the image is). */
function boundingArea(dots) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const list of dots) for (const d of list) { x0 = Math.min(x0, d.x); x1 = Math.max(x1, d.x); y0 = Math.min(y0, d.y); y1 = Math.max(y1, d.y); }
  return Number.isFinite(x0) ? Math.max(100, (x1 - x0) * (y1 - y0)) : 100;
}

// ------------------------------------------------------------------ 1) detection

/** [1 2 1]/4 smoothing in x then y (a tiny matched filter for stars about 2 px wide). */
function smooth(grey, n) {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      tmp[row + x] = (grey[row + Math.max(0, x - 1)] + 2 * grey[row + x] + grey[row + Math.min(n - 1, x + 1)]) / 4;
    }
  }
  for (let y = 0; y < n; y++) {
    const up = Math.max(0, y - 1) * n, mid = y * n, down = Math.min(n - 1, y + 1) * n;
    for (let x = 0; x < n; x++) out[mid + x] = (tmp[up + x] + 2 * tmp[mid + x] + tmp[down + x]) / 4;
  }
  return out;
}

/**
 * Background level and noise of an image, from about 20 000 sample pixels.
 * Noise = 84th percentile minus median ("upper-half sigma"): stars hardly move it, and it is
 * not fooled by the dark end being clipped at 0 in 8-bit pictures.
 */
function backgroundStats(img, sigmaFloor = DEFAULTS.sigmaFloor) {
  const step = Math.max(1, Math.floor(img.length / 20000));
  const sample = [];
  for (let i = 0; i < img.length; i += step) sample.push(img[i]);
  sample.sort((a, b) => a - b);
  const q = (p) => sample[Math.min(sample.length - 1, Math.floor(p * sample.length))];
  const median = q(0.5);
  return { median, sigma: Math.max(sigmaFloor, q(0.8413) - median) };
}

/** Pixels with no data (NaN, e.g. beyond the edge of the detector) become the median, so they cannot become "dots". */
function fillMissing(img) {
  let bad = 0;
  for (let i = 0; i < img.length; i++) if (!Number.isFinite(img[i])) bad++;
  if (!bad) return img;
  const finite = [];
  const step = Math.max(1, Math.floor(img.length / 20000));
  for (let i = 0; i < img.length; i += step) if (Number.isFinite(img[i])) finite.push(img[i]);
  finite.sort((a, b) => a - b);
  const median = finite.length ? finite[Math.floor(finite.length / 2)] : 0;
  const out = new Float32Array(img.length);
  for (let i = 0; i < img.length; i++) out[i] = Number.isFinite(img[i]) ? img[i] : median;
  return out;
}

/** Is pixel (x, y) the top of its 3x3 neighbourhood? Ties go to the first pixel in reading order. */
function isLocalMax(img, n, x, y, v) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const u = img[(y + dy) * n + x + dx];
      const earlier = dy < 0 || (dy === 0 && dx < 0);
      if (earlier ? u >= v : u > v) return false;
    }
  }
  return true;
}

/**
 * Centre of a star: brightness-weighted mean of the pixels around it, with a Gaussian window that is
 * re-centred on the previous answer 6 times (the usual "windowed centroid"). Pixel i covers [i, i+1).
 * A plain 5x5 box centred on the peak pixel was 0.8 px off for very bright stars, which saturate the
 * 8-bit picture into a flat-topped blob with wide wings: enough to hide a mover on real data.
 */
function centroid(grey, n, px, py, background) {
  const RADIUS = 3, SIGMA = 1.3;           // tight enough not to mix in a neighbouring star
  let cx = px + 0.5, cy = py + 0.5;
  for (let pass = 0; pass < 6; pass++) {
    const ix = Math.floor(cx), iy = Math.floor(cy);
    let sw = 0, sx = 0, sy = 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const x = ix + dx, y = iy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const w0 = grey[y * n + x] - background;
        if (w0 <= 0) continue;
        const ex = x + 0.5 - cx, ey = y + 0.5 - cy;
        const w = w0 * Math.exp(-(ex * ex + ey * ey) / (2 * SIGMA * SIGMA));
        sw += w; sx += w * (x + 0.5); sy += w * (y + 0.5);
      }
    }
    if (sw <= 0) return pass ? { x: cx, y: cy } : null;
    cx = sx / sw; cy = sy / sw;
  }
  return { x: cx, y: cy };
}

const FIT_HALF = 5, FIT_SIGMA = 1.3;        // 11 x 11 window; star width (px) of the fixed Gaussian model, as the centroid window

/** Solve the small normal equations A x = b (Gauss-Jordan); null when singular. */
function solveSmall(A, b) {
  const m = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[m] / row[i]);
}

/** The standard normal distribution function (error function of Abramowitz & Stegun 7.1.26, absolute error below 1.5e-7). */
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erfAbs = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + Math.sign(z) * erfAbs);
}
const normalPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/**
 * The position of a star by least squares with the PSF the instrument has: a Gaussian of width `sigma` px INTEGRATED over each pixel (the PSF of SPHEREx is
 * smaller than a pixel, so a pixel holds the integral of the star over it, not its value at the middle), with the centre and the total flux free and the
 * background fixed at `background`. Fitted to the (2 half + 1)^2 pixels around the integer pixel (px, py); pixels that are flagged (mask) or not finite are left out.
 * Unlike the windowed centroid it has no pixel-phase bias and, on injected stars, reaches the Cramer-Rao limit (scratch/compare_centroids.mjs, VALIDATION 15.7).
 * Returns { x, y, flux } in edge coordinates (centre of pixel 0 = 0.5), or null: too few good pixels, no flux, a fit that does not converge or runs away from
 * its start. `start` = { x, y } is the first guess (default: the middle of the pixel).
 */
export function fitPsfCentroid(image, n, px, py, { sigma = DEFAULT_PSF_SIGMA_PX, half = 3, mask = null, start = null, background = 0 } = {}) {
  const pix = [];
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const v = image[y * n + x];
      if (!Number.isFinite(v) || (mask && mask[y * n + x])) continue;
      pix.push({ x, y, v: v - background });
    }
  }
  const nWindow = (2 * half + 1) ** 2;
  if (pix.length < 0.7 * nWindow) return null;                                      // a good part of the window is missing: the fit would lean on too few pixels
  let cx = start?.x ?? px + 0.5, cy = start?.y ?? py + 0.5;
  const x0 = cx, y0 = cy;
  let flux = pix.reduce((s, p) => s + p.v, 0);
  if (!(flux > 0)) return null;
  for (let it = 0; it < 30; it++) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const p of pix) {
      const ux0 = (p.x - cx) / sigma, ux1 = (p.x + 1 - cx) / sigma, uy0 = (p.y - cy) / sigma, uy1 = (p.y + 1 - cy) / sigma;
      const ix = normalCdf(ux1) - normalCdf(ux0), iy = normalCdf(uy1) - normalCdf(uy0);
      const dix = (normalPdf(ux0) - normalPdf(ux1)) / sigma, diy = (normalPdf(uy0) - normalPdf(uy1)) / sigma;       // derivative of the pixel's share with the centre
      const row = [flux * dix * iy, flux * ix * diy, ix * iy];
      const r = p.v - flux * ix * iy;
      for (let i = 0; i < 3; i++) { b[i] += row[i] * r; for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j]; }
    }
    const step = solveSmall(A, b);
    if (!step || !step.every(Number.isFinite)) return null;
    const move = Math.hypot(step[0], step[1]), damp = move > 0.7 ? 0.7 / move : 1;                  // never move the centre more than 0.7 px at once
    cx += step[0] * damp; cy += step[1] * damp; flux += step[2] * damp;
    if (Math.hypot(cx - x0, cy - y0) > 1.5 || !(flux > 0)) return null;
    if (Math.hypot(step[0], step[1]) < 1e-5 && Math.abs(step[2]) < 1e-5 * flux) return { x: cx, y: cy, flux };
  }
  return null;
}

const MIN_BAD_CORE = 6;       // bad (or empty) pixels among the 25 of the 5 x 5 core before the masked fit is used

/**
 * Is the core of the star (5 x 5 around its peak) compromised: at least MIN_BAD_CORE pixels flagged as bad or without data?
 * With one or two flagged pixels the plain centroid is better: on real Epsilon Indi B (faint, not saturated) a single flagged
 * core pixel moved the fixed-width fit by 0.4 px, because a Gaussian is not the real PSF.
 */
export function coreIsCompromised(image, mask, n, x, y) {
  let bad = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      if (mask[yy * n + xx] || !Number.isFinite(image[yy * n + xx])) bad++;
    }
  }
  return bad >= MIN_BAD_CORE;
}

/**
 * Position of a star whose core is flagged (a saturated bright star): a Gaussian of fixed width fitted by least squares to
 * the GOOD pixels only (centre, height and background free). A centroid over all pixels is pulled by whatever the flagged
 * core happens to hold on each date: on real Barnard's Star (detector D2) the motion came out 3.7"/yr off the catalogue
 * that way and 0.5"/yr with this fit. Returns null when too few good pixels or the fit runs away (the caller then keeps the centroid).
 */
function fitMaskedGaussian(grey, image, mask, n, px, py, background) {
  const pix = [];
  for (let dy = -FIT_HALF; dy <= FIT_HALF; dy++) {
    for (let dx = -FIT_HALF; dx <= FIT_HALF; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= n || y >= n || mask[y * n + x] || !Number.isFinite(image[y * n + x])) continue;
      pix.push([x + 0.5, y + 0.5, grey[y * n + x]]);
    }
  }
  if (pix.length < 14) return null;
  const top = Math.max(...pix.map((p) => p[2])) - background;
  if (!(top > 0)) return null;
  let cx = px + 0.5, cy = py + 0.5, amp = top, bg = background;
  for (let it = 0; it < 40; it++) {
    const AtA = Array.from({ length: 4 }, () => new Array(4).fill(0)), Atb = new Array(4).fill(0);
    for (const [x, y, v] of pix) {
      const ex = x - cx, ey = y - cy, g = Math.exp(-(ex * ex + ey * ey) / (2 * FIT_SIGMA * FIT_SIGMA));
      const row = [amp * g * ex / (FIT_SIGMA * FIT_SIGMA), amp * g * ey / (FIT_SIGMA * FIT_SIGMA), g, 1];
      const r = v - (bg + amp * g);
      for (let i = 0; i < 4; i++) { Atb[i] += row[i] * r; for (let j = 0; j < 4; j++) AtA[i][j] += row[i] * row[j]; }
    }
    const step = solveSmall(AtA, Atb);
    if (!step) return null;
    const damp = Math.min(1, 1 / Math.max(1e-9, Math.hypot(step[0], step[1])));          // never move the centre more than 1 px at once
    cx += step[0] * damp; cy += step[1] * damp; amp += step[2]; bg += step[3];
    if (Math.abs(cx - px - 0.5) > 3 || Math.abs(cy - py - 0.5) > 3 || !(amp > 0)) return null;
    if (Math.hypot(step[0], step[1]) < 1e-4) break;
  }
  return { x: cx, y: cy };
}

// A flagged peak alone can clear the smoothed detection threshold. Require support on nearby
// usable pixels before accepting it; a saturated source can still qualify through its wings.
function hasGoodWing(image, mask, n, x, y, threshold) {
  let supporting = 0;
  for (let j = Math.max(0, y - 3); j <= Math.min(n - 1, y + 3); j++) {
    for (let i = Math.max(0, x - 3); i <= Math.min(n - 1, x + 3); i++) {
      const k = j * n + i;
      if (!mask[k] && Number.isFinite(image[k]) && image[k] > threshold && ++supporting >= 2) return true;
    }
  }
  return false;
}

/**
 * Dots in one grey image (n x n, values 0..255, row 0 = top).
 * Returns [{ x, y, snr, sigmaPx }] with x, y in "edge" pixel coordinates (centre of pixel 0 = 0.5); sigmaPx is the error of the position per axis (centroidSigmaPx).
 * options.mask (optional, Uint8Array n*n, 1 = bad pixel, from the backend's `maskUrl`): a star whose 5 x 5 core has at least
 * MIN_BAD_CORE flagged pixels (a saturated star) is positioned by fitting a Gaussian on the good pixels only (see fitMaskedGaussian).
 */
export function detectSources(image, n, { detectSigma = DEFAULTS.detectSigma, edgeMargin = DEFAULTS.edgeMargin, sigmaFloor = DEFAULTS.sigmaFloor, mask = null, psfSigmaPx = DEFAULT_PSF_SIGMA_PX, psfFit = false } = {}) {
  if (!image || image.length !== n * n || n < 2 * edgeMargin + 3) return [];
  const useMask = mask && mask.length === n * n;
  const grey = fillMissing(image);          // `image` may be 8-bit grey values or real (float) pixel values
  const sm = smooth(grey, n);
  const { median, sigma } = backgroundStats(sm, sigmaFloor);
  const threshold = median + detectSigma * sigma;
  const found = [];
  for (let y = edgeMargin; y < n - edgeMargin; y++) {
    for (let x = edgeMargin; x < n - edgeMargin; x++) {
      const v = sm[y * n + x];
      if (v < threshold || !isLocalMax(sm, n, x, y, v)) continue;
      const compromised = useMask && coreIsCompromised(image, mask, n, x, y);
      if (useMask && !compromised && mask[y * n + x] && !hasGoodWing(image, mask, n, x, y, threshold)) continue;
      let c = centroid(grey, n, x, y, median);
      let masked = false;
      if (c && compromised) {
        const fit = fitMaskedGaussian(grey, image, mask, n, x, y, median);
        if (fit) { c = fit; masked = true; }
      }
      // psfFit: refine a star whose core is intact with a pixel-integrated Gaussian of the true width (fitPsfCentroid); a masked star keeps the masked fit, a failed fit keeps the centroid
      let fitted = false;
      if (psfFit && c && !masked) {
        const f = fitPsfCentroid(image, n, x, y, { sigma: psfSigmaPx, background: median, mask: useMask ? mask : null, start: c });
        if (f) { c = f; fitted = true; }
      }
      const snr = (v - median) / sigma;
      // sigmaPx: the error of this position per axis (centroidSigmaPx); a star positioned by the masked fit is outside that model and gets the cautious MASKED_FIT_SIGMA_PX
      if (c) found.push({ x: c.x, y: c.y, snr, sigmaPx: masked ? Math.max(MASKED_FIT_SIGMA_PX, centroidSigmaPx(snr, psfSigmaPx)) : centroidSigmaPx(snr, psfSigmaPx, { psfFit: fitted }) });
    }
  }
  return found;
}

// ------------------------------------------------------------------ 2) linking

/** Spatial hash so "which dots are near here?" does not scan every dot. */
function makeGrid(dots) {
  const cells = new Map();
  const key = (cx, cy) => cx * 100003 + cy;
  for (const d of dots) {
    const k = key(Math.floor(d.x / GRID_CELL), Math.floor(d.y / GRID_CELL));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(d);
  }
  const each = (x, y, r, visit) => {
    const c0 = Math.floor((x - r) / GRID_CELL), c1 = Math.floor((x + r) / GRID_CELL);
    const r0 = Math.floor((y - r) / GRID_CELL), r1 = Math.floor((y + r) / GRID_CELL);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const list = cells.get(key(cx, cy));
        if (!list) continue;
        for (const d of list) if (!d.used && Math.hypot(d.x - x, d.y - y) <= r) visit(d);
      }
    }
  };
  return {
    each,
    /** Closest unused dot within r of (x, y), or null. */
    nearest(x, y, r) {
      let best = null, bestDist = Infinity;
      each(x, y, r, (d) => {
        const dist = Math.hypot(d.x - x, d.y - y);
        if (dist < bestDist) { best = d; bestDist = dist; }
      });
      return best;
    },
  };
}

/** Least-squares straight line through dots (one per image): position = p0 + v * (t - tRef). */
function fitLine(members, t) {
  const m = members.length;
  let tm = 0, mx = 0, my = 0;
  for (const d of members) { tm += t[d.k]; mx += d.x; my += d.y; }
  tm /= m; mx /= m; my /= m;
  let sxx = 0, sxt = 0, syt = 0;
  for (const d of members) {
    const dt = t[d.k] - tm;
    sxx += dt * dt; sxt += dt * (d.x - mx); syt += dt * (d.y - my);
  }
  const ok = sxx > 1e-9;
  return { x0: mx, y0: my, vx: ok ? sxt / sxx : 0, vy: ok ? syt / sxx : 0, tRef: tm, sxx };
}
const lineAt = (line, time) => ({
  x: line.x0 + line.vx * (time - line.tRef),
  y: line.y0 + line.vy * (time - line.tRef),
});

/** Survey-pass number (0, 1, 2 ...) of each image: images less than minGapDays apart share a pass. */
export function passIndices(mjds, minGapDays = DEFAULTS.minPassGapDays) {
  const out = [];
  let pass = 0;
  mjds.forEach((mjd, k) => {
    if (k && mjd - mjds[k - 1] >= minGapDays) pass++;
    out.push(pass);
  });
  return out;
}

/**
 * Find movers among dots already detected.
 * frames: [{ mjd, sources: [{ x, y, snr }] }] in TIME ORDER (the order of the blink player).
 * Returns { candidates, stats, reason? }. Each candidate:
 *   { x, y, vx, vy, mjdRef,           position (px) at mjdRef and velocity (px per year)
 *     speedPx, motionPx,              |v| and total motion over the dots used
 *     nDet, nFrames, rms, significance, snr,
 *     points: [{ frame, x, y }] }     the dots that belong to it
 * sorted best first (largest significance).
 */
function findMoversOnce(frames, o) {
  const N = frames.length;
  const stats = { frames: N, passes: 0, dotsPerFrame: frames.map((f) => f.sources.length), stillDots: 0 };
  if (N < 3) return { candidates: [], stats, reason: "needs at least 3 images" };
  for (let k = 1; k < N; k++) if (frames[k].mjd < frames[k - 1].mjd) throw new Error("frames must be in time order");

  const t0 = frames[0].mjd;
  const t = frames.map((f) => (f.mjd - t0) / 365.25);                 // years since the first image
  const mjdRef = (t0 + frames[N - 1].mjd) / 2;
  const tRef = (mjdRef - t0) / 365.25;

  // Survey passes ("epochs"): images less than minPassGapDays apart belong to the same pass.
  // Two dots from two passes ALWAYS define a line; only a third pass can prove it is real.
  const epoch = passIndices(frames.map((f) => f.mjd), o.minPassGapDays);
  const nEpochs = epoch[N - 1] + 1;
  stats.passes = nEpochs;
  if (nEpochs < 3) {
    return { candidates: [], stats, reason: `needs images from at least 3 survey passes (found ${nEpochs})` };
  }
  const minEpochs = Math.min(nEpochs, Math.max(3, Math.ceil(nEpochs / 2)));
  const minDet = Math.max(o.minDetections, Math.ceil(o.minDetectionFraction * N));
  const epochsOf = (members) => new Set(members.map((d) => epoch[d.k])).size;

  const dots = frames.map((f, k) => f.sources.map((s) => ({ k, x: s.x, y: s.y, snr: s.snr ?? 0, sigma: s.sigmaPx ?? centroidSigmaPx(s.snr ?? 0), used: false })));
  const grids = dots.map(makeGrid);
  const candidates = [];
  let tested = 0;                                    // pairs of dots tried as the start of a line (for the false-alarm estimate)

  // The closest unused dot to the line's predicted spot, image by image.
  const collect = (line) => {
    const members = [];
    for (let k = 0; k < N; k++) {
      const p = lineAt(line, t[k]);
      const hit = grids[k].nearest(p.x, p.y, o.matchRadiusPx);
      if (hit) members.push(hit);
    }
    return members;
  };

  /** Does the pair (a, b) start a real line? If so, record it (mover or still star) and say true. */
  const tryLine = (a, b) => {
    const dt = t[b.k] - t[a.k];
    // 1) the straight line through the pair, and the dots that agree with it
    let line = { x0: a.x, y0: a.y, vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt, tRef: t[a.k] };
    let members = collect(line);
    if (members.length < minDet || epochsOf(members) < minEpochs) return false;
    // 2) refine: fit all those dots, look again (picks up images the two-point line missed)
    for (let pass = 0; pass < 2; pass++) {
      line = fitLine(members, t);
      const again = collect(line);
      if (again.length < minDet || epochsOf(again) < minEpochs) return false;
      members = again;
    }
    line = fitLine(members, t);

    // 3) quality of the fit
    let ss = 0, snrSum = 0;
    for (const d of members) {
      const p = lineAt(line, t[d.k]);
      ss += (d.x - p.x) ** 2 + (d.y - p.y) ** 2;
      snrSum += d.snr;
    }
    const m = members.length;
    const rms = Math.sqrt(ss / (2 * Math.max(1, m - 2)));
    if (rms > o.maxRmsPx) return false;

    // 4) accept the line; is it a still star or a mover?
    for (const d of members) d.used = true;
    // the error of the velocity comes from the errors of the dots (lineUncertainty), not from a fixed floor: checked against repeated injections (scratch/test_astrometry.mjs)
    const u = lineUncertainty(members.map((d) => ({ t: t[d.k], sigma: d.sigma })), rms);
    const speed = Math.hypot(line.vx, line.vy);
    const first = Math.min(...members.map((d) => t[d.k])), last = Math.max(...members.map((d) => t[d.k]));
    const motion = speed * (last - first);
    const significance = speed / u.vErr;
    if (significance < o.minSignificance || motion < o.minMotionPx) { stats.stillDots += 1; return true; }

    const at = lineAt(line, tRef);
    candidates.push({
      x: at.x, y: at.y, vx: line.vx, vy: line.vy, mjdRef,
      speedPx: speed, motionPx: motion,
      nDet: m, nFrames: N, rms, significance, snr: snrSum / m,
      vModelPx: u.vModel, inflation: u.inflation, sxx: u.sxx, systematicPx: u.systematicPx,   // the parts of vErrPx (uncertainty.js budget)
      vErrPx: u.vErr, posErrPx: u.posErr,                      // error of each velocity component (px/yr) and of the position (px), from the errors of the dots
      points: members.map((d) => ({ frame: d.k, x: d.x, y: d.y })),
    });
    return true;
  };

  // Pairs of dots from two different passes, closest partner first.
  //   Round 1 (slowOnly): partners within staticRadiusPx = still stars and slow movers. A dot that has
  //     a partner but no valid line (probably a faint star seen in only two passes) is set aside.
  //   Round 2: whatever is left, partners up to maxSpeedPxPerYear = fast movers.
  // Stars go first so they cannot be mistaken for the ends of a fast line.
  const search = (radiusFor, setAside) => {
    for (let i = 0; i < N - 1; i++) {
      for (let j = i + 1; j < N; j++) {
        if (epoch[i] === epoch[j]) continue;
        const dt = t[j] - t[i];
        for (const a of dots[i]) {
          if (a.used) continue;
          const near = [];
          grids[j].each(a.x, a.y, radiusFor(dt), (b) => near.push(b));
          tested += near.length;
          near.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
          for (const b of near) {
            if (a.used) break;
            if (!b.used && tryLine(a, b)) break;
          }
          if (setAside && !a.used && near.length) {
            a.used = true;
            const b = near.find((d) => !d.used);
            if (b) b.used = true;
          }
        }
      }
    }
  };
  search(() => o.staticRadiusPx, true);
  search((dt) => o.maxSpeedPxPerYear * dt, false);

  // How likely is it that CHANCE alone made a line like each candidate? Any dot has a small probability pHit of lying within
  // matchRadiusPx of a predicted spot (dots * pi * r^2 / area). A line started by one of the `tested` pairs needs at least
  // nDet - 2 further hits among the other N - 2 images, so  expected chance lines = tested * P(Binomial(N-2, pHit) >= nDet - 2).
  // (The significance in sigma grows with speed, so a fast chance line can show 20 sigma: this is the honest number.)
  const area = o.area > 0 ? o.area : boundingArea(dots);
  const pHit = dots.reduce((s, list) => s + Math.min(0.5, (list.length * Math.PI * o.matchRadiusPx ** 2) / area), 0) / N;
  for (const c of candidates) c.falseAlarm = tested * binomialTail(N - 2, pHit, c.nDet - 2);
  stats.pairsTested = tested;
  stats.chanceHitProbability = pHit;
  const kept = candidates.filter((c) => c.falseAlarm <= o.maxFalseAlarm);
  stats.rejectedByFalseAlarm = candidates.length - kept.length;
  kept.sort((p, q) => p.falseAlarm - q.falseAlarm || q.significance - p.significance);
  return { candidates: kept, stats };
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * How far is each image shifted from the reference image (the one with most dots)?
 * Every exposure has its own small pointing error (real SPHEREx passes differ by up to ~0.7 px), and
 * over a one-year baseline that looks like a motion of several arcsec/yr. The stars all shift
 * together, so the shift is the translation that makes most dots of the two images coincide: every
 * pair of dots votes for its offset; the field stars pile their votes on one offset, a mover or a
 * chance pair adds a single vote somewhere else. No vote winner = shift 0.
 */
export function registerShifts(frames, { maxShiftPx = 3, binPx = 0.25, minVotes = 5 } = {}) {
  let ref = 0;
  frames.forEach((f, k) => { if (f.sources.length > frames[ref].sources.length) ref = k; });
  const shifts = frames.map(() => ({ dx: 0, dy: 0, votes: 0 }));
  const bins = Math.round((2 * maxShiftPx) / binPx) + 1;
  for (let k = 0; k < frames.length; k++) {
    if (k === ref) continue;
    const hist = new Float32Array(bins * bins);
    const pairs = [];
    for (const a of frames[ref].sources) {
      for (const b of frames[k].sources) {
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) > maxShiftPx || Math.abs(dy) > maxShiftPx) continue;
        hist[Math.round((dy + maxShiftPx) / binPx) * bins + Math.round((dx + maxShiftPx) / binPx)] += 1;
        pairs.push([dx, dy]);
      }
    }
    let best = -1, bi = 0, bj = 0;                               // peak of the histogram smoothed over 3 x 3 bins
    for (let j = 1; j < bins - 1; j++) {
      for (let i = 1; i < bins - 1; i++) {
        let s = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += hist[(j + dj) * bins + (i + di)];
        if (s > best) { best = s; bi = i; bj = j; }
      }
    }
    if (best < minVotes) continue;
    const cx = bi * binPx - maxShiftPx, cy = bj * binPx - maxShiftPx;
    const near = pairs.filter(([dx, dy]) => Math.hypot(dx - cx, dy - cy) <= 0.6);
    shifts[k] = { dx: median(near.map((p) => p[0])), dy: median(near.map((p) => p[1])), votes: near.length };
  }
  return shifts;
}

/**
 * Find movers among dots already detected (see findMoversOnce for the result).
 * First the images are registered on the field stars (registerShifts) and the dots corrected; then the
 * search runs. Candidates carry `shifts[k]`: add it to a position of the corrected frame to get the
 * pixel in image k (for drawing). `register: false` skips the registration.
 */
export function findMovers(frames, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (o.register === false || frames.length < 3) return findMoversOnce(frames, o);
  const shifts = registerShifts(frames);
  const used = shifts.map((s) => (Math.abs(s.dx) > 0.05 || Math.abs(s.dy) > 0.05 ? s : { ...s, dx: 0, dy: 0 }));
  const corrected = frames.map((f, k) => ({ mjd: f.mjd, sources: f.sources.map((s) => ({ ...s, x: s.x - used[k].dx, y: s.y - used[k].dy })) }));
  const result = findMoversOnce(corrected, o);
  result.stats.shifts = used;
  for (const c of result.candidates) c.shifts = used;
  return result;
}

/**
 * Detect dots in every image, then link them. frames: [{ mjd, grey, mask? }] in time order (mask = the backend's
 * bad-pixel bytes, see detectSources). The image area is passed on for the false-alarm estimate.
 */
export function findMoversInImages(frames, n, options = {}) {
  const detected = frames.map((f) => ({ mjd: f.mjd, sources: detectSources(f.grey, n, { ...options, mask: f.mask ?? null }) }));
  return findMovers(detected, { area: n * n, ...options });
}

/**
 * The images of ALL detectors of a field, linked together AND each detector alone; the results are merged.
 * frames: [{ mjd, detector, id, grey, mask? }] in time order. The search uses positions only, so different wavelengths can be
 * linked together: 3-6 times more images and passes (real Barnard's Star: 0.80 -> 0.28 arcsec/yr off the catalogue). But an
 * object that is invisible in part of the spectrum (a brown dwarf in the short bands) is then in too few of the images, and
 * only a single detector sees it often enough: so both are tried. The same object found twice (a position within 3 px on
 * the same date and a similar velocity) is kept once, with the smaller chance of being a false alarm.
 * Each candidate gets `frameIds` (the image each entry of its `shifts` belongs to) and `foundIn` ("all detectors" or "D6").
 */
export function findMoversAcrossDetectors(frames, n, options = {}) {
  const detectors = [...new Set(frames.map((f) => f.detector))];
  const sets = [{ name: detectors.length > 1 ? "all detectors" : detectors[0], list: frames }];
  if (detectors.length > 1) for (const d of detectors) sets.push({ name: d, list: frames.filter((f) => f.detector === d) });
  const all = [];
  let firstResult = null, firstRan = null;                       // the first search at all / the first that was able to run
  for (const s of sets) {
    const r = findMoversInImages(s.list, n, options);
    firstResult ??= r;
    if (r.reason) continue;                                      // e.g. this detector alone has fewer than 3 passes
    firstRan ??= r;
    const ids = s.list.map((f) => f.id);
    for (const c of r.candidates) { c.frameIds = ids; c.foundIn = s.name; all.push(c); }
  }
  all.sort((p, q) => p.falseAlarm - q.falseAlarm || q.significance - p.significance);
  const kept = [];
  for (const c of all) {
    const same = kept.some((k) => {
      const p = moverPositionAtMjd(c, k.mjdRef), v = Math.hypot(c.vx - k.vx, c.vy - k.vy);
      return Math.hypot(p.x - k.x, p.y - k.y) <= 3 && v <= Math.max(1, 0.5 * Math.hypot(k.vx, k.vy));
    });
    if (!same) kept.push(c);
  }
  const base = firstRan ?? firstResult;
  return { candidates: kept, stats: { ...base.stats, searchedSets: sets.map((s) => s.name) }, reason: firstRan ? undefined : firstResult.reason };
}

// ------------------------------------------------------------------ 2b) does the candidate's path hold up in EVERY image?

/**
 * Brightness at one spot: the sum inside a circle of radius r (px) minus the median background of a ring from r+2 to r+5, with
 * the noise taken from the ring's robust scatter (so a neighbouring star does not inflate it). Pixel (px, py) covers
 * [px, px+1). Returns { flux, err, snr } or null when too close to the edge / no data.
 */
export function apertureSnr(img, n, x, y, r = 2) {
  if (x < r || y < r || x > n - r || y > n - r) return null;       // a partly cut-off aperture would give a flux that is too low: not measurable
  const inside = [], ring = [];
  let geometric = 0;                                                  // pixel centres inside the circle, with or without data
  const rOut = r + 5;
  for (let py = Math.floor(y - rOut); py <= Math.ceil(y + rOut); py++) {
    if (py < 0 || py >= n) continue;
    for (let px = Math.floor(x - rOut); px <= Math.ceil(x + rOut); px++) {
      if (px < 0 || px >= n) continue;
      const v = img[py * n + px];
      const d = Math.hypot(px + 0.5 - x, py + 0.5 - y);
      const finite = Number.isFinite(v);
      if (d <= r) { geometric++; if (finite) inside.push(v); } else if (finite && d >= r + 2 && d <= rOut) ring.push(v);
    }
  }
  // Holes (no data) in the aperture: not measurable. The yardstick is the number of pixel centres that fall in THIS circle (9 to 13
  // for r = 2, depending on where the circle sits on the pixel grid), not a constant: the old limit of 0.8 pi r^2 = 10.05 rejected
  // a full aperture whenever only 10 centres happened to fall inside (7 Nov 2026: seen on a synthetic star 0.0 px from a pixel centre).
  if (geometric === 0 || inside.length < 0.8 * geometric || ring.length < 10) return null;
  const sorted = [...ring].sort((a, b) => a - b);
  const bg = sorted[Math.floor(sorted.length / 2)];
  const mad = [...ring].map((v) => Math.abs(v - bg)).sort((a, b) => a - b)[Math.floor(ring.length / 2)];
  const sd = Math.max(1.4826 * mad, 1e-12);
  const flux = inside.reduce((s, v) => s + v, 0) - bg * inside.length;
  const err = sd * Math.sqrt(inside.length);
  // errTotal: the same noise, plus the error of the background level (the median of the ring has its own, (pi/2) sd^2 / N): exact for white noise
  // (injections: the measured spread of the flux is 1.10 x err and 1.00 x errTotal). `snr` stays flux / err: the S/N the thresholds of the searches were tuned with.
  const errTotal = sd * Math.sqrt(inside.length + ((inside.length * inside.length) / ring.length) * (Math.PI / 2));
  return { flux, err, snr: flux / err, errTotal, nInside: inside.length, nRing: ring.length };
}

/**
 * The factor by which the REAL SPHEREx cutouts' noise exceeds apertureSnr's `err` (robust sd of flux/err at 7 950 empty places of the six real fields: 1.68, per field
 * 1.47-1.85; docs/VALIDATION.md §15). The cutouts are resampled (their noise is correlated between pixels) and the sky holds sources below the detection
 * threshold, so the scatter of a sum over an aperture is larger than the scatter of single pixels says. An upper-ish figure: some of it is real faint sources.
 */
export const REAL_APERTURE_NOISE_FACTOR = 1.7;

/** The 1-sigma uncertainty to REPORT for the flux of an aperture (image units): real cutouts x REAL_APERTURE_NOISE_FACTOR, synthetic (white noise) errTotal. */
export const calibratedFluxErr = (ap, real) => (real ? ap.err * REAL_APERTURE_NOISE_FACTOR : ap.errTotal);

/** Every number of the error model in one place, so that provenance.js can write it into each result (a result says which model its errors came from). */
export const ERROR_MODEL = {
  positionNoiseCoeff: POSITION_NOISE_COEFF, defaultPsfSigmaPx: DEFAULT_PSF_SIGMA_PX, systematicSigmaPx: SYSTEMATIC_SIGMA_PX,
  maskedFitSigmaPx: MASKED_FIT_SIGMA_PX, realApertureNoiseFactor: REAL_APERTURE_NOISE_FACTOR,
};

/**
 * Measure a candidate at its predicted position in every image, whether or not a dot was found there.
 * arrays: the images (n x n, one per frame); positions: [{ x, y }] per frame (pixels of that image).
 * A real mover is there in most images (it can be faint at some wavelengths); a chance line is there only where it
 * picked up its dots. An image supports the candidate when the S/N there is at least minSnr AND at least `relative` of the
 * candidate's best S/N (noise alone reaches S/N of 3-12 here and there, and a chance line that caught one bright star somewhere
 * else would otherwise look supported). Real data (7 Nov 2026): the 4 real candidates are supported in 100 % of their images
 * (S/N 134-3490); the 3 false candidates of Epsilon Indi B in D6 in 2-3 of 6.
 * Returns { snr: [per frame or null], supported, measurable, fraction }.
 */
export function trackSupport(arrays, n, positions, { radius = 2, minSnr = 5, relative = 0.1 } = {}) {
  const snr = positions.map((p, k) => {
    const m = arrays[k] ? apertureSnr(arrays[k], n, p.x, p.y, radius) : null;
    return m ? m.snr : null;
  });
  const measured = snr.filter((s) => s !== null);
  const best = measured.length ? Math.max(...measured) : 0;
  const limit = Math.max(minSnr, relative * best);
  const supported = measured.filter((s) => s >= limit).length;
  return { snr, supported, measurable: measured.length, fraction: measured.length ? supported / measured.length : 0 };
}

/**
 * Is another source close enough to a candidate's path to add its light to the measurement? For each image: the distance (px)
 * from the predicted position to the nearest detected dot that is NOT the candidate itself (farther than minPx, the candidate's
 * own dot sits within about 0.8 px of it). A dot within maxPx (2.5 px = 15") lies inside or just outside the 2-pixel aperture.
 * Real case (7 Nov 2026): around WISE 0855 a J = 15.4 star 7.5" away put 0.64 mJy into the 1-2 um measurement of a brown
 * dwarf that has almost no flux there, and the colour hint read it as "neutral".
 * sourcesPerFrame: [[{ x, y }]] per image (the dots of every image); positions: [{ x, y }] per image.
 * Returns { distances: [px or null], blended: number of images with a neighbour in range, nearestPx }.
 */
export function blendWarning(positions, sourcesPerFrame, { minPx = 0.8, maxPx = 2.5 } = {}) {
  const distances = positions.map((p, k) => {
    let best = null;
    for (const s of sourcesPerFrame[k] ?? []) {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d > minPx && (best === null || d < best)) best = d;
    }
    return best;
  });
  const near = distances.filter((d) => d !== null && d <= maxPx);
  return { distances, blended: near.length, nearestPx: near.length ? Math.min(...near) : null };
}

// ------------------------------------------------------------------ 3) describing a candidate

/** Where is the candidate (pixels) on a given date? */
export function moverPositionAtMjd(c, mjd) {
  const years = (mjd - c.mjdRef) / 365.25;
  return { x: c.x + c.vx * years, y: c.y + c.vy * years };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/**
 * Sky position and motion of a candidate.
 * geo = { ra, dec, n, scaleArcsec }: the cutout the pixels belong to (north up, east LEFT).
 */
export function describeMover(c, geo) {
  const east = -c.vx * geo.scaleArcsec;        // image right = west, so east is -x
  const north = -c.vy * geo.scaleArcsec;       // image down = south, so north is -y
  const pa = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  const sky = canvasToSky(c.x / geo.n, c.y / geo.n, geo);
  return {
    ra: sky.ra, dec: sky.dec,
    speedArcsecPerYear: Math.hypot(east, north),
    pmEastArcsecPerYear: east, pmNorthArcsecPerYear: north,
    positionAngleDeg: pa,
    compass: COMPASS[Math.round(pa / 45) % 8],
  };
}

/**
 * A catalogue test object that sits where the candidate is, on the candidate's reference date
 * (SIMBAD position + proper motion). Returns { target, distPx } or null.
 */
export function matchKnownObject(c, geo, targets, { maxDistPx = 3 } = {}) {
  const year = mjdToYear(c.mjdRef);
  let best = null;
  for (const target of targets) {
    if (target.type && target.type !== "mover") continue;      // test objects have a type; catalogue objects have none
    const p = positionAtEpoch(target, year);
    const { fx, fy } = skyToCanvas(p.ra, p.dec, geo);
    const distPx = Math.hypot(fx * geo.n - c.x, fy * geo.n - c.y);
    if (distPx <= maxDistPx && (!best || distPx < best.distPx)) best = { target, distPx };
  }
  return best;
}
