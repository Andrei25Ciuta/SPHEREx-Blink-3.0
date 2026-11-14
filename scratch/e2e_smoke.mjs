// e2e_smoke.mjs – a smoke test of the whole page in a real browser: Chrome or Edge, headless, driven over the DevTools Protocol with Node only
// (no Playwright, no npm). It serves frontend/ itself, loads the SYNTHETIC demo (no backend, no real data, no network), and walks the main path:
// the demo loads, Find movers and the Planet X search run (in a worker), a candidate opens in the inspector, the Planet X Lab compares motions,
// the explainer answers, the Solar System draws, the results page loads. It fails on any console error, any uncaught exception, and any request
// to a host other than this server (the web-font requests are answered with an empty file here: the page must not need them).
//
//   node scratch/e2e_smoke.mjs                  (needs Node 22+ for the built-in WebSocket, and Chrome or Edge; CHROME_PATH names a browser to use)
//   node scratch/e2e_smoke.mjs --keep           (leave the browser window open at the end – it is not headless then)
//
// It is NOT part of the scratch/test_*.mjs set (those need no browser and run on Node 20). If no browser is found it says SKIP and exits with 0 only
// with --allow-skip; otherwise it exits with 2, so that a CI job cannot go green without having run.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend");
const KEEP = process.argv.includes("--keep"), ALLOW_SKIP = process.argv.includes("--allow-skip");
const ALLOWED_EXTERNAL = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);   // the page asks for its web fonts; they are optional (the page has fallbacks)

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

import { MIME, startServer as startStaticServer, findBrowser, Cdp, launch as launchBrowser, sleep } from "./lib_cdp.mjs";
const startServer = () => startStaticServer(ROOT);
const launch = (browserPath, userDir) => launchBrowser(browserPath, userDir, { keep: KEEP });

async function main() {
  if (typeof WebSocket === "undefined") { console.log("SKIP  this Node has no built-in WebSocket (Node 22 or newer is needed)"); process.exitCode = ALLOW_SKIP ? 0 : 2; return true; }
  const browserPath = findBrowser();
  if (!browserPath) { console.log("SKIP  no Chrome or Edge found (set CHROME_PATH)"); process.exitCode = ALLOW_SKIP ? 0 : 2; return true; }

  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const userDir = await mkdtemp(path.join(tmpdir(), "spherex-e2e-"));
  let child = null;
  const errors = [], external = new Set(), workers = new Set();
  try {
    const launched = await launch(browserPath, userDir);
    child = launched.child;
    const ws = new WebSocket(launched.wsUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", () => reject(new Error("cannot connect to the browser"))); });
    const cdp = new Cdp(ws);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);

    // what the page does wrong
    cdp.on("Runtime.exceptionThrown", (p) => errors.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`));
    cdp.on("Runtime.consoleAPICalled", (p) => { if (p.type === "error") errors.push(`console.error: ${p.args.map((a) => a.value ?? a.description ?? "").join(" ")}`); });
    cdp.on("Log.entryAdded", (p) => { if (p.entry.level === "error") errors.push(`log: ${p.entry.text} ${p.entry.url ?? ""}`); });
    cdp.on("Network.loadingFailed", (p) => errors.push(`request failed: ${p.errorText} ${p.requestId}`));
    // every request that leaves this server is answered with an empty file, and counted
    cdp.on("Fetch.requestPaused", async (p) => {
      const host = new URL(p.request.url).hostname;
      if (host === "127.0.0.1") { await cdp.send("Fetch.continueRequest", { requestId: p.requestId }, sessionId); return; }
      external.add(host);
      await cdp.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: p.resourceType === "Stylesheet" ? "text/css" : "text/plain" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: "" }, sessionId);
    });
    // workers started by the page (the long searches run in one)
    cdp.on("Target.attachedToTarget", (p) => { if (p.targetInfo.type === "worker") workers.add(p.targetInfo.url.replace(base, "")); });

    await page("Page.enable"); await page("Runtime.enable"); await page("Log.enable"); await page("Network.enable");
    await page("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await page("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await page("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expression) => {
      const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`in the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    const waitFor = async (expression, label, timeoutMs = 90000) => {
      const t0 = Date.now();
      for (;;) {
        let v = null;
        try { v = await evaluate(expression); } catch { v = null; }
        if (v) return v;
        if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for: ${label}`);
        await sleep(150);
      }
    };
    const click = (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`);
    const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
    // how long did the page stop drawing? A requestAnimationFrame loop notes the longest time between two frames (reported, not a pass/fail threshold: it depends on the machine)
    const startGapProbe = () => evaluate(`(() => { const g = (window.__gap = { max: 0, last: performance.now(), stop: false }); const tick = () => { const now = performance.now(); g.max = Math.max(g.max, now - g.last); g.last = now; if (!g.stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`);
    const stopGapProbe = () => evaluate(`(() => { window.__gap.stop = true; return Math.round(window.__gap.max); })()`);
    const step = async (name, fn) => {
      try { const detail = await fn(); check(name, true, detail ?? ""); }
      catch (err) { check(name, false, err.message); }
    };

    // ------------------------------------------------------------ the page loads, and says its data are synthetic
    await page("Page.navigate", { url: `${base}/index.html?theme=observatory` });
    await step("the page loads and its badge says the data are synthetic (not observations)", async () => {
      await waitFor(`document.readyState === "complete" && document.getElementById("data-source-badge")?.textContent.length > 0`, "page and badge");
      const badge = await text("#data-source-badge");
      if (!/synthetic/i.test(badge)) throw new Error(`badge says "${badge}"`);
      return badge;
    });

    // ------------------------------------------------------------ the simulated Planet X field, then the two searches
    await step("the simulated Planet X field loads and the search buttons are enabled", async () => {
      if (!(await click("#planetx-demo-btn"))) throw new Error("no Planet X demo button");
      await waitFor(`!document.getElementById("find-movers-btn").disabled && !document.getElementById("find-distant-btn").disabled`, "search buttons enabled");
      return await text("#movers-status");
    });
    await step("Find movers finishes (in a worker) with an answer, not an error", async () => {
      workers.clear();
      await startGapProbe();
      await click("#find-movers-btn");
      await waitFor(`!/^Searching/.test(document.getElementById("movers-status").textContent) && !document.getElementById("find-movers-btn").disabled`, "movers search");
      const gap = await stopGapProbe();
      const status = await text("#movers-status");
      if (/failed|cannot/i.test(status)) throw new Error(status);
      const ranIn = await evaluate(`document.getElementById("movers").dataset.lastSearch`);       // the page says where the search really ran: a worker that failed to load would say "page"
      if (ranIn !== "movers:worker") throw new Error(`the search ran as "${ranIn}", not in a worker (workers created: ${[...workers].join(", ") || "none"}; longest gap between two frames: ${gap} ms)`);
      return `longest gap between two frames while it ran: ${gap} ms. ${status.slice(0, 80)}`;
    });
    await step("a saved picture says in the picture itself that the data are synthetic", async () => {
      // catch the download instead of saving it, then look at the pixels of the strip at the bottom
      await evaluate(`window.__saved = null; HTMLAnchorElement.prototype.__click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__saved = { name: this.download, href: this.href }; } else this.__click(); }; true`);
      try {
        await click("#save-png-btn");
        await waitFor(`window.__saved !== null`, "the saved picture");
        const r = await evaluate(`(async () => {
          const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = window.__saved.href; });
          const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
          const h = Math.round(img.height * 0.12), d = x.getImageData(0, img.height - h, img.width, h).data; let amber = 0, dark = 0;
          for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] > 140 && d[i + 1] < 210 && d[i + 2] < 120) amber++; if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) dark++; }
          return { name: window.__saved.name, amber, dark, pixels: d.length / 4 };
        })()`);
        if (r.amber < 40) throw new Error(`no amber SYNTHETIC caption in the saved picture (${r.amber} amber pixels in the bottom strip of ${r.name})`);
        const after = await evaluate(`(() => { const c = document.querySelector("canvas"); return c ? c.width : 0; })()`);
        return `${r.amber} amber caption pixels in the bottom strip of ${r.name}; canvas width ${after}`;
      } finally { await evaluate(`HTMLAnchorElement.prototype.click = HTMLAnchorElement.prototype.__click; true`); }
    });
    await step("a search can be cancelled while it runs: the button appears, the status says it was cancelled, no candidate is kept", async () => {
      // make the worker slow on purpose (it only starts 3 s after the message), so there is time to press Cancel
      await evaluate(`window.__Worker = window.Worker; window.Worker = class extends window.__Worker { postMessage(m) { setTimeout(() => super.postMessage(m), 3000); } }; true`);
      try {
        await click("#find-movers-btn");
        await waitFor(`!document.getElementById("cancel-search-btn").hidden`, "the Cancel button");
        const during = await text("#movers-status");
        if (!/cancel/i.test(during)) throw new Error(`the status does not mention cancelling: ${during}`);
        await click("#cancel-search-btn");
        await waitFor(`/cancelled/.test(document.getElementById("movers-status").textContent) && !document.getElementById("find-movers-btn").disabled`, "the cancelled status");
        const after = await text("#movers-status");
        const hidden = await evaluate(`document.getElementById("cancel-search-btn").hidden`);
        const listed = await evaluate(`document.getElementById("mover-list").children.length`);
        if (!hidden || listed !== 0) throw new Error(`after cancelling: button hidden ${hidden}, candidates listed ${listed}`);
        return after.slice(0, 90);
      } finally { await evaluate(`window.Worker = window.__Worker; true`); }
    });
    await step("the Planet X search finds the simulated body at about 600 AU (500–700), and says what it is", async () => {
      workers.clear();
      await startGapProbe();
      await click("#find-distant-btn");
      await waitFor(`!/^Searching/.test(document.getElementById("movers-status").textContent) && !document.getElementById("find-distant-btn").disabled`, "distant search");
      const gap = await stopGapProbe();
      const status = await text("#movers-status");
      const first = await text("#mover-list .mover-item .mover-main");
      if (!first) throw new Error(`no candidate: ${status}`);
      const au = Number(/about (\d+) AU away/.exec(first)?.[1]);
      if (!(au >= 500 && au <= 700)) throw new Error(`distance ${au} AU is outside 500–700: ${first}`);
      const ranIn = await evaluate(`document.getElementById("movers").dataset.lastSearch`);
      if (ranIn !== "distant:worker") throw new Error(`the search ran as "${ranIn}", not in a worker (longest gap between two frames: ${gap} ms)`);
      return `longest gap between two frames while it ran: ${gap} ms. ${first}`;
    });

    // ------------------------------------------------------------ the inspector, the lab, the explainer
    await step("a candidate opens its detail, and on a wide screen the detail is in the inspector", async () => {
      await click('#mover-list .mover-item[data-index="0"]');
      await waitFor(`document.getElementById("mover-detail") && !document.getElementById("mover-detail").hidden`, "candidate detail");
      const inInspector = await evaluate(`document.getElementById("inspector").contains(document.getElementById("mover-detail"))`);
      if (!inInspector) throw new Error("#mover-detail is not inside #inspector at 1400 px");
      return (await text("#mover-detail-text")).slice(0, 100);
    });
    await step("Planet X Lab: the motions of the selected candidate are compared", async () => {
      await waitFor(`!document.getElementById("lab-compare-btn").disabled`, "compare button enabled");
      await click("#lab-compare-btn");
      await waitFor(`document.getElementById("lab-models-out").textContent.trim().length > 20`, "comparison text");
      return (await text("#lab-models-out")).trim().replace(/\s+/g, " ").slice(0, 100);
    });
    await step("the injection test refuses to run on synthetic pixels and says why (nothing is invented)", async () => {
      const disabled = await evaluate(`document.getElementById("lab-run-btn").disabled`);
      const status = await text("#lab-status");
      if (!disabled && !/real|float|8-bit|Nothing was run/i.test(status)) throw new Error(`the lab accepted synthetic pixels: ${status}`);
      return disabled ? "the run button is disabled" : status.slice(0, 100);
    });
    await step("the explainer answers about the candidate, and its own check passed", async () => {
      await waitFor(`!document.querySelector('#assistant [data-kind="why"]').disabled`, "explainer enabled");
      await click('#assistant [data-kind="why"]');
      await waitFor(`document.querySelectorAll("#assistant-out li").length >= 1`, "explainer sentences");
      const status = await text("#assistant-status");
      if (/Not shown|defect/i.test(status)) throw new Error(status);
      return `${await evaluate(`document.querySelectorAll("#assistant-out li").length`)} sentences`;
    });
    await step("the text analysis (tables, no picture) is built, lists the dots and the candidate, and its first line says the data are synthetic", async () => {
      await click("#ta-build-btn");
      await waitFor(`!document.getElementById("ta-out").hidden`, "text analysis tables");
      const info = await evaluate(`({ status: document.getElementById("ta-status").textContent, first: document.querySelector("#ta-prov li")?.textContent ?? "", dots: document.querySelectorAll("#ta-sources tbody tr").length, cands: document.querySelectorAll("#ta-cands tbody tr").length,
        captions: ["ta-frames", "ta-sources", "ta-cands"].every((id) => document.querySelector("#" + id + " caption")), focused: document.activeElement?.id, canvases: document.querySelectorAll("#text-analysis canvas").length })`);
      if (!/^Data: SYNTHETIC/.test(info.first)) throw new Error(`the first line says: ${info.first}`);
      if (!info.dots || !info.cands || !info.captions || info.focused !== "ta-prov-title" || info.canvases) throw new Error(JSON.stringify(info));
      return info.status;
    });
    await step("the reproducibility bundle is saved: it says the data are SYNTHETIC, and gives a replay link without any backend address", async () => {
      await evaluate(`window.__bundle = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then((t) => { window.__bundle = t; }); return orig(b); };`);
      await click("#bundle-btn");
      await waitFor(`window.__bundle`, "the bundle file", 20000);
      const info = await evaluate(`(() => { const b = JSON.parse(window.__bundle); return { kind: b.data.kind, label: b.data.label, images: b.images.length, hashes: b.images.every((i) => /^[0-9a-f]{64}$/.test(i.sha256)), link: b.replay.link, command: b.replay.command, search: b.searches.length, status: document.getElementById("bundle-status").textContent, err: document.getElementById("bundle-error").textContent }; })()`);
      if (info.err) throw new Error(info.err);
      if (info.kind !== "synthetic" || !/SYNTHETIC/.test(info.label)) throw new Error(`the bundle says ${info.kind}: ${info.label}`);
      if (!info.images || !info.hashes) throw new Error("the images have no hash");
      if (/[?&](data|api)=/.test(info.link) || info.command !== null) throw new Error(`replay: ${info.link} ${info.command}`);
      return `${info.images} hashed images, ${info.search} search record`;
    });
    await step("the survey search of IRSA has no backend here: its button is disabled and the page says why (no dead button, nothing invented)", async () => {
      const state = await evaluate(`({ disabled: document.getElementById("survey-btn").disabled, status: document.getElementById("survey-status").textContent, hidden: document.getElementById("survey-result").hidden })`);
      if (!state.disabled || !state.hidden) throw new Error(`the button is ${state.disabled ? "disabled" : "enabled"} and the result is ${state.hidden ? "hidden" : "shown"}`);
      if (!/Needs the backend/.test(state.status) || !/CORS/.test(state.status)) throw new Error(`the status does not explain it: ${state.status.slice(0, 120)}`);
      return state.status.slice(0, 60);
    });

    // ------------------------------------------------------------ the results page
    await page("Page.navigate", { url: `${base}/results.html` });
    await step("the results page loads its numbers (none left empty) and lists sections 1 to 12", async () => {
      await waitFor(`document.getElementById("results-status") && document.getElementById("results-status").hidden`, "results loaded");
      const info = await evaluate(`({ sections: [...document.querySelectorAll('h2[id^="r"]')].filter((h) => /^r[0-9]+$/.test(h.id)).length, empty: [...document.querySelectorAll("[data-n]")].filter((e) => !e.textContent.trim()).length, total: document.querySelectorAll("[data-n]").length })`);
      if (info.sections !== 12) throw new Error(`${info.sections} sections instead of 12`);
      if (info.empty) throw new Error(`${info.empty} of ${info.total} numbers are empty`);
      return `${info.total} numbers`;
    });

    // ------------------------------------------------------------ what must not have happened
    await sleep(300);
    check("no console error, no uncaught exception, no failed request", errors.length === 0, errors.slice(0, 3).join(" | "));
    const outside = [...external].filter((h) => !ALLOWED_EXTERNAL.has(h));
    check("the synthetic demo asked no host but this server (and the optional web fonts)", outside.length === 0, outside.length ? outside.join(", ") : `fonts only: ${[...external].join(", ") || "none"}`);

    if (KEEP) { console.log("--keep: the browser stays open; press Ctrl+C here to end"); await new Promise(() => {}); }
    ws.close();
  } catch (err) {
    check("the test itself ran to the end", false, err.message);
  } finally {
    if (child && !KEEP) { child.kill(); await sleep(300); }
    server.close();
    await rm(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
  return false;
}

const skipped = await main();
if (!skipped) {
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exitCode = failed ? 1 : 0;
}
process.exit(process.exitCode ?? 0);
