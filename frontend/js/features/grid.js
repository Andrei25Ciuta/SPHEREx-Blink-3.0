// grid.js – the coordinate grid of the viewer: which lines of constant RA and Dec are on screen, where, and what to write on them.
// Pure (no DOM), tested with Node (scratch/test_grid.mjs). It uses the SAME flat-sky mapping as everything else (geometry.js: north up,
// east left, RA lines vertical, Dec lines horizontal), so a line sits exactly where canvasToSky says that RA or Dec is.
//
// The lines are laid on "round" values: RA in seconds of time (0.05 s ... 1 h), Dec in arcseconds (0.5″ ... 1°). The step is the
// smallest round one that keeps neighbouring lines at least `minPx` canvas pixels apart, so the grid gets finer as you zoom in.

import { skyToCanvas } from "../geometry.js";
import { fracToCanvas, canvasToFrac } from "./view.js";

const RA_STEPS_SEC = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];     // seconds of time
const DEC_STEPS_ARCSEC = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];                   // arcseconds
const MAX_LINES = 24;                                                                                       // per direction, whatever happens
const DAY_SEC = 86400;

const pad = (n, w = 2) => String(n).padStart(w, "0");
const decimalsFor = (step) => (step < 0.1 ? 2 : step < 1 ? 1 : 0);

/** RA in seconds of time -> "17h57m45s" (wrapped into one day), with as many parts as the step needs. */
export function raLabel(tSec, stepSec) {
  const d = decimalsFor(stepSec), unit = 10 ** d;
  const wrapped = ((Math.round(tSec * unit) / unit) % DAY_SEC + DAY_SEC) % DAY_SEC;
  const whole = Math.floor(wrapped + 1e-9), frac = wrapped - whole;
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = (whole % 60) + frac;
  if (stepSec >= 3600) return `${pad(h)}h`;
  if (stepSec >= 60) return `${pad(h)}h${pad(m)}m`;
  return `${pad(h)}h${pad(m)}m${d ? pad(s.toFixed(d), 3 + d) : pad(Math.round(s))}s`;
}

/** Dec in arcseconds -> "+04°46′00″", with as many parts as the step needs. */
export function decLabel(arcsec, stepArcsec) {
  const d = decimalsFor(stepArcsec), unit = 10 ** d;
  const r = Math.round(Math.abs(arcsec) * unit) / unit;
  const sign = arcsec < 0 && r > 0 ? "−" : "+";
  const whole = Math.floor(r + 1e-9), frac = r - whole;
  const deg = Math.floor(whole / 3600), min = Math.floor((whole % 3600) / 60), sec = (whole % 60) + frac;
  if (stepArcsec >= 3600) return `${sign}${pad(deg)}°`;
  if (stepArcsec >= 60) return `${sign}${pad(deg)}°${pad(min)}′`;
  return `${sign}${pad(deg)}°${pad(min)}′${d ? pad(sec.toFixed(d), 3 + d) : pad(Math.round(sec))}″`;
}

const raStepText = (s) => (s >= 3600 ? `${s / 3600} h` : s >= 60 ? `${s / 60} min` : `${s} s`);
const decStepText = (a) => (a >= 3600 ? `${a / 3600}°` : a >= 60 ? `${a / 60}′` : `${a}″`);

/**
 * The grid for a view. geo = { ra, dec, n, scaleArcsec }; W, H = canvas size; minRaPx / minDecPx = least distance between neighbouring lines.
 * -> { raLines: [{ x, label, deg }], decLines: [{ y, label, deg }], raStep: "5 s", decStep: "1′" }
 * deg = the RA (in [0, 360)) or Dec of the line, in degrees. Lines outside the canvas are left out. Near a pole there are no RA lines.
 */
export function gridLines(view, geo, W, H, { minRaPx = 96, minDecPx = 64 } = {}) {
  const cosDec = Math.cos((geo.dec * Math.PI) / 180);
  const arcsecPerPx = (geo.scaleArcsec * geo.n) / (W * view.zoom);              // canvas pixel -> arcsec on the sky
  const out = { raLines: [], decLines: [], raStep: "", decStep: "" };
  if (!(arcsecPerPx > 0)) return out;

  // the visible window as offsets from the centre of the field, in arcsec (east and north positive)
  const tl = canvasToFrac(view, 0, 0, W, H), br = canvasToFrac(view, W, H, W, H);
  const eastHi = -(tl.fx * geo.n - geo.n / 2) * geo.scaleArcsec, eastLo = -(br.fx * geo.n - geo.n / 2) * geo.scaleArcsec;
  const northHi = -(tl.fy * geo.n - geo.n / 2) * geo.scaleArcsec, northLo = -(br.fy * geo.n - geo.n / 2) * geo.scaleArcsec;

  // Dec lines: horizontal
  const decStep = DEC_STEPS_ARCSEC.find((s) => s / arcsecPerPx >= minDecPx) ?? DEC_STEPS_ARCSEC.at(-1);
  const decCentre = geo.dec * 3600;
  for (let k = Math.ceil((decCentre + northLo) / decStep), guard = 0; k * decStep <= decCentre + northHi && guard < MAX_LINES; k++, guard++) {
    const arcsec = k * decStep;
    if (Math.abs(arcsec) > 324000) continue;                                    // beyond the pole
    const f = skyToCanvas(geo.ra, arcsec / 3600, geo);
    const y = fracToCanvas(view, f.fx, f.fy, W, H).y;
    if (y >= 0 && y <= H) out.decLines.push({ y, label: decLabel(arcsec, decStep), deg: arcsec / 3600 });
  }
  out.decStep = decStepText(decStep);

  // RA lines: vertical (not near a pole, where they crowd together)
  if (cosDec > 0.02) {
    const arcsecPerSec = 15 * cosDec;                                           // arcsec on the sky per second of RA time
    const raStep = RA_STEPS_SEC.find((s) => (s * arcsecPerSec) / arcsecPerPx >= minRaPx) ?? RA_STEPS_SEC.at(-1);
    const raCentre = (geo.ra / 15) * 3600;                                      // seconds of time
    const tLo = raCentre + eastLo / arcsecPerSec, tHi = raCentre + eastHi / arcsecPerSec;
    for (let k = Math.ceil(tLo / raStep), guard = 0; k * raStep <= tHi && guard < MAX_LINES; k++, guard++) {
      const t = k * raStep;
      const raDeg = (t / 3600) * 15;
      const f = skyToCanvas(raDeg, geo.dec, geo);
      const x = fracToCanvas(view, f.fx, f.fy, W, H).x;
      if (x >= 0 && x <= W) out.raLines.push({ x, label: raLabel(t, raStep), deg: ((raDeg % 360) + 360) % 360 });
    }
    out.raStep = raStepText(raStep);
  }
  return out;
}
