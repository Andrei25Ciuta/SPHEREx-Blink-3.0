// searchTasks.js – the searches that can keep the page busy for seconds, as plain tasks (pure: no DOM, no network).
//
// The same function runs in a worker (js/searchWorker.js) and, when a worker cannot be had, on the page itself (workerClient.js falls back to it), so the answer is the same either way:
// a task is "kind + data in, result out" and nothing else.
//
//   "distant"  findDistantMovers (Planet X mode):  { detected: [{ mjd, sources }], geo, options? }
//   "movers"   findMoversAcrossDetectors:           { frames: [{ mjd, detector, id, grey, mask }], n, options? }

import { findMoversAcrossDetectors } from "./movers.js";
import { findDistantMovers } from "./parallax.js";

export const TASK_KINDS = ["distant", "movers"];

export function runSearchTask(kind, payload) {
  if (kind === "distant") return findDistantMovers(payload.detected, payload.geo, payload.options ?? {});
  if (kind === "movers") return findMoversAcrossDetectors(payload.frames, payload.n, payload.options ?? {});
  throw new Error(`unknown search: ${kind}`);
}
