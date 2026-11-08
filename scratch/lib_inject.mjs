// Injected point sources for the accuracy tests (test_astrometry.mjs): a pixel-integrated Gaussian PSF on white noise, and the Cramer-Rao limit
// of a position measured from it. Pure helpers, no files.
//
// The PSF of SPHEREx is smaller than a pixel (FWHM 5.15" in D2 against 6.14"/px, i.e. sigma 0.356 px), so a star is NOT a smooth bump sampled at the pixel
// centres: each pixel holds the INTEGRAL of the PSF over it. That is what renderStar draws, with the error function.

import { mulberry32 } from "./lib_real.mjs";
export { mulberry32 };

/** The error function (Abramowitz & Stegun 7.1.26, absolute error below 1.5e-7). */
export function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}

/** The part of a 1-D Gaussian (centre x0, width sigma) that falls in pixel i, that is in [i, i + 1). */
export const pixelCell = (i, x0, sigma) => 0.5 * (erf((i + 1 - x0) / (sigma * Math.SQRT2)) - erf((i - x0) / (sigma * Math.SQRT2)));

/** A standard normal number from a uniform generator (Box-Muller). */
export function gaussianNoise(rng) {
  const u = Math.max(1e-12, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * An n x n image (Float32Array) with a star of total flux `flux` (in units of the pixel noise) at (x0, y0) (edge coordinates: the centre of pixel 0 is 0.5),
 * PSF sigma `sigma` px, on white noise of standard deviation `noise` (0 = no noise). `extra` = more stars [{ x, y, flux }] drawn the same way.
 */
export function renderStar(n, x0, y0, flux, sigma, rng, { noise = 1, extra = [] } = {}) {
  const img = new Float32Array(n * n);
  for (const s of [{ x: x0, y: y0, flux }, ...extra]) {
    const px = new Float64Array(n), py = new Float64Array(n);
    for (let i = 0; i < n; i++) { px[i] = pixelCell(i, s.x, sigma); py[i] = pixelCell(i, s.y, sigma); }
    for (let j = 0; j < n; j++) { if (py[j] < 1e-9) continue; for (let i = 0; i < n; i++) img[j * n + i] += s.flux * px[i] * py[j]; }
  }
  if (noise > 0) for (let k = 0; k < img.length; k++) img[k] += noise * gaussianNoise(rng);
  return img;
}

/** The best possible error of x for this star (Cramer-Rao: flux and background known), px: 1 / sqrt(sum (d mu / dx)^2 / noise^2). */
export function crlbX(n, x0, y0, flux, sigma, noise = 1) {
  let info = 0;
  const h = 1e-4;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const mu = (xx) => flux * pixelCell(i, xx, sigma) * pixelCell(j, y0, sigma);
    const d = (mu(x0 + h) - mu(x0 - h)) / (2 * h);
    info += (d * d) / (noise * noise);
  }
  return 1 / Math.sqrt(info);
}

export const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
export const sd = (v) => { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1)); };
export const rms = (v) => Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
/** The share of the values with |z| < k, in percent. */
export const within = (z, k) => (z.filter((x) => Math.abs(x) < k).length / z.length) * 100;
