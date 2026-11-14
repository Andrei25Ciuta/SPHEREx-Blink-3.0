// a11y_audit.mjs – an automatic audit of keyboard and screen-reader behaviour of the page, in headless Chrome driven over the DevTools Protocol (Node only, no npm).
//
//   node scratch/a11y_audit.mjs [--theme light]   (Node 22+, Chrome or Edge; CHROME_PATH names one; --allow-skip exits 0 when there is no browser; --verbose lists every Tab stop)
//
// It loads the SYNTHETIC demo (no backend, no network), runs the searches, and then:
//   1. static: every control has a name, no positive tabindex, no broken ARIA reference, no duplicate id, every canvas that carries the picture has a role and a label, headings do not skip a level,
//      every button, link and select is at least 24 x 24 px (WCAG 2.2, 2.5.8) unless it is inline text;
//   2. REAL key presses: Tab through the whole page. Every stop has a name, a visible focus indicator, is in view, and nothing traps the focus; every control that can be reached by Tab was reached;
//   3. keys that operate things: the arrow keys on the radio groups, Space on a button, Enter on a candidate, Escape on a dialog and the focus coming back to the button that opened it;
//   4. announcements: the places a screen reader listens (aria-live, role=status, role=alert) say something when an image changes, when a search runs and when an input is wrong.
// What it cannot do: listen. It checks what a screen reader would be given (names, roles, live text, focus); it does not replace NVDA, JAWS or VoiceOver. Not part of the test_*.mjs set.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, findBrowser, Cdp, launch, sleep } from "./lib_cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend");
const ALLOW_SKIP = process.argv.includes("--allow-skip"), VERBOSE = process.argv.includes("--verbose");
const THEME = process.argv.includes("--theme") ? process.argv[process.argv.indexOf("--theme") + 1] : "observatory";       // deep-space | observatory | light | classic
let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const KEYS = { Tab: ["Tab", "Tab", 9], ArrowRight: ["ArrowRight", "ArrowRight", 39], ArrowLeft: ["ArrowLeft", "ArrowLeft", 37], ArrowDown: ["ArrowDown", "ArrowDown", 40], Escape: ["Escape", "Escape", 27],
  Space: [" ", "Space", 32, " "], Enter: ["Enter", "Enter", 13, "\r"] };

async function main() {
  if (typeof WebSocket === "undefined") { console.log("SKIP  this Node has no built-in WebSocket (Node 22 or newer is needed)"); process.exitCode = ALLOW_SKIP ? 0 : 2; return; }
  const browserPath = findBrowser();
  if (!browserPath) { console.log("SKIP  no Chrome or Edge found (set CHROME_PATH)"); process.exitCode = ALLOW_SKIP ? 0 : 2; return; }
  const { server, port } = await startServer(ROOT);
  const base = `http://127.0.0.1:${port}`, userDir = await mkdtemp(path.join(tmpdir(), "spherex-a11y-"));
  let child = null;
  try {
    const launched = await launch(browserPath, userDir);
    child = launched.child;
    const ws = new WebSocket(launched.wsUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", () => reject(new Error("cannot connect to the browser"))); });
    const cdp = new Cdp(ws);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = (m, p) => cdp.send(m, p, sessionId);
    cdp.on("Fetch.requestPaused", async (p) => {                                   // nothing leaves this machine: the web fonts get an empty answer
      if (new URL(p.request.url).hostname === "127.0.0.1") { await cdp.send("Fetch.continueRequest", { requestId: p.requestId }, sessionId); return; }
      await cdp.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: p.resourceType === "Stylesheet" ? "text/css" : "text/plain" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: "" }, sessionId);
    });
    await page("Page.enable"); await page("Runtime.enable"); await page("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await page("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    const evaluate = async (expression) => {
      const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`in the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    const waitFor = async (expression, label, timeoutMs = 90000) => {
      const t0 = Date.now();
      for (;;) { let v = null; try { v = await evaluate(expression); } catch { v = null; } if (v) return v; if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for: ${label}`); await sleep(150); }
    };
    const press = async (name, modifiers = 0) => {
      const [key, code, vk, text] = KEYS[name];
      await page("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await sleep(40);
    };
    const step = async (name, fn) => { try { const d = await fn(); check(name, true, d ?? ""); } catch (err) { check(name, false, err.message); } };

    // ------------------------------------------------------------ a page with images and candidates to look at
    await page("Page.navigate", { url: `${base}/index.html?theme=${THEME}` });
    await waitFor(`document.readyState === "complete" && document.getElementById("planetx-demo-btn")`, "page");
    await evaluate(`document.getElementById("planetx-demo-btn").click()`);
    await waitFor(`!document.getElementById("find-distant-btn").disabled`, "images loaded");
    await evaluate(`document.getElementById("find-distant-btn").click()`);
    await waitFor(`document.querySelector("#mover-list .mover-item")`, "a candidate");
    await sleep(400);

    // ------------------------------------------------------------ 1. static
    const staticAudit = await evaluate(`(() => {
      const vis = (e) => { const s = getComputedStyle(e); return s.visibility !== "hidden" && s.display !== "none" && !e.closest("[hidden]") && e.getBoundingClientRect().width > 0; };
      const name = (e) => { const lb = e.getAttribute("aria-labelledby"); if (lb) return lb.split(/\\s+/).map((i) => document.getElementById(i)?.textContent ?? "").join(" ").trim();
        return (e.getAttribute("aria-label") || e.labels?.[0]?.textContent || e.title || e.textContent || e.value || e.placeholder || "").replace(/\\s+/g, " ").trim(); };
      const o = { noName: [], posTab: [], dangling: [], dups: [], small: [], canvasBad: [], heading: [], imgNoAlt: 0, controls: 0 };
      for (const e of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]")) {
        if (!vis(e)) continue;
        o.controls++;
        if (!name(e)) o.noName.push(e.tagName + "#" + e.id + "." + e.className);
        if (e.tabIndex > 0) o.posTab.push(e.tagName + "#" + e.id);
        const r = e.getBoundingClientRect(), inline = e.tagName === "A" && e.closest("p, li, td, label, small, span") && getComputedStyle(e).display === "inline";
        if (!inline && !e.matches("input[type=range], input[type=radio], input[type=checkbox]") && (r.width < 24 || r.height < 24)) o.small.push(e.tagName + "#" + e.id + "." + String(e.className).slice(0, 24) + " " + Math.round(r.width) + "x" + Math.round(r.height));
      }
      for (const e of document.querySelectorAll("[aria-labelledby],[aria-describedby],[aria-controls]")) for (const a of ["aria-labelledby", "aria-describedby", "aria-controls"]) { const v = e.getAttribute(a); if (v) for (const id of v.split(/\\s+/)) if (!document.getElementById(id)) o.dangling.push(e.tagName + "#" + e.id + " " + a + "=" + id); }
      const ids = {}; for (const e of document.querySelectorAll("[id]")) ids[e.id] = (ids[e.id] || 0) + 1; o.dups = Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k);
      for (const c of document.querySelectorAll("canvas")) if (vis(c) && c.getAttribute("aria-hidden") !== "true" && !(c.getAttribute("role") === "img" && c.getAttribute("aria-label"))) o.canvasBad.push(c.id || "(no id)");
      let prev = 0; for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) { if (!vis(h)) continue; const l = Number(h.tagName[1]); if (prev && l > prev + 1) o.heading.push(h.tagName + " after H" + prev + ": " + h.textContent.trim().slice(0, 40)); prev = l; }
      o.h1 = [...document.querySelectorAll("h1")].filter(vis).length;
      o.imgNoAlt = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length;
      o.lang = document.documentElement.lang; o.title = document.title;
      return o;
    })()`);
    check("static: every visible control has an accessible name", staticAudit.noName.length === 0, `${staticAudit.controls} controls; ${staticAudit.noName.slice(0, 5).join(", ")}`);
    check("static: no positive tabindex, no broken aria-labelledby / describedby / controls, no duplicate id, every image has alt", staticAudit.posTab.length === 0 && staticAudit.dangling.length === 0 && staticAudit.dups.length === 0 && staticAudit.imgNoAlt === 0, JSON.stringify({ pos: staticAudit.posTab, dangling: staticAudit.dangling, dups: staticAudit.dups }));
    check("static: the canvas that carries the picture has role=img and a label (the others are hidden from a screen reader)", staticAudit.canvasBad.length === 0, staticAudit.canvasBad.join(", "));
    check("static: one h1, the headings do not skip a level, the page has a language and a title", staticAudit.h1 === 1 && staticAudit.heading.length === 0 && staticAudit.lang === "en" && staticAudit.title.length > 5, `h1=${staticAudit.h1}; ${staticAudit.heading.slice(0, 4).join(" | ")}`);
    check("static: every button, select and block link is at least 24 x 24 px (WCAG 2.2, 2.5.8)", staticAudit.small.length === 0, staticAudit.small.slice(0, 8).join(", "));

    // ------------------------------------------------------------ 2. Tab through the page, with real key presses
    await evaluate(`const p = document.getElementById("play-btn"); if (p.getAttribute("aria-label") === "Pause") p.click();`);        // the blink plays by itself: a roving focus stop would move during the walk
    await sleep(300);
    await evaluate(`window.scrollTo(0, 0); document.activeElement?.blur(); document.body.setAttribute("tabindex", "-1"); document.body.focus(); document.body.removeAttribute("tabindex");`);
    const describe = `(() => {
      window.__tidc = window.__tidc || 0; const tid = (e) => (e.__tid ||= e.tagName + "#" + e.id + "/" + (++window.__tidc));
      const e = document.activeElement; if (!e || e === document.body || e === document.documentElement) return null;
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      const shows = (s) => (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
      let ind = shows(cs);
      if (!ind && e.matches("input[type=radio], input[type=checkbox]") && e.nextElementSibling) ind = shows(getComputedStyle(e.nextElementSibling));
      const name = (e.getAttribute("aria-label") || (e.getAttribute("aria-labelledby") || "").split(/\\s+/).map((i) => document.getElementById(i)?.textContent ?? "").join(" ") || e.labels?.[0]?.textContent || e.title || e.textContent || e.value || "").replace(/\\s+/g, " ").trim();
      return { key: tid(e), what: (e.tagName.toLowerCase() + "#" + e.id + " " + name).slice(0, 60), where: Math.round(r.top) + "," + Math.round(r.left), name: name.slice(0, 50), ind, vis: r.width > 0 && r.height > 0, inView: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth };
    })()`;
    const stops = [], seen = new Set();
    let cycleAt = -1, sameCount = 0, last = null;
    for (let i = 0; i < 700; i++) {
      await press("Tab");
      await evaluate(`new Promise((r) => { let y = scrollY, n = 0; const f = () => { if (scrollY === y) { if (++n >= 3) return r(); } else { y = scrollY; n = 0; } requestAnimationFrame(f); }; f(); })`);       // the page scrolls smoothly: measure when it has stopped
      let d = await evaluate(describe);
      for (let w = 0; d && d.vis && !d.inView && w < 15; w++) { await sleep(100); d = await evaluate(describe); }          // a slow runner scrolls late: wait up to 1.5 s for the focused element to come into view
      if (!d) { sameCount++; if (sameCount > 3) break; continue; }
      if (d.key === last) { sameCount++; if (sameCount >= 3) { cycleAt = -2; break; } } else sameCount = 0;
      last = d.key;
      if (seen.has(d.key) && stops.length > 5) { cycleAt = i; break; }
      seen.add(d.key); stops.push(d);
    }
    const noInd = stops.filter((s) => !s.ind), invisible = stops.filter((s) => !s.vis), offscreen = stops.filter((s) => s.vis && !s.inView), unnamed = stops.filter((s) => !s.name);
    check("Tab: the key presses walked through the page and came back to the start (no keyboard trap)", stops.length > 40 && cycleAt !== -2, `${stops.length} stops, ${cycleAt >= 0 ? "cycle closed" : cycleAt === -2 ? "STUCK on " + last : "no cycle within 700 presses"}`);
    check("Tab: every stop has an accessible name", unnamed.length === 0, unnamed.slice(0, 5).map((s) => s.key).join(", "));
    check("Tab: every stop shows a focus indicator (an outline or a ring), in this theme", noInd.length === 0, `${noInd.length} without: ${noInd.slice(0, 6).map((s) => s.key).join(", ")}`);
    check("Tab: focus never lands on an invisible element, and the element in focus is scrolled into view", invisible.length === 0 && offscreen.length === 0, `invisible: ${invisible.slice(0, 4).map((s) => s.key).join(", ")}; off screen: ${offscreen.slice(0, 5).map((s) => s.what + " @" + s.where).join("; ")}`);
    const tabbable = await evaluate(`(() => { window.__tidc = window.__tidc || 0; const tid = (e) => (e.__tid ||= e.tagName + "#" + e.id + "/" + (++window.__tidc)); return [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, [tabindex]")].filter((e) => { const s = getComputedStyle(e); return !e.disabled && e.tabIndex >= 0 && s.visibility !== "hidden" && s.display !== "none" && !e.closest("[hidden], [inert]") && !(e.closest("details:not([open])") && !e.matches("summary")) && e.getBoundingClientRect().width > 0 && !(e.type === "radio" && !e.checked && document.querySelector('input[type=radio][name="' + e.name + '"]:checked')); }).map((e) => tid(e) + "|" + (e.tagName.toLowerCase() + "#" + e.id + " " + (e.getAttribute("aria-label") || e.textContent || e.value || "").replace(/\s+/g, " ").trim()).slice(0, 50)); })()`);
    const missed = tabbable.filter((t) => !seen.has(t.split("|")[0])).map((t) => t.split("|")[1]);
    check("Tab: every control that can take focus was reached by Tab", missed.length === 0, `${tabbable.length} tabbable, ${missed.length} missed: ${missed.slice(0, 6).join(", ")}`);
    if (VERBOSE) console.log(stops.map((s) => `${s.ind ? "ok " : "NO "} ${s.key}  ${s.name}`).join("\n"));

    // ------------------------------------------------------------ 3. keys that operate things
    await step("keys: the arrow keys change the view mode (a radio group), and Space presses a button (Play / Pause changes its name)", async () => {
      await evaluate(`document.querySelector('input[name="mode"][value="blink"]').focus()`);
      await press("ArrowRight");
      const mode = await evaluate(`document.querySelector('input[name="mode"]:checked').value`);
      if (mode !== "diff") throw new Error(`ArrowRight on the mode group gave "${mode}", not "diff"`);
      await evaluate(`document.querySelector('input[name="mode"][value="blink"]').click()`);
      await evaluate(`document.getElementById("play-btn").focus()`);
      const before = await evaluate(`document.getElementById("play-btn").getAttribute("aria-label")`);
      await press("Space");
      const after = await evaluate(`document.getElementById("play-btn").getAttribute("aria-label")`);
      await press("Space");
      if (before === after) throw new Error(`Space did not change the name of the Play button ("${before}")`);
      return `"${before}" -> "${after}"`;
    });
    await step("keys: Enter on a candidate selects it and says so (aria-pressed)", async () => {
      await evaluate(`document.querySelector("#mover-list .mover-item").focus()`);
      await press("Enter");
      const pressed = await evaluate(`document.querySelector("#mover-list .mover-item").getAttribute("aria-pressed")`);
      if (pressed !== "true") throw new Error(`aria-pressed is "${pressed}" after Enter`);
    });
    await step("keys: a layer switch (checkbox) is operated with Space", async () => {
      await evaluate(`document.querySelector('[data-open-panel="image-layers"]').focus()`);
      await press("Enter");
      await waitFor(`document.getElementById("image-layers").open`, "layer dialog", 3000);
      const id = await evaluate(`(() => { const c = document.querySelector("#layers input[type=checkbox]"); c.focus(); window.__lc = c; window.__was = c.checked; return c.id || c.name || "layer"; })()`);
      await press("Space");
      const now = await evaluate(`window.__lc.checked`), was = await evaluate(`window.__was`);
      if (now === was) throw new Error(`Space did not toggle ${id}`);
      await press("Space");
      await press("Escape");
      await waitFor(`!document.getElementById("image-layers").open`, "layer dialog dismissal", 3000);
      return id;
    });
    await step("keys: the picture takes focus from Tab, reads out the position at the centre of the view, and Enter measures there (the mark is announced); Escape clears it", async () => {
      await evaluate(`document.getElementById("blink-canvas").focus()`);
      await sleep(150);
      const readout = await evaluate(`({ on: document.getElementById("readout")?.classList.contains("active"), text: document.getElementById("readout")?.textContent.replace(/\\s+/g, " ").trim() ?? "" })`);
      if (!readout.on || readout.text.length < 10) throw new Error(`focusing the picture reads out nothing: ${JSON.stringify(readout)}`);
      const said = await waitFor(`document.getElementById("readout-announce").textContent`, "the centre of the view being said", 3000);
      if (!/^Centre of the view:/.test(said)) throw new Error(`the live region says: ${said}`);
      const idle = await evaluate(`document.getElementById("insp-mark").textContent`);
      await press("Enter");
      await waitFor(`document.getElementById("insp-mark").textContent !== ${JSON.stringify("")} && document.getElementById("insp-mark").classList.contains("has-mark")`, "the mark", 6000);
      const marked = await evaluate(`document.getElementById("insp-mark").textContent`);
      if (marked === idle) throw new Error("Enter did not mark a position");
      await press("Escape");
      await sleep(150);
      const cleared = await evaluate(`!document.getElementById("insp-mark").classList.contains("has-mark")`);
      if (!cleared) throw new Error("Escape did not clear the mark");
      return marked.replace(/\\s+/g, " ").slice(0, 80);
    });
    await step("keys: the list of shortcuts opens from its button with Enter, Escape closes it, and the focus comes back to the button", async () => {
      await evaluate(`document.getElementById("shortcuts-btn").focus()`);
      await press("Enter");
      const open = await waitFor(`document.querySelector("dialog[open]") ? (document.activeElement && document.querySelector("dialog[open]").contains(document.activeElement) ? "focus inside" : "focus OUTSIDE") : null`, "the dialog", 4000);
      if (open !== "focus inside") throw new Error(`the dialog opened but the ${open}`);
      await press("Escape");
      await sleep(150);
      const state = await evaluate(`({ open: !!document.querySelector("dialog[open]"), active: document.activeElement?.id })`);
      if (state.open) throw new Error("Escape did not close the dialog");
      if (state.active !== "shortcuts-btn") throw new Error(`the focus went to "${state.active}", not back to the button that opened the dialog`);
    });

    // ------------------------------------------------------------ 4. announcements: what a screen reader is told
    await evaluate(`window.__says = []; window.__obs = new MutationObserver((ms) => { for (const m of ms) { const t = m.target.nodeType === 3 ? m.target.parentElement : m.target; const r = t?.closest?.("[aria-live], [role=status], [role=alert]"); if (r) window.__says.push((r.id || r.className) + ": " + r.textContent.trim().replace(/\\s+/g, " ").slice(0, 110)); } });
      document.querySelectorAll("[aria-live], [role=status], [role=alert]").forEach((r) => window.__obs.observe(r, { childList: true, characterData: true, subtree: true }));`);
    await step("announcements: changing the image (the arrow key) is announced, with the frame and its date, in a live region", async () => {
      await evaluate(`window.__says = []; document.activeElement?.blur(); document.body.focus()`);
      await press("ArrowRight");
      await sleep(600);
      const says = await evaluate(`window.__says`), counter = await evaluate(`document.getElementById("frame-counter").textContent`);
      const heard = says.filter((s) => /\\d{4}-\\d{2}-\\d{2}|frame|image/i.test(s));
      if (!heard.length) throw new Error(`the image changed (${counter}) but no live region said anything about it. Live regions that changed: ${JSON.stringify(says)}`);
      return heard[0].slice(0, 90);
    });
    await step("announcements: a wrong coordinate is announced as an error (role=alert) and the field says it is invalid", async () => {
      await evaluate(`window.__says = []; const f = document.getElementById("ra-input"); f.value = "400"; f.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("search-form").requestSubmit();`);     // the page validates on submit, not while typing
      await sleep(400);
      const info = await evaluate(`({ alert: document.getElementById("ra-error").textContent.trim(), role: document.getElementById("ra-error").getAttribute("role"), invalid: document.getElementById("ra-input").getAttribute("aria-invalid"), described: document.getElementById("ra-input").getAttribute("aria-describedby"), focus: document.activeElement?.id })`);
      if (!info.alert || info.role !== "alert") throw new Error(`no alert: ${JSON.stringify(info)}`);
      if (info.focus !== "ra-input") throw new Error(`the focus did not move to the wrong field (it is on "${info.focus}")`);
      if (info.invalid !== "true") throw new Error(`the field is not marked aria-invalid (${JSON.stringify(info)})`);
      if (!/ra-error/.test(info.described ?? "")) throw new Error(`the field is not described by its error (${JSON.stringify(info)})`);
      await evaluate(`document.getElementById("ra-input").value = "136.5"; document.getElementById("ra-input").dispatchEvent(new Event("input", { bubbles: true }))`);
      return info.alert.slice(0, 60);
    });
    await step("announcements: a search says that it is running and what it found, in a live region", async () => {
      await evaluate(`window.__says = []`);
      await evaluate(`document.getElementById("find-movers-btn").click()`);
      await waitFor(`!/^Searching/.test(document.getElementById("movers-status").textContent) && !document.getElementById("find-movers-btn").disabled`, "the search");
      const says = (await evaluate(`window.__says`)).filter((s) => s.startsWith("movers-status"));
      if (says.length < 2) throw new Error(`movers-status said ${says.length} thing(s): ${JSON.stringify(says)}`);
      return says.at(-1).slice(0, 90);
    });

    ws.close();
  } catch (err) {
    check("the audit itself ran to the end", false, err.message);
  } finally {
    if (child) { child.kill(); await sleep(300); }
    server.close();
    await rm(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

await main();
if (process.exitCode !== 2) { console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed"); process.exitCode = failed ? 1 : 0; }
process.exit(process.exitCode ?? 0);
