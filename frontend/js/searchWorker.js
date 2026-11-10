// searchWorker.js – runs one search task (features/searchTasks.js) in a module worker, so that the page stays usable while a search works.
// Messages in:  { kind, payload }.   Messages out: { ok: true, result } or { ok: false, message }.   No DOM and no network here.

import { runSearchTask } from "./features/searchTasks.js";

self.onmessage = (event) => {
  try {
    const { kind, payload } = event.data;
    self.postMessage({ ok: true, result: runSearchTask(kind, payload) });
  } catch (err) {
    self.postMessage({ ok: false, message: String(err?.message ?? err) });
  }
};
