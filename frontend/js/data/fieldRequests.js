const TERMINAL = new Set(["ready", "failed", "unavailable"]);

export function fieldRequestComplete(status) {
  const detectors = Object.values(status?.detectors ?? {});
  return detectors.length > 0 && detectors.every((item) => TERMINAL.has(item.status));
}

/** Read only this request's cutouts and ignore both stale results and stale errors. */
export async function loadFieldRequestCutouts({ requestId, query, signal, isCurrent, getCutouts, applyFrames }) {
  if (!requestId || !isCurrent()) return null;
  let frames;
  try {
    frames = await getCutouts({ ra: query.ra, dec: query.dec, fovArcmin: query.fov, detector: "all", requestId, signal });
    if (!isCurrent()) return null;
    if (frames.length) await applyFrames(frames);
  } catch (error) {
    return isCurrent() ? { error, stage: frames ? "playback" : "cutouts" } : null;
  }
  return isCurrent() ? { frames } : null;
}

/** Poll server-authored progress. The timer controls request cadence only; it never invents progress. */
export async function followFieldRequest({ requestId, getStatus, onStatus, signal,
  initialStatus = null, initialDelayMs = 3000, maxDelayMs = 15000, sleep = defaultSleep, shouldRetry = () => true }) {
  let delay = initialDelayMs;
  let lastStatus = initialStatus;
  while (!signal?.aborted) {
    try {
      lastStatus = await getStatus(requestId, { signal });
      signal?.throwIfAborted();
      await onStatus?.(lastStatus);
      signal?.throwIfAborted();
      delay = initialDelayMs;
      if (fieldRequestComplete(lastStatus)) return lastStatus;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError" || !shouldRetry(error)) throw error;
      delay = Math.min(maxDelayMs, Math.ceil(delay * 1.7));
      await onStatus?.({ ...lastStatus, pollError: error });
    }
    await sleep(delay, signal);
  }
  throw new DOMException("Field request polling was cancelled.", "AbortError");
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
