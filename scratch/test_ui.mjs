// Tests for the shared interface pieces: tooltips (features/tooltip.js), icons and state boxes (features/ui.js), the dialog and the shortcut list
// (features/dialog.js). The DOM parts run against a small fake DOM.  Run: node scratch/test_ui.mjs
import { readFileSync } from "node:fs";
import { placeTip, tipText, setupTooltips } from "../frontend/js/features/tooltip.js";
import { ICONS, iconSvg, stateHtml, STATE_KINDS, sparklinePoints, sparklineSvg } from "../frontend/js/features/ui.js";
import { SHORTCUTS, shortcutsHtml, openDialog } from "../frontend/js/features/dialog.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

const HTML = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../frontend/css/styles.css", import.meta.url), "utf8");
const MAIN = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");

// ---------------------------------------------------------------- where the tooltip goes
{
  const view = { width: 1000, height: 700 }, tip = { width: 200, height: 40 };
  const mid = placeTip({ top: 300, left: 400, width: 100, height: 30 }, tip, view);
  check("tooltip: above the element when there is room, centred on it", mid.placement === "above" && mid.top === 300 - 8 - 40 && mid.left === 450 - 100);
  const top = placeTip({ top: 20, left: 400, width: 100, height: 30 }, tip, view);
  check("tooltip: below the element when there is no room above", top.placement === "below" && top.top === 20 + 30 + 8);
  const left = placeTip({ top: 300, left: 0, width: 20, height: 30 }, tip, view);
  const right = placeTip({ top: 300, left: 990, width: 10, height: 30 }, tip, view);
  check("tooltip: never leaves the window sideways", left.left === 8 && right.left === 1000 - 200 - 8, `${left.left}, ${right.left}`);
  const tall = placeTip({ top: 0, left: 400, width: 100, height: 700 }, tip, view);
  check("tooltip: an element as tall as the window gets the box pinned inside the top", tall.placement === "inside" && tall.top === 8);
  const wide = placeTip({ top: 300, left: 100, width: 100, height: 30 }, { width: 1200, height: 40 }, view);
  check("tooltip: a box wider than the window starts at the margin", wide.left === 8);
}
{
  const el = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) });
  check("tooltip text: data-tip wins over title, spaces are tidied, nothing gives null",
    tipText(el({ "data-tip": "  Hello\n  world ", title: "other" })) === "Hello world" && tipText(el({ title: "Only a title" })) === "Only a title"
    && tipText(el({ title: "   " })) === null && tipText(el({})) === null && tipText(null) === null);
}

// ---------------------------------------------------------------- the tooltip in a fake DOM
class Elem {
  constructor(tag = "div", attrs = {}) { this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = []; this.parent = null; this.hidden = false; this.style = {}; this.dataset = {}; this.textContent = ""; this.focusVisible = true; this.listeners = {}; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  closest(selector) {
    for (let n = this; n; n = n.parent) {
      if (selector === "dialog[open]" ? n.tagName === "DIALOG" && "open" in n.attrs : "data-tip" in n.attrs || "title" in n.attrs) return n;
    }
    return null;
  }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  matches(sel) { return sel === ":focus-visible" ? this.focusVisible : false; }
  getBoundingClientRect() { return this.rect ?? { top: 300, left: 400, width: 100, height: 30 }; }
  append(c) { c.parent = this; this.children.push(c); }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  fire(t, e = {}) { for (const f of this.listeners[t] ?? []) f({ target: this, ...e }); }
}
function tipPage() {
  const body = new Elem("body");
  const docListeners = {}, winListeners = {};
  const timers = []; let cleared = 0;
  const doc = {
    body,
    createElement: (t) => { const e = new Elem(t); e.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 40 }); return e; },
    addEventListener: (t, f) => (docListeners[t] ??= []).push(f),
  };
  const win = { innerWidth: 1000, innerHeight: 700, addEventListener: (t, f) => (winListeners[t] ??= []).push(f) };
  const api = setupTooltips({ doc, win, delay: 450, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => { cleared++; } });
  const box = body.children[0];
  const emit = (t, e) => { for (const f of docListeners[t] ?? []) f(e); };
  return { api, box, emit, timers, cleared: () => cleared, winListeners };
}
{
  const p = tipPage();
  check("tooltips: the box is a hidden element with role=tooltip and an id", p.box.id === "tooltip" && p.box.getAttribute("role") === "tooltip" && p.box.hidden === true);
  const btn = new Elem("button", { title: "Zoom in (+)" });
  p.emit("pointerover", { target: btn, pointerType: "mouse" });
  check("tooltips: a mouse that arrives waits (450 ms) before anything is shown", p.timers.length === 1 && p.timers[0].ms === 450 && p.box.hidden === true && btn.getAttribute("title") === "Zoom in (+)");
  p.timers[0].fn();
  check("tooltips: after the wait the box shows the text, the title is taken off (no double box), the element points at the box",
    p.box.hidden === false && p.box.textContent === "Zoom in (+)" && btn.getAttribute("title") === null && btn.getAttribute("aria-describedby") === "tooltip" && p.api.shown === btn);
  check("tooltips: the box is placed above the element", p.box.dataset.placement === "above" && p.box.style.top === `${300 - 8 - 40}px` && p.box.style.left === `${450 - 100}px`, JSON.stringify(p.box.style));
  p.emit("pointerout", { target: btn, relatedTarget: null });
  check("tooltips: leaving the element hides the box, gives the title back and removes the description", p.box.hidden === true && btn.getAttribute("title") === "Zoom in (+)" && btn.getAttribute("aria-describedby") === null && p.api.shown === null);
}
{
  const p = tipPage();
  const touch = new Elem("button", { title: "x" });
  p.emit("pointerover", { target: touch, pointerType: "touch" });
  check("tooltips: a finger gets no box", p.timers.length === 0);
  const none = new Elem("button");
  p.emit("pointerover", { target: none, pointerType: "mouse" });
  check("tooltips: an element with no text gets none", p.timers.length === 0);
  const kb = new Elem("button", { title: "Hide the inspector (])", "aria-describedby": "other-id" });
  p.emit("focusin", { target: kb });
  check("tooltips: keyboard focus adds the tooltip to the existing accessible description",
    p.box.hidden === false && p.box.textContent === "Hide the inspector (])" && kb.getAttribute("aria-describedby") === "other-id tooltip");
  p.emit("keydown", { key: "a" });
  check("tooltips: an ordinary key keeps the box", p.box.hidden === false);
  p.emit("keydown", { key: "Escape" });
  check("tooltips: Escape hides it and restores title and aria-describedby", p.box.hidden === true && kb.getAttribute("title") === "Hide the inspector (])" && kb.getAttribute("aria-describedby") === "other-id");
  const mouseFocus = new Elem("button", { title: "t" }); mouseFocus.focusVisible = false;
  p.emit("focusin", { target: mouseFocus });
  check("tooltips: focus that comes from a mouse click (not focus-visible) shows nothing", p.box.hidden === true);
  const a = new Elem("button", { title: "A" }), b = new Elem("button", { title: "B" });
  p.emit("focusin", { target: a }); p.emit("focusin", { target: b });
  check("tooltips: moving to another element swaps the box and gives the first one its title back", p.box.textContent === "B" && a.getAttribute("title") === "A" && b.getAttribute("title") === null && a.getAttribute("aria-describedby") === null);
  p.emit("pointerdown", { target: b });
  check("tooltips: a click hides the box", p.box.hidden === true && b.getAttribute("title") === "B");
  p.emit("pointerover", { target: a, pointerType: "mouse" });
  p.emit("pointerout", { target: a, relatedTarget: null });
  check("tooltips: leaving before the wait is over cancels it", p.cleared() >= 1 && p.box.hidden === true);
  const inner = new Elem("span"); inner.parent = a;
  p.emit("focusin", { target: a });
  p.emit("pointerout", { target: a, relatedTarget: inner });
  check("tooltips: moving between an element and its own child does not hide the box", p.box.hidden === false);
  p.winListeners.resize[0]();
  check("tooltips: a resize hides it", p.box.hidden === true);
}

// ---------------------------------------------------------------- icons
{
  const valid = /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/;
  check("icons: at least ten, every one a non-empty path of drawing commands", Object.keys(ICONS).length >= 10 && Object.values(ICONS).every((d) => typeof d === "string" && d.length > 6 && valid.test(d)),
    Object.entries(ICONS).filter(([, d]) => !valid.test(d)).map(([k]) => k).join(", "));
  const svg = iconSvg("save", { size: 24 });
  check("icons: inline SVG in the text colour, hidden from assistive technology, of the size asked for",
    svg.startsWith("<svg") && svg.includes('stroke="currentColor"') && svg.includes('aria-hidden="true"') && svg.includes('focusable="false"') && svg.includes('width="24"') && svg.includes('viewBox="0 0 24 24"') && svg.includes(`d="${ICONS.save}"`));
  check("icons: an unknown name gives nothing, not a broken picture", iconSvg("nope") === "");
  const asked = [...HTML.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]);
  check("icons: every icon index.html asks for exists", asked.length >= 2 && asked.every((n) => n in ICONS), asked.filter((n) => !(n in ICONS)).join(", "));
  check("icons: every kind of state box uses an icon that exists", Object.values(STATE_KINDS).every((k) => k.icon in ICONS));
  // found in the browser: the wrapper first had the class btn-icon, which already styles the round Play button (a blue circle appeared over the Shortcuts button)
  check("icons: the wrapper class of an icon is not one that already styles something else (btn-icon is the round Play button, defined once)",
    [...HTML.matchAll(/<span class="([^"]+)" data-icon=/g)].every((m) => m[1] === "btn-ico") && (CSS.match(/^\.btn-icon\s*\{/gm) || []).length === 1 && !/class="[^"]*btn-icon[^"]*" data-icon=/.test(HTML));
}

// ---------------------------------------------------------------- state boxes
{
  const err = stateHtml({ kind: "error", title: "Could not load <the> images", text: "The backend did not answer. Check that it is running.", action: { label: "Try again", id: "retry-x" } });
  check("state box: an error is announced at once (role=alert), with its icon, title, sentence and button",
    err.includes('role="alert"') && err.includes("state-error") && err.includes("<svg") && err.includes("<strong>Could not load &lt;the&gt; images</strong>") && err.includes("<p>The backend did not answer") && err.includes('id="retry-x"') && err.includes(">Try again</button>"));
  check("state box: everything is escaped", !err.includes("<the>") && stateHtml({ title: "<b>x</b>", text: "&" }).includes("&lt;b&gt;x&lt;/b&gt;") && stateHtml({ title: "t", text: "&" }).includes("<p>&amp;</p>"));
  const empty = stateHtml({ kind: "empty", title: "Nothing here" });
  check("state box: an empty state is polite (role=status), has no sentence and no button when none is given", empty.includes('role="status"') && !empty.includes("<p>") && !empty.includes("<button"));
  check("state box: an unknown kind is a notice", stateHtml({ kind: "weird", title: "t" }).includes("state-notice"));
  check("state box: loading, partial, notice, empty and error exist", ["loading", "partial", "notice", "empty", "error"].every((k) => k in STATE_KINDS));
  check("state box: the CSS styles every kind it can write", ["state-error", "state-partial", "state-loading", ".state-icon", ".state-body"].every((c) => CSS.includes(c)));
}

// ---------------------------------------------------------------- shortcuts and the dialog
{
  const single = SHORTCUTS.filter((s) => s.keys.length === 1).map((s) => s.keys[0]);
  check("shortcuts: every entry has keys and a sentence, no key is listed twice as a single-key shortcut", SHORTCUTS.every((s) => s.keys.length && s.does.length > 8) && new Set(single).size === single.length);
  const hint = HTML.match(/<p class="shortcuts" id="shortcuts-hint">([\s\S]*?)<\/p>/)?.[1] ?? "";
  const hinted = [...hint.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]);
  const listed = new Set(SHORTCUTS.flatMap((s) => s.keys));
  check("shortcuts: every key the hint under the picture names is in the list of the dialog", hinted.length >= 8 && hinted.every((k) => listed.has(k)), hinted.filter((k) => !listed.has(k)).join(", "));
  check("shortcuts: the keys of the two side panels, the question mark and Escape are in the list", ["[", "]", "?", "Esc"].every((k) => listed.has(k)));
  const table = shortcutsHtml([{ keys: ["<", "x"], does: "a & b" }]);
  check("shortcuts: a table with a row per shortcut, escaped, keys in <kbd>", table.includes("<table") && table.includes("<kbd>&lt;</kbd> <kbd>x</kbd>") && table.includes("a &amp; b") && !table.includes("<kbd><"));
  check("page: the shortcuts button and the ? key are wired in main.js, the button is in index.html",
    HTML.includes('id="shortcuts-btn"') && MAIN.includes('$("shortcuts-btn").addEventListener("click", showShortcuts)') && /e\.key !== "\?"/.test(MAIN) && MAIN.includes("setupTooltips()") && MAIN.includes("applyIcons()"));
  check("CSS: the dialog, its backdrop, the key table and the tooltip are styled with tokens (no colour written in)",
    [".dlg {", ".dlg::backdrop", ".keys {", ".tooltip {"].every((c) => CSS.includes(c)) && !/\.(dlg|tooltip|state)[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(CSS));
}
{
  const closeBtn = new Elem("button"); closeBtn.focused = false; closeBtn.focus = () => { closeBtn.focused = true; };
  const dlg = new Elem("dialog"); dlg.open = false; dlg.removed = false;
  dlg.querySelector = (s) => (s === ".dlg-close" ? closeBtn : null);
  dlg.showModal = () => { dlg.open = true; };
  dlg.close = () => { dlg.open = false; dlg.fire("close"); };
  dlg.remove = () => { dlg.removed = true; };
  dlg.dispatchEvent = () => {};
  const body = new Elem("body"); const opener = new Elem("button"); opener.focused = false; opener.focus = () => { opener.focused = true; };
  const doc = { body, activeElement: opener, createElement: () => dlg };
  const handle = openDialog({ title: "Keys <&>", html: "<p>Body</p>", opener, doc });
  check("dialog: opened as a modal, tied to its title (aria-labelledby), titled with escaped text, body as given, focus on Close",
    dlg.open === true && /^dlg-\d+-title$/.test(dlg.getAttribute("aria-labelledby")) && dlg.innerHTML.includes("Keys &lt;&amp;&gt;") && dlg.innerHTML.includes("<p>Body</p>") && closeBtn.focused === true && body.children.includes(dlg));
  dlg.fire("click", { target: new Elem("p") });
  check("dialog: a click inside the box does not close it", dlg.open === true);
  dlg.fire("click", { target: dlg });
  check("dialog: a click on the backdrop (the dialog element itself) closes it, removes it and gives the focus back to the button that opened it", dlg.open === false && dlg.removed === true && opener.focused === true);
  dlg.open = true; opener.focused = false; dlg.removed = false;
  closeBtn.fire("click");
  check("dialog: the Close button closes it, and close() is returned for the caller", dlg.open === false && dlg.removed === true && opener.focused === true && typeof handle.close === "function");
}

// ---------------------------------------------------------------- sparklines
{
  const pts = [{ x: 1, y: 0 }, { x: 2, y: 10 }, { x: 4, y: 5 }];
  const s = sparklinePoints(pts, { w: 100, h: 20, pad: 2 });
  check("sparkline: x from the smallest to the largest x, y from the smallest (bottom) to the largest (top), inside the margin",
    s.length === 3 && s[0].x === 2 && s[2].x === 98 && Math.abs(s[1].x - (2 + (1 / 3) * 96)) < 1e-9 && s[0].y === 18 && s[1].y === 2 && Math.abs(s[2].y - 10) < 1e-9);
  check("sparkline: points given out of order are sorted by x", sparklinePoints([pts[2], pts[0], pts[1]]).map((p) => p.x).join() === sparklinePoints(pts).map((p) => p.x).join());
  check("sparkline: fewer than three usable points, all at one x, or no list give null (nothing to draw)", sparklinePoints(pts.slice(0, 2)) === null && sparklinePoints([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]) === null && sparklinePoints(null) === null && sparklineSvg(undefined) === "");
  check("sparkline: points that are not finite numbers are dropped before counting", sparklinePoints([...pts.slice(0, 2), { x: NaN, y: 1 }, { x: 3, y: Infinity }, null]) === null && sparklinePoints([...pts, { x: NaN, y: 1 }]).length === 3);
  check("sparkline: all the same flux is a flat line in the middle", sparklinePoints([{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }], { w: 50, h: 20 }).every((p) => p.y === 10));
  const svg = sparklineSvg(pts);
  check("sparkline: an inline SVG, one polyline and a dot per point, in the text colour, hidden from assistive technology", svg.startsWith("<svg") && svg.includes('aria-hidden="true"') && svg.includes("<polyline") && svg.includes('stroke="currentColor"') && (svg.match(/<circle/g) || []).length === 3);
  check("sparkline: the explorer shows the column only for rows that have a spectrum (a hidden header and cells otherwise), and the CSS sizes it",
    readFileSync(new URL("../frontend/js/features/candidateExplorerView.js", import.meta.url), "utf8").includes("const showSpec = rows.some((r) => r.spec)") && CSS.includes(".ex-spec {") && CSS.includes(".spark {"));
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
