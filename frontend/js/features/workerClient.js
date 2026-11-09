// workerClient.js – run a search task in a worker, or on the page if no worker can be had (pure: the worker is injected, so Node tests it).
//
//   const { result, inWorker } = await runTask("distant", payload, { makeWorker, fallback });
//
// makeWorker() -> a Worker (or anything with postMessage / terminate / onmessage / onerror), or throws; fallback() -> the same result computed here (searchTasks.js runSearchTask).
// The worker gets a COPY of the data (structured clone): the page keeps its own pixels. It is used once and terminated. If the worker cannot start, or stops with an error before it
// answered, the task is run here instead, and the answer says so (inWorker: false): a worker is a convenience, never a reason for a search to fail or to give another answer.

export function runTask(kind, payload, { makeWorker, fallback }) {
  return new Promise((resolve, reject) => {
    let worker = null;
    try { worker = makeWorker(); } catch { worker = null; }
    const inline = () => { try { resolve({ result: fallback(), inWorker: false }); } catch (err) { reject(err); } };
    if (!worker) { inline(); return; }
    let done = false;
    const finish = () => { done = true; try { worker.terminate(); } catch { /* already gone */ } };
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
