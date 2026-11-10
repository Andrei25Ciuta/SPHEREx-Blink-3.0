// uncertainty.js – where the error of a candidate's motion comes from, and what could make it larger (pure: no DOM, no network).
//
// movers.js reports ONE number for the error of a velocity (vErrPx). That number is a sum of three parts, added in quadrature (per axis, 1 sigma):
//   statistical   what the signal-to-noise of the dots alone allows (the position model of movers.js centroidSigmaPx, propagated through the line fit)
//   excess scatter what is added when the dots scatter around the line MORE than their own errors say (real noise is not white; never negative: a lucky small scatter is not believed)
//   systematic    the floor that real fixed stars need (SYSTEMATIC_SIGMA_PX, measured: VALIDATION 15), propagated through the same lever arm
// "nominal" is the statistical part alone (what a naive reading of the S/N would say); "calibrated" is the quadrature sum, the number the app reports and tests against repeated injections.
// Not included, and said so: the pointing/WCS of each real file (only checked on stars, VALIDATION 15.5), the PSF shape, confusion with a neighbour of the same brightness.

import { coreIsCompromised } from "./movers.js";

export const EDGE_MARGIN_PX = 3;
export const FEW_DOTS = 4;                  // a line through fewer dots has one degree of freedom or none to check its own scatter
export const FEW_PASSES = 3;                // fewer distinct survey passes than this: a short baseline
export const SCATTER_WARNING = 1.5;         // the dots scatter this many times more than their errors say
export const NEAR_THRESHOLD = 1.5;          // significance below threshold x this: one more unlucky dot could remove it

/** The parts of the error of one velocity component, in px/yr and (with scaleArcsec) in arcsec/yr. Null when the candidate lacks the fields (an older result). */
export function velocityBudget(c, scaleArcsec = null) {
  if (!c || !Number.isFinite(c.vModelPx) || !Number.isFinite(c.vErrPx) || !Number.isFinite(c.inflation) || !(c.sxx > 1e-12)) return null;
  const stat = c.vModelPx;
  const excess = stat * Math.sqrt(Math.max(0, c.inflation * c.inflation - 1));
  const syst = (c.systematicPx ?? 0) / Math.sqrt(c.sxx);
  const total = Math.sqrt(stat * stat + excess * excess + syst * syst);
  const k = Number.isFinite(scaleArcsec) ? scaleArcsec : null;
  const part = (name, label, v) => ({ name, label, px: v, arcsec: k === null ? null : v * k, share: total > 0 ? (v * v) / (total * total) : 0 });
  return {
    parts: [
      part("statistical", "statistical (S/N of the dots)", stat),
      part("scatter", "excess scatter (dots scatter more than their errors say)", excess),
      part("systematic", "systematic floor (measured on real stars)", syst),
    ],
    nominalPx: stat, calibratedPx: total, reportedPx: c.vErrPx,
    nominalArcsec: k === null ? null : stat * k, calibratedArcsec: k === null ? null : total * k,
    ratio: stat > 0 ? total / stat : null,                      // how much larger the calibrated error is than the nominal one
    consistent: Math.abs(total - c.vErrPx) <= 1e-6 * Math.max(1, c.vErrPx),
  };
}

/**
 * What could make this candidate less reliable than its numbers say. Each warning is a short sentence; an empty list means none of these checks fired, NOT that the candidate is real.
 *   perFrame : [{ image, mask }] in the order of the frames the search used (optional; needed for the flagged-pixel check)
 *   n        : side of the cutout in pixels (for the edge and flagged checks)
 *   passOf   : survey pass number of each frame (optional; passIndices of movers.js)
 *   minSignificance : the search threshold
 */
export function candidateWarnings(c, { perFrame = null, n = null, minSignificance = 6, passOf = null } = {}) {
  const w = [];
  if (!c) return w;
  if (c.nDet < FEW_DOTS) w.push(`only ${c.nDet} detections: the scatter of the dots about the line cannot be checked with so few`);
  if (Number.isFinite(c.nFrames) && c.nDet < c.nFrames) { const k = c.nFrames - c.nDet; w.push(`found in ${c.nDet} of ${c.nFrames} images: ${k} image${k === 1 ? "" : "s"} without a dot (faint, masked, or the path leaves the field)`); }
  if (Number.isFinite(c.inflation) && c.inflation > SCATTER_WARNING) w.push(`the dots scatter ${c.inflation.toFixed(1)} times more than their errors say: the error is enlarged by that factor, but the line may not be a single object`);
  if (Number.isFinite(c.significance) && c.significance < minSignificance * NEAR_THRESHOLD) w.push(`significance ${c.significance.toFixed(1)}σ is close to the threshold (${minSignificance}σ)`);
  if (Number.isFinite(c.falseAlarm) && c.falseAlarm > 0.01) w.push(`${c.falseAlarm.toPrecision(2)} chance lines like this one expected in this field`);
  if (passOf && Array.isArray(c.points)) {
    const passes = new Set(c.points.map((p) => passOf[p.frame]).filter((v) => v !== undefined));
    if (passes.size < FEW_PASSES) w.push(`seen in ${passes.size} survey pass${passes.size === 1 ? "" : "es"}: a short baseline`);
  }
  if (Array.isArray(c.points) && n) {
    const edge = c.points.filter((p) => p.x < EDGE_MARGIN_PX || p.y < EDGE_MARGIN_PX || p.x > n - EDGE_MARGIN_PX || p.y > n - EDGE_MARGIN_PX).length;
    if (edge) w.push(`${edge} detection${edge === 1 ? " is" : "s are"} within ${EDGE_MARGIN_PX} px of the edge of the cutout`);
  }
  if (Array.isArray(c.points) && n && perFrame) {
    const bad = c.points.filter((p) => { const f = perFrame[p.frame]; return f && f.image && f.mask && coreIsCompromised(f.image, f.mask, n, Math.floor(p.x), Math.floor(p.y)); }).length;
    if (bad) w.push(`${bad} detection${bad === 1 ? " sits" : "s sit"} on flagged pixels (saturated or bad): the position was fitted on the good pixels only`);
  }
  return w;
}

/** One sentence for a screen reader and for the exports. */
export function budgetSentence(b, unit = "px/yr") {
  if (!b) return "No uncertainty budget: this result was made before the budget existed.";
  const fmt = (v) => (v >= 0.1 ? v.toFixed(2) : v.toPrecision(2));
  const a = unit === "″/yr";
  const val = (p) => fmt(a ? p.arcsec : p.px);
  const [stat, scatter, syst] = b.parts;
  const nominal = a ? b.nominalArcsec : b.nominalPx, calibrated = a ? b.calibratedArcsec : b.calibratedPx;
  return `Velocity error per axis ${fmt(calibrated)} ${unit} (calibrated), against ${fmt(nominal)} ${unit} if only the S/N of the dots counted: `
    + `statistical ${val(stat)}, excess scatter ${val(scatter)}, systematic ${val(syst)} ${unit}, added in quadrature.`;
}
