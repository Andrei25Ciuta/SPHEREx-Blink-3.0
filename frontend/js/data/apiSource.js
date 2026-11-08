// apiSource.js – talks to OUR backend (backend/app.py, built in step 7).
// The endpoint /api/cutouts is defined by us, so it is not an external/guessed URL.
// The backend must return JSON: { frames: Frame[] } (see getCutouts.js for Frame).

import { API_BASE, CAN_USE_LOCAL_BACKEND } from "../config.js";

const REQUEST_TIMEOUT_MS = 60_000;

export async function getCutoutsApi({ ra, dec, fovArcmin, detector }) {
  const params = new URLSearchParams({ ra, dec, fov: fovArcmin, det: detector });
  const body = await getJson(`${API_BASE}/api/cutouts?${params}`);
  if (!body || !Array.isArray(body.frames)) {
    throw new Error("The data server response has no \"frames\" list.");
  }
  return body.frames;
}

/**
 * motion (optional): follow a MOVING object. { epochMjd, pmEast, pmNorth }: it is at (ra, dec) on
 * epochMjd and moves pmEast / pmNorth arcsec per year; the backend measures at its place in every frame.
 */
export async function getPhotometryApi({ ra, dec, detector = "all", radiusPx, motion }) {
  const params = new URLSearchParams({ ra, dec, det: detector });
  if (radiusPx) params.set("radius", radiusPx);
  if (motion) {
    params.set("epoch_mjd", motion.epochMjd);
    params.set("pm_east", motion.pmEast);
    params.set("pm_north", motion.pmNorth);
  }
  const body = await getJson(`${API_BASE}/api/photometry?${params}`);
  if (!body || !Array.isArray(body.points)) {
    throw new Error("The data server response has no \"points\" list.");
  }
  return body.points;
}

/** GET a JSON document from our backend with a timeout and readable errors. */
async function getJson(url) {
  if (!CAN_USE_LOCAL_BACKEND) {
    throw new Error("This public demo cannot reach your local backend. Serve the workspace with the backend to use FITS data, or open Settings and choose Synthetic demo.");
  }
  let response;
  try {
    // Real cutouts can be slow (archive query + FITS download), but never wait forever.
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error(`The data server took longer than ${REQUEST_TIMEOUT_MS / 1000} s to answer. Try a smaller field of view or retry.`);
    }
    // fetch only throws on network problems (server down, CORS blocked, offline).
    throw new Error(`Cannot reach the data server at ${API_BASE}. Is the backend running?`);
  }
  if (!response.ok) {
    // Try to show the backend's own error message if it sent one.
    let detail = "";
    try {
      const d = (await response.json()).detail;
      // FastAPI validation errors (422) send a list of { loc, msg }; others send a string.
      detail = Array.isArray(d) ? d.map((e) => `${e.loc?.at(-1) ?? ""}: ${e.msg}`).join("; ") : (d || "");
    } catch { /* not JSON */ }
    throw new Error(`Data server error ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  try { return await response.json(); }
  catch { throw new Error("The data server sent a response that is not valid JSON."); }
}
