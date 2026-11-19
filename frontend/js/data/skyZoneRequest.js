// The Workspace attaches to a public request only through a verified status GET.
// I/O and Workspace callbacks are injected so the lifecycle can be tested offline.
import { isPublicFieldRequestId } from "../urlState.js?v=3";
import { fieldRequestComplete, followFieldRequest } from "./fieldRequests.js?v=2";

const REQUEST_STATES = new Set(["queued", "discovering", "running", "partial", "ready", "failed", "unavailable"]);
const DETECTOR_STATES = new Set(["queued", "discovering", "planning", "downloading", "processing", "publishing", "ready", "failed", "unavailable"]);
const DETECTORS = ["D1", "D2", "D3", "D4", "D5", "D6"];

class InvalidStatus extends Error {}

function checkStatus(status, requestId, query) {
  if (!status || !isPublicFieldRequestId(status.requestId) || !status.query) {
    throw new InvalidStatus("The data service returned an invalid zone status.");
  }
  // The backend returns numbers. No coercion, tolerance, or rounding here: an
  // exact prepared centre/size must match the independently validated target.
  if (status.requestId !== requestId || status.query.ra !== query.ra ||
      status.query.dec !== query.dec || status.query.fov !== query.fov) {
    throw new InvalidStatus("The saved request does not match this zone.");
  }
  if (!REQUEST_STATES.has(status.status) || !status.detectors ||
      Object.keys(status.detectors).length !== DETECTORS.length ||
      !DETECTORS.every(detector => DETECTOR_STATES.has(status.detectors[detector]?.status))) {
    throw new InvalidStatus("The data service returned invalid detector status.");
  }
  return status;
}

const canReconnect = (error) => !(error instanceof InvalidStatus || error instanceof SyntaxError) &&
  (error?.status == null || error.status === 408 || error.status === 429 || error.status >= 500);

export function createSkyZoneRequestFlow({
  requestField, getStatus, retryField, writeUrl, reset, checking, attached, update, complete, failed,
  accepted, unsupported, retryStarted, retryFailed, retrySettled, sleep,
}) {
  let current = null;
  const isCurrent = (scope) => scope === current && !scope.signal.aborted;

  function cancel() {
    current?.controller.abort();
    current = null;
  }

  function begin(query, origin) {
    cancel();
    const controller = new AbortController();
    const token = reset(query);
    return current = {
      query, token, controller, signal: controller.signal, origin, requestId: null,
      ackPending: origin !== "restore", notifyOnAttach: origin === "zone", retryable: false, retrying: false,
    };
  }

  function fail(scope, message) {
    if (!isCurrent(scope)) return;
    cancel();
    failed(message, scope);
  }

  async function attach(scope) {
    const { requestId, query, signal } = scope;
    const verifiedGet = async (id, options) => {
      const status = await getStatus(id, options);
      signal.throwIfAborted();
      return checkStatus(status, requestId, query);
    };
    try {
      let status = await verifiedGet(requestId, { signal });
      if (!isCurrent(scope)) return;
      attached(scope);
      if (!isCurrent(scope)) return;
      if (scope.notifyOnAttach) {
        scope.notifyOnAttach = false;
        if (!["failed", "unavailable"].includes(status.status)) accepted?.(scope);
      }
      await update(status, scope);
      if (!isCurrent(scope)) return;
      if (!fieldRequestComplete(status)) {
        status = await followFieldRequest({
          requestId, getStatus: verifiedGet, signal, initialStatus: status, shouldRetry: canReconnect, sleep,
          onStatus: (next) => isCurrent(scope) ? update(next, scope) : undefined,
        });
      }
      if (!isCurrent(scope)) return;
      scope.retryable = Object.values(status.detectors).some(detector => detector.status === "failed");
      complete(status);
    } catch (error) {
      if (!isCurrent(scope)) return;
      const reason = error?.status === 404 ? "The saved SPHEREx request was not found."
        : error instanceof InvalidStatus ? error.message
        : "Could not verify the SPHEREx request status.";
      fail(scope, reason);
    }
  }

  return {
    cancel,
    async submit(query, { origin = "zone", dateFrom = null, dateTo = null } = {}) {
      if (current?.ackPending && current.origin === origin) return;
      const scope = begin(query, origin);
      writeUrl({ ...query, dateFrom, dateTo, request_id: null });
      try {
        const result = await requestField({ ...query, dateFrom, dateTo }, { signal: scope.signal });
        if (!isCurrent(scope)) return;
        scope.ackPending = false;
        if (result === null) {
          if (unsupported) {
            cancel(); // This explicit load had no acknowledged ID.
            unsupported(query, { dateFrom, dateTo }, origin);
            return;
          }
          throw new Error("Zone requests are unavailable from this data service.");
        }
        if (!isPublicFieldRequestId(result?.requestId)) {
          throw new Error("The data service did not acknowledge the zone request with a valid ID.");
        }
        scope.requestId = result.requestId;
        writeUrl({ request_id: scope.requestId });
        checking(scope);
        // Release the explicit-submit button after acknowledgment, not after
        // the status GET, detector preparation or playback.
        void attach(scope);
      } catch (error) {
        fail(scope, `Could not confirm the SPHEREx zone request: ${error?.message || "the service did not respond."}`);
      }
    },
    restore(target) {
      if (!target) return;
      const scope = begin(target.query, "restore");
      scope.requestId = target.requestId;
      checking(scope);
      return attach(scope);
    },
    async retry() {
      const scope = current;
      if (!scope?.retryable || scope.retrying) return;
      scope.retrying = true;
      retryStarted();
      try {
        await retryField(scope.requestId, { signal: scope.signal });
        if (!isCurrent(scope)) return;
        scope.retryable = false;
        await attach(scope); // The retry response is not a status document.
      } catch (error) {
        if (isCurrent(scope)) retryFailed(`Could not retry failed detectors: ${error?.message || "the service did not respond."}`);
      } finally {
        if (isCurrent(scope)) {
          scope.retrying = false;
          retrySettled();
        }
      }
    },
  };
}
