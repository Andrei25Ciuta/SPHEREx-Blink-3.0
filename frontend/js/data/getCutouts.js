// getCutouts.js – THE stable interface between the UI and any data source.
//
//   getCutouts({ ra, dec, fovArcmin, detector }) -> Promise<Frame[]>
//
//   Frame = {
//     mjd: number,               // observation time, Modified Julian Date
//     dateISO: string,           // same time as ISO 8601 text (UTC)
//     detector: string,          // e.g. "D2"
//     wavelengthMinUm: number,   // micrometers
//     wavelengthMaxUm: number,
//     imageUrl: string,          // data: URL (mock) or http URL to a PNG (real)
//     flags: { anyFlagged: boolean, fractionFlagged: number } | null,
//     // OPTIONAL (added for stretch features; old sources without them still work):
//     flagsUrl?: string | null,  // transparent PNG, flagged pixels coloured, same size as image
//     dataUrl?: string | null,   // the same pixels as REAL numbers: raw little-endian float32, n*n values, north up,
//                                //   background-subtracted, NaN = no data (backend only; used by Find movers)
//     pixelScaleArcsec?: number, // arcsec per image pixel (else derived from the FOV)
//   }
//
//   getPhotometry({ centerRa, centerDec, fovArcmin, ra, dec, detector, radiusPx, motion }) -> Promise<Point[]>
//   Point = { mjd, dateISO, detector, wavelengthUm, wavelengthMinUm, wavelengthMaxUm,
//             flux: number|null, fluxErr: number|null, flagged: boolean,
//             fluxJy?: number|null, fluxJyErr?: number|null,
//             errorModel?: "resampled_sky_scatter" } // Jy only when the file is in MJy/sr;
//   the backend error uses sky scatter after interpolation, without covariance or calibration terms.
//   flux = background-subtracted aperture sum at (ra, dec), in IMAGE units (not calibrated).
//   (centerRa/centerDec/fovArcmin = the current cutout query; only the mock needs them.)
//   motion (optional) = { epochMjd, pmEast, pmNorth }: measure a MOVING object. It is at (ra, dec) on
//   epochMjd and moves pmEast / pmNorth arcsec per year, so every frame is measured where it is on ITS date.
//
// detector = "all" returns every frame; the UI then groups them per detector.
// The UI ONLY talks to this file, so swapping mock <-> real never touches the UI.

import { DATA_SOURCE } from "../config.js";
import { getCutoutsMock, getPhotometryMock } from "./mockSource.js";
import { getCutoutsApi, getPhotometryApi } from "./apiSource.js";

export async function getCutouts(query) {
  const source = DATA_SOURCE === "api" ? getCutoutsApi : getCutoutsMock;
  const frames = await source(query);

  if (!Array.isArray(frames)) throw new Error("Data source did not return a list of frames.");
  frames.forEach(validateFrame);

  // Always return frames in time order – the blink player relies on this.
  return [...frames].sort((a, b) => a.mjd - b.mjd);
}

/** Aperture photometry at one sky position on every frame (spectrum / light curve). */
export async function getPhotometry(query) {
  const source = DATA_SOURCE === "api" ? getPhotometryApi : getPhotometryMock;
  const points = await source(query);
  if (!Array.isArray(points)) throw new Error("Data source did not return a list of points.");
  return [...points].sort((a, b) => a.mjd - b.mjd);
}

/**
 * Check that a frame respects the contract. If the real backend ever sends
 * something different, we get ONE clear error here instead of weird UI bugs.
 */
function validateFrame(f, i) {
  const problems = [];
  if (!Number.isFinite(f.mjd)) problems.push("mjd");
  if (typeof f.dateISO !== "string") problems.push("dateISO");
  if (typeof f.detector !== "string" || !f.detector) problems.push("detector");
  if (!Number.isFinite(f.wavelengthMinUm)) problems.push("wavelengthMinUm");
  if (!Number.isFinite(f.wavelengthMaxUm)) problems.push("wavelengthMaxUm");
  if (typeof f.imageUrl !== "string" || !f.imageUrl) problems.push("imageUrl");
  if (f.flags !== null && typeof f.flags !== "object") problems.push("flags");
  if (f.flagsUrl != null && typeof f.flagsUrl !== "string") problems.push("flagsUrl");
  if (f.pixelScaleArcsec != null && !(f.pixelScaleArcsec > 0)) problems.push("pixelScaleArcsec");
  if (problems.length) throw new Error(`Frame #${i} has invalid fields: ${problems.join(", ")}`);
}

/**
 * Summarise which detectors exist in a list of frames.
 * Returns [{ detector, count, wlMin, wlMax }] sorted D1, D2, ... (natural order).
 */
export function listDetectors(frames) {
  const byDet = new Map();
  for (const f of frames) {
    const d = byDet.get(f.detector) || { detector: f.detector, count: 0, wlMin: Infinity, wlMax: -Infinity };
    d.count += 1;
    d.wlMin = Math.min(d.wlMin, f.wavelengthMinUm);
    d.wlMax = Math.max(d.wlMax, f.wavelengthMaxUm);
    byDet.set(f.detector, d);
  }
  return [...byDet.values()].sort((a, b) =>
    a.detector.localeCompare(b.detector, undefined, { numeric: true }));
}
