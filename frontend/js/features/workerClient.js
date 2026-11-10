// workerClient.js – run a search task in a worker, or on the page if no worker can be had (pure: the worker is injected, so Node tests it).
//
//   const { result, inWorker } = await runTask("distant", payload, { makeWorker, fallback });
//
// makeWorker() -> a Worker (or anything with postMessage / terminate / onmessage / onerror), or throws; fallback() -> the same result computed here (searchTasks.js runSearchTask).
// The worker gets a COPY of the data (structured clone): the page keeps its own pixels. It is used once and terminated. If the worker cannot start, or stops with an error before it
// answered, the task is run here instead, and the answer says so (inWorker: false): a worker is a convenience, never a reason for a search to fail or to give another answer.

// Cancelling: pass `signal` (an AbortSignal). While a worker runs the task, aborting terminates it and the promise rejects with an Error named "AbortError" (isCancelled(err));
// nothing of the unfinished search is kept. A task that runs on the page (no worker could be had) is one synchronous call and CANNOT be stopped: onStart({ cancellable })
// tells the caller which case it is, before the work begins, so the page never offers a button that does nothing.
export const isCancelled = (err) => err?.name === "AbortError";

export function runTask(kind, payload, { makeWorker, fallback, signal = null, onStart = null }) {
  return new Promise((resolve, reject) => {
    const cancelledError = () => Object.assign(new Error("the search was cancelled"), { name: "AbortError" });
    if (signal?.aborted) { reject(cancelledError()); return; }
    let worker = null;
    try { worker = makeWorker(); } catch { worker = null; }
    const inline = () => { try { onStart?.({ cancellable: false }); resolve({ result: fallback(), inWorker: false }); } catch (err) { reject(err); } };
    if (!worker) { inline(); return; }
    let done = false;
    const finish = () => { done = true; signal?.removeEventListener("abort", onAbort); try { worker.terminate(); } catch { /* already gone */ } };
    function onAbort() { if (done) return; finish(); reject(cancelledError()); }
    signal?.addEventListener("abort", onAbort);
    onStart?.({ cancellable: true });
    worker.onmessage = (event) => {
      if (done) return;
      finish();
      const m = event.data;
      if (m?.ok) resolve({ result: m.result, inWorker: true }); else reject(new Error(m?.message ?? "the search failed"));
    };
    worker.onerror = () => { if (done) return; finish(); inline(); };            // the worker could not run (a blocked script, an old browser): do it here
    try { worker.postMessage({ kind, payload }); } catch { if (!done) { finish(); inline(); } }
  });
}
