// Leave one image out, fit a mover from the other detections, then measure at the predicted spot.
// This is a consistency check, not an independent discovery test: it reuses the candidate's detected dots.
import { apertureSnr, passIndices } from "./movers.js";

export const VERSION = "blind-check-1";
const MIN_TRAINING_PASSES = 3;
const MIN_SNR = 5;

function fit(points) {
  const t0 = points.reduce((s, p) => s + p.time, 0) / points.length;
  const x0 = points.reduce((s, p) => s + p.x, 0) / points.length;
  const y0 = points.reduce((s, p) => s + p.y, 0) / points.length;
  let sxx = 0, sxt = 0, syt = 0;
  for (const p of points) {
    const dt = p.time - t0;
    sxx += dt * dt;
    sxt += dt * (p.x - x0);
    syt += dt * (p.y - y0);
  }
  if (!(sxx > 1e-9)) return null;
  const vx = sxt / sxx, vy = syt / sxx;
  return { x0, y0, vx, vy, t0 };
}

/**
 * For every image containing a candidate dot, hide that image, fit a line to the remaining dots,
 * and measure aperture S/N at the predicted position in the hidden image.
 * Candidate points are in registered coordinates; shifts map them back to image pixels.
 */
export function blindCheckCandidate(candidate, frames, arrays, n, { minSnr = MIN_SNR } = {}) {
  const ids = candidate.frameIds ?? frames.map((f) => f.id);
  const frameIndicesById = new Map();
  frames.forEach((frame, i) => {
    if (!frameIndicesById.has(frame.id)) frameIndicesById.set(frame.id, []);
    frameIndicesById.get(frame.id).push(i);
  });
  const seenIds = new Map();
  const localToGlobal = ids.map((id) => {
    const occurrence = seenIds.get(id) ?? 0;
    seenIds.set(id, occurrence + 1);
    return frameIndicesById.get(id)?.[occurrence] ?? -1;
  });
  const points = (candidate.points ?? []).map((p) => {
    const fi = localToGlobal[p.frame];
    return fi === undefined || fi < 0 ? null : { fi, localFrame: p.frame, x: p.x, y: p.y, mjd: frames[fi].mjd };
  }).filter(Boolean);
  const passByFrame = passIndices(frames.map((f) => f.mjd));
  const distinctPasses = (list) => new Set(list.map((p) => passByFrame[p.fi])).size;
  const checks = [];
  for (const held of points) {
    // Duplicate detector/time IDs can represent the same exposure held twice by the backend.
    // Exclude the whole ID group from the fit, while still measuring each returned image separately.
    const heldId = ids[held.localFrame];
    const training = points.filter((p) => ids[p.localFrame] !== heldId);
    if (training.length < 3 || distinctPasses(training) < MIN_TRAINING_PASSES) continue;
    const origin = training[0].mjd;
    const timed = training.map((p) => ({ ...p, time: (p.mjd - origin) / 365.25 }));
    const line = fit(timed);
    if (!line || !arrays[held.fi]) continue;
    const time = (held.mjd - origin) / 365.25;
    const shift = candidate.shifts?.[held.localFrame] ?? { dx: 0, dy: 0 };
    const x = line.x0 + line.vx * (time - line.t0) + (shift.dx ?? 0);
    const y = line.y0 + line.vy * (time - line.t0) + (shift.dy ?? 0);
    const measurement = apertureSnr(arrays[held.fi], n, x, y);
    checks.push({ frame: held.fi, mjd: held.mjd, snr: measurement?.snr ?? null, supported: Boolean(measurement && measurement.snr >= minSnr), trainingDetections: training.length });
  }
  const measurable = checks.filter((x) => x.snr !== null);
  return {
    images: checks,
    checked: measurable.length,
    supported: measurable.filter((x) => x.supported).length,
    fraction: measurable.length ? measurable.filter((x) => x.supported).length / measurable.length : 0,
    reason: measurable.length ? null : "needs at least 4 detections across 4 survey passes",
  };
}
