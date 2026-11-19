// apiSource.js – talks to OUR backend (backend/app.py, built in step 7).
// The endpoint /api/cutouts is defined by us, so it is not an external/guessed URL.
// The backend must return JSON: { frames: Frame[] } (see getCutouts.js for Frame).

import { API_BASE, CAN_USE_BACKEND, BACKEND_ERROR } from "../config.js?v=1";

const REQUEST_TIMEOUT_MS = 60_000;
const fieldSignal = (signal, ms) => signal
  ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

export async function getCutoutsApi({ ra, dec, fovArcmin, detector, requestId, signal }) {
  const params = new URLSearchParams({ ra, dec, fov: fovArcmin, det: detector });
  if (requestId) params.set("request_id", requestId);
  let body;
  try { body = await getJson(`${API_BASE}/api/cutouts?${params}`, signal); }
  catch (error) {
    if (requestId && error.status === 422) return []; // The request exists; no detector has published yet.
    throw error;
  }
  if (!body || !Array.isArray(body.frames)) {
    throw new Error("The data server response has no \"frames\" list.");
  }
  return body.frames;
}

/** Start/reuse an on-demand cloud acquisition; null means this is a legacy local API. */
export async function requestFieldApi({ ra, dec, fov, dateFrom = null, dateTo = null }, { signal } = {}) {
  assertBackendAvailable();
  const response = await fetch(`${API_BASE}/api/field-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ra, dec, fov, dateFrom, dateTo,
      detectors: ["D1", "D2", "D3", "D4", "D5", "D6"], collection: "spherex_dr1" }),
    signal: fieldSignal(signal, 20_000),
  });
  if (response.status === 404 || response.status === 405) return null;
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function getFieldRequestApi(requestId, { signal } = {}) {
  assertBackendAvailable();
  const response = await fetch(`${API_BASE}/api/field-requests/${encodeURIComponent(requestId)}`, {
    signal: fieldSignal(signal, 20_000),
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function retryFieldRequestApi(requestId, { signal } = {}) {
  assertBackendAvailable();
  const response = await fetch(`${API_BASE}/api/field-requests/${encodeURIComponent(requestId)}/retry`, {
    method: "POST", signal: fieldSignal(signal, 20_000),
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
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
async function getJson(url, signal) {
  assertBackendAvailable();
  let response;
  try {
    // Real cutouts can be slow (archive query + FITS download), but never wait forever.
    response = await fetch(url, { signal: fieldSignal(signal, REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err.name === "TimeoutError") {
      throw new Error(`The data server took longer than ${REQUEST_TIMEOUT_MS / 1000} s to answer. Try a smaller field of view or retry.`);
    }
    // fetch only throws on network problems (server down, CORS blocked, offline).
    throw new Error(`Cannot reach the data server at ${API_BASE}. Is the backend running?`);
  }
  if (!response.ok) {
    // Try to show the backend's own error message if it sent one.
    throw await responseError(response);
  }
  try { return await response.json(); }
  catch { throw new Error("The data server sent a response that is not valid JSON."); }
}

function assertBackendAvailable() {
  if (BACKEND_ERROR) throw new Error(BACKEND_ERROR);
  if (!CAN_USE_BACKEND) {
    throw new Error("This public demo cannot reach your local backend. Serve the workspace with the backend to use FITS data, or open Settings and choose Synthetic demo.");
  }
}

async function responseError(response) {
  let detail = "";
  try {
    const d = (await response.json()).detail;
    detail = Array.isArray(d) ? d.map((e) => `${e.loc?.at(-1) ?? ""}: ${e.msg}`).join("; ") : (d || "");
  } catch { /* response may not be JSON */ }
  const error = new Error(`Data server error ${response.status}${detail ? `: ${detail}` : ""}`);
  error.status = response.status;
  return error;
}
