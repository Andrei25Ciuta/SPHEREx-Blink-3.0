// Tests for cancelling a long search and for the size estimate (features/workerClient.js, searchCost.js, the wiring in main.js and index.html).   Run: node scratch/test_cancel.mjs
import { readFileSync } from "node:fs";
import { runTask, isCancelled } from "../frontend/js/features/workerClient.js";
import { estimateSearch, describeEstimate, NS_PER_PIXEL, WARN_PIXELS } from "../frontend/js/features/searchCost.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
class FakeWorker {
  constructor(behaviour = () => {}) { this.behaviour = behaviour; this.terminated = 0; this.posted = []; }
  postMessage(m) { this.posted.push(m); this.behaviour(this, m); }
  terminate() { this.terminated++; }
}
const ctl = () => new AbortController();

// ---------------------------------------------------------------- cancelling
{
  let ran = 0;
  const fallback = () => { ran++; return "inline"; };
  const never = new FakeWorker();                                   // a worker that never answers (a long search)
  const c = ctl(), starts = [];
  const p = runTask("movers", {}, { makeWorker: () => never, fallback, signal: c.signal, onStart: (s) => starts.push(s) });
  setTimeout(() => c.abort(), 5);
  let err = null;
  try { await p; } catch (e) { err = e; }
  check("cancel: aborting while a worker runs terminates it and rejects with a cancellation", isCancelled(err) && never.terminated === 1 && ran === 0);
  check("cancel: the caller is told, before the work, that this search can be cancelled", starts.length === 1 && starts[0].cancellable === true);

  const answered = new FakeWorker((w) => setTimeout(() => w.onmessage({ data: { ok: true, result: "done" } }), 1));
  const c2 = ctl();
  const r = await runTask("movers", {}, { makeWorker: () => answered, fallback, signal: c2.signal });
  c2.abort();
  check("cancel: aborting AFTER the answer changes nothing (the result stands, the worker was terminated once)", r.result === "done" && answered.terminated === 1);

  const c3 = ctl(); c3.abort();
  let early = null, made = 0;
  try { await runTask("movers", {}, { makeWorker: () => { made++; return new FakeWorker(); }, fallback, signal: c3.signal }); } catch (e) { early = e; }
  check("cancel: a signal already aborted starts nothing", isCancelled(early) && made === 0 && ran === 0);

  const s2 = [], c4 = ctl();
  const r2 = await runTask("movers", {}, { makeWorker: () => { throw new Error("no Worker"); }, fallback, signal: c4.signal, onStart: (s) => s2.push(s) });
  check("cancel: with no worker the search runs on the page and the caller is told it CANNOT be cancelled (no button that does nothing)", r2.inWorker === false && s2.length === 1 && s2[0].cancellable === false && ran === 1);

  const never2 = new FakeWorker(), c5 = ctl();
  const p2 = runTask("movers", {}, { makeWorker: () => never2, fallback, signal: c5.signal });
  setTimeout(() => { c5.abort(); c5.abort(); }, 1);
  let e2 = null; try { await p2; } catch (e) { e2 = e; }
  check("cancel: aborting twice terminates the worker once", isCancelled(e2) && never2.terminated === 1);

  check("cancel: a failure is not mistaken for a cancellation", !isCancelled(new Error("boom")) && !isCancelled(null) && isCancelled(Object.assign(new Error("x"), { name: "AbortError" })));
}

// ---------------------------------------------------------------- the estimate
{
  const e = estimateSearch(15, 49);
  check("estimate: pixels = images x side x side", e.pixels === 15 * 49 * 49 && e.images === 15 && e.side === 49);
  check("estimate: the range is the measured ns per pixel, low below high", Math.abs(e.lowSeconds - (e.pixels * NS_PER_PIXEL.low) / 1e9) < 1e-12 && e.lowSeconds < e.highSeconds && !e.large);
  const big = estimateSearch(40, 600);
  check("estimate: a large search is marked large and the sentence warns that it can take much longer", big.pixels > WARN_PIXELS && big.large && /much longer/.test(describeEstimate(big)));
  const s = describeEstimate(e);
  check("estimate: the sentence gives the size, says the range is from the measuring computer, and offers Cancel", /15 images of 49 × 49/.test(s) && /may differ/.test(s) && /cancel/.test(s) && /under a second/.test(s), s);
  check("estimate: without a worker the sentence says it cannot be cancelled", /cannot be cancelled/.test(describeEstimate(e, { cancellable: false })));
  check("estimate: nonsense sizes do not give negative or NaN numbers", [estimateSearch(-3, 10), estimateSearch(0, 0), estimateSearch(5, -1)].every((x) => x.pixels === 0 && x.lowSeconds === 0));
}

// ---------------------------------------------------------------- the page
{
  const MAIN = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
  const HTML = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  check("page: a Cancel button exists once, hidden at the start", (HTML.match(/id="cancel-search-btn"/g) || []).length === 1 && /id="cancel-search-btn" hidden/.test(HTML));
  check("page: both searches pass the signal to the worker and end the timer in finally", (MAIN.match(/\}, run\);|geo: currentGeo\(\) \}, run\);/g) || []).length === 2 && (MAIN.match(/\} finally \{\s*endSearch\(\);/g) || []).length === 2);
  check("page: a cancelled search says so and that no candidate was kept", /isCancelled\(err\)/.test(MAIN) && /The search was cancelled\. No candidate was kept/.test(MAIN));
  check("page: the Cancel button is shown only when the search is cancellable", /hidden = !cancellable/.test(MAIN) && /cannot be cancelled/.test(MAIN));
}

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
