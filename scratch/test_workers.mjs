// Tests for running the long searches in a worker (features/searchTasks.js, workerClient.js, js/searchWorker.js, the wiring in main.js): the answer is the same in a worker and
// without one, and a worker that fails never makes a search fail.   Run: node scratch/test_workers.mjs
import { readFileSync, existsSync } from "node:fs";
import { runSearchTask, TASK_KINDS } from "../frontend/js/features/searchTasks.js";
import { runTask } from "../frontend/js/features/workerClient.js";
import { findMoversAcrossDetectors, detectSources } from "../frontend/js/features/movers.js";
import { findDistantMovers } from "../frontend/js/features/parallax.js";
import { digest } from "./benchmark.mjs";
import { mulberry32, renderStar } from "./lib_inject.mjs";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

// ---------------------------------------------------------------- the same answer, task or direct
const n = 49, rng = mulberry32(5);
const days = [0, 0.1, 0.2, 0.3, 0.4, 120, 120.1, 120.2, 120.3, 120.4, 250, 250.1, 250.2, 250.3, 250.4, 250.5, 397, 397.1], mjds = days.map((d) => 60908 + d), ref = (mjds[0] + mjds.at(-1)) / 2;
const fixed = Array.from({ length: 12 }, () => ({ x: 6 + rng() * 37, y: 6 + rng() * 37, flux: 60 + rng() * 300 }));
const frames = mjds.map((m, i) => { const yr = (m - ref) / 365.25; return { mjd: m, detector: "D2", id: `D2@${m}`, grey: renderStar(n, 0, 0, 0, 0.4, rng, { noise: 1, extra: [...fixed, { x: 20 + 1.7 * yr, y: 28 - 0.9 * yr, flux: 120 }] }), mask: null }; });
{
  const payload = { frames, n, options: { sigmaFloor: 1e-9, register: false } };
  const viaTask = runSearchTask("movers", payload), direct = findMoversAcrossDetectors(frames, n, payload.options);
  check("task: 'movers' gives exactly what findMoversAcrossDetectors gives (same digest), and finds the mover", digest(viaTask) === digest(direct) && viaTask.candidates.length >= 1);
  const detected = frames.map((f) => ({ mjd: f.mjd, sources: detectSources(f.grey, n, { sigmaFloor: 1e-9 }) }));
  const geo = { ra: 136.5, dec: 16.6, n, scaleArcsec: 6.14 };
  const viaD = runSearchTask("distant", { detected, geo }), directD = findDistantMovers(detected, geo, {});
  check("task: 'distant' gives exactly what findDistantMovers gives (same digest), including the 'reason' of a search that cannot run", digest(viaD) === digest(directD) && (viaD.reason === undefined || typeof viaD.reason === "string"));
  check("task: an unknown kind is an error, and the kinds are the two the page uses", (() => { try { runSearchTask("nope", {}); return false; } catch (e) { return /unknown search: nope/.test(e.message); } })() && TASK_KINDS.join() === "distant,movers");
  const clone = structuredClone(viaTask);
  check("a result survives the copy a worker makes of it (structured clone): the same digest, nothing lost (no function, no class)", digest(clone) === digest(viaTask) && clone.candidates.length === viaTask.candidates.length);
}

// ---------------------------------------------------------------- the client
class FakeWorker {
  constructor(behaviour) { this.behaviour = behaviour; this.terminated = 0; this.posted = []; }
  postMessage(m) { this.posted.push(m); this.behaviour(this, m); }
  terminate() { this.terminated++; }
}
{
  let ran = 0;
  const fallback = () => { ran++; return { candidates: ["inline"] }; };
  const ok = new FakeWorker((w, m) => setTimeout(() => w.onmessage({ data: { ok: true, result: { candidates: [m.kind] } } }), 1));
  const r1 = await runTask("distant", { a: 1 }, { makeWorker: () => ok, fallback });
  check("client: the answer of a worker is returned, marked as coming from a worker; the worker got the task and is terminated; the fallback was not used", r1.inWorker === true && r1.result.candidates[0] === "distant" && ok.posted[0].kind === "distant" && ok.posted[0].payload.a === 1 && ok.terminated === 1 && ran === 0);
  const r2 = await runTask("movers", {}, { makeWorker: () => { throw new Error("no Worker here"); }, fallback });
  check("client: with no worker (the constructor throws) the task runs here and says so", r2.inWorker === false && r2.result.candidates[0] === "inline" && ran === 1);
  const broken = new FakeWorker((w) => setTimeout(() => w.onerror({ message: "blocked" }), 1));
  const r3 = await runTask("movers", {}, { makeWorker: () => broken, fallback });
  check("client: a worker that fails to run (an error before it answered) is replaced by the same task run here: the search does not fail", r3.inWorker === false && ran === 2 && broken.terminated === 1);
  const refusing = new FakeWorker((w) => setTimeout(() => w.onmessage({ data: { ok: false, message: "unknown search: x" } }), 1));
  let err = null;
  try { await runTask("x", {}, { makeWorker: () => refusing, fallback }); } catch (e) { err = e; }
  check("client: an error the worker REPORTS (the search itself failed) is an error, not retried: the same search would fail here too", err && /unknown search: x/.test(err.message) && ran === 2 && refusing.terminated === 1);
  const throwing = new FakeWorker(() => { throw new Error("DataCloneError"); });
  const r4 = await runTask("movers", {}, { makeWorker: () => throwing, fallback });
  check("client: data that cannot be copied to a worker (postMessage throws) runs here", r4.inWorker === false && ran === 3 && throwing.terminated === 1);
  const twice = new FakeWorker((w) => setTimeout(() => { w.onmessage({ data: { ok: true, result: 1 } }); w.onmessage({ data: { ok: true, result: 2 } }); w.onerror({}); }, 1));
  const r5 = await runTask("movers", {}, { makeWorker: () => twice, fallback });
  check("client: a second message or an error after the answer is ignored", r5.result === 1 && ran === 3 && twice.terminated === 1);
  let bad = null;
  try { await runTask("movers", {}, { makeWorker: () => null, fallback: () => { throw new Error("the search failed here"); } }); } catch (e) { bad = e; }
  check("client: when the task itself fails here, the error reaches the caller", bad && /failed here/.test(bad.message));
}

// ---------------------------------------------------------------- the page
{
  const MAIN = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
  const WORKER = readFileSync(new URL("../frontend/js/searchWorker.js", import.meta.url), "utf8");
  check("page: the worker file exists, imports only the task module, answers { ok, result } or { ok: false, message }, and has no DOM or network", existsSync(new URL("../frontend/js/searchWorker.js", import.meta.url)) && /import \{ runSearchTask \} from "\.\/features\/searchTasks\.js"/.test(WORKER)
    && /ok: true, result/.test(WORKER) && /ok: false, message/.test(WORKER) && !/document\.|window\.|fetch\(/.test(WORKER.replace(/\/\/.*$/gm, "")));
  check("page: main.js records where the last search really ran (data-last-search = kind:worker|page), which the end-to-end test reads", /const \{ result, inWorker \} = await runTask/.test(MAIN) && /dataset\.lastSearch = `\$\{kind\}:\$\{inWorker \? "worker" : "page"\}`/.test(MAIN));
  check("page: main.js runs 'movers' and 'distant' through searchInWorker (a module worker, with the same task as the fallback), checks the load token after the wait, and no longer calls the two searches directly",
    /searchInWorker\("movers"/.test(MAIN) && /searchInWorker\("distant"/.test(MAIN) && /new Worker\(new URL\("\.\/searchWorker\.js", import\.meta\.url\), \{ type: "module" \}\)/.test(MAIN) && /fallback: \(\) => runSearchTask\(kind, payload\)/.test(MAIN)
    && !/findMoversAcrossDetectors\(|findDistantMovers\(/.test(MAIN) && (MAIN.match(/searchInWorker\("(movers|distant)"[\s\S]{0,400}?if \(token !== loadToken\) return;/g) || []).length === 2);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
