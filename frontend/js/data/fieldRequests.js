const TERMINAL = new Set(["ready", "failed", "unavailable"]);

export function fieldRequestComplete(status) {
  const detectors = Object.values(status?.detectors ?? {});
  return detectors.length > 0 && detectors.every((item) => TERMINAL.has(item.status));
}

/** Poll server-authored progress. The timer controls request cadence only; it never invents progress. */
export async function followFieldRequest({ requestId, getStatus, onStatus, signal,
  initialDelayMs = 3000, maxDelayMs = 15000, sleep = defaultSleep }) {
  let delay = initialDelayMs;
  let lastStatus = null;
  while (!signal?.aborted) {
    try {
      lastStatus = await getStatus(requestId, { signal });
      await onStatus?.(lastStatus);
      delay = initialDelayMs;
      if (fieldRequestComplete(lastStatus)) return lastStatus;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
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
