// Tests for the three-panel workspace: the pure parts (features/workspace.js), the page markup and CSS that the layout depends on, and the DOM wiring
// (features/workspaceView.js) run against a small fake DOM.  Run: node scratch/test_workspace.mjs
import { readFileSync } from "node:fs";
import {
  layoutFor, BREAKPOINT_THREE, BREAKPOINT_TWO, parsePanels, serialisePanels, togglePanel, sideForKey, detailsHome, toggleWords, emptyHint,
  markText, MARK_IDLE, STORAGE_KEY, DEFAULT_PANELS,
} from "../frontend/js/features/workspace.js";
import { setupWorkspace } from "../frontend/js/features/workspaceView.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- the pure parts
check("layout by width: one column up to 860 px, two from 861, three from 1180",
  layoutFor(0) === "one" && layoutFor(375) === "one" && layoutFor(860) === "one" && layoutFor(861) === "two" && layoutFor(1179) === "two" && layoutFor(1180) === "three" && layoutFor(2560) === "three");
check("the breakpoints are the ones the CSS uses (checked below against styles.css)", BREAKPOINT_THREE === 1180 && BREAKPOINT_TWO === 861);

check("panels: nothing saved means both open", same(parsePanels(null), { left: true, right: true }) && same(parsePanels(""), DEFAULT_PANELS) && same(parsePanels(undefined), DEFAULT_PANELS));
check("panels: text that is not JSON, or not an object, means both open", same(parsePanels("not json"), DEFAULT_PANELS) && same(parsePanels("[]"), DEFAULT_PANELS) && same(parsePanels("42"), DEFAULT_PANELS) && same(parsePanels("null"), DEFAULT_PANELS));
check("panels: a value that is not a boolean is ignored for that side only",
  same(parsePanels('{"left":"no","right":false}'), { left: true, right: false }) && same(parsePanels('{"left":0,"right":1}'), DEFAULT_PANELS));
{
  const all = [true, false].flatMap((left) => [true, false].map((right) => ({ left, right })));
  check("panels: every one of the four states survives save and load", all.every((s) => same(parsePanels(serialisePanels(s)), s)));
}
{
  const s = { left: true, right: true };
  const t = togglePanel(s, "left");
  check("toggle: flips one side and leaves the other, and does not change its input", same(t, { left: false, right: true }) && same(s, { left: true, right: true }) && same(togglePanel(t, "left"), s));
  check("toggle: an unknown side changes nothing", same(togglePanel(s, "middle"), s) && same(togglePanel(s, undefined), s));
}
check("keys: [ is the search panel, ] the inspector, nothing else", sideForKey("[") === "left" && sideForKey("]") === "right" && sideForKey("a") === null && sideForKey("0") === null && sideForKey("{") === null);
check("details live in the inspector only with three panels", detailsHome("three") === "inspector" && detailsHome("two") === "list" && detailsHome("one") === "list");
check("button words say what the button does now, and the key", toggleWords("left", true).label === "Hide the search panel" && toggleWords("left", false).label === "Show the search panel"
  && toggleWords("right", true).title === "Hide the inspector (])" && toggleWords("left", true).title === "Hide the search panel ([)");
check("the empty inspector says where the description will appear", /appear here/.test(emptyHint("three")) && /under that list/.test(emptyHint("two")) && emptyHint("one") === emptyHint("two"));
check("marked position: one line, empty parts left out", markText({ pixel: "pixel 3, 4", sky: "RA 1  Dec 2", offset: "E +1.0″  N −2.0″", value: "" }) === "pixel 3, 4 · RA 1  Dec 2 · E +1.0″  N −2.0″"
  && markText({ pixel: "outside the image", sky: "", offset: "", value: "" }) === "outside the image" && MARK_IDLE.length > 20);

// ---------------------------------------------------------------- the page and the stylesheet
const HTML = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../frontend/css/styles.css", import.meta.url), "utf8");
const MAIN = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
const has = (id) => HTML.includes(`id="${id}"`);
{
  const wired = [...MAIN.matchAll(/setupWorkspace\(\{([\s\S]*?)\}\);/g)][0]?.[1] ?? "";
  const ids = [...wired.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]);
  check("main.js wires the workspace to ids that exist in index.html", ids.length >= 6 && ids.every(has), ids.filter((i) => !has(i)).join(", "));
}
check("the focusable workspace root carries the open/closed state of both side panels", /<main class="layout" id="workspace" tabindex="-1" data-left="open" data-right="open">/.test(HTML));
for (const [btn, body] of [["panel-left-btn", "controls-body"], ["panel-right-btn", "inspector-body"]]) {
  const tag = HTML.match(new RegExp(`<button[^>]*id="${btn}"[^>]*>`))?.[0] ?? "";
  check(`${btn}: a button with aria-expanded, aria-controls -> ${body}, a key and a text for screen readers`,
    /type="button"/.test(tag) && /aria-expanded="true"/.test(tag) && tag.includes(`aria-controls="${body}"`) && /aria-keyshortcuts="[\[\]]"/.test(tag) && has(body)
    && new RegExp(`id="${btn}"[\\s\\S]*?class="sr-only"`).test(HTML));
}
{
  const start = HTML.indexOf('<aside class="panel inspector"'), end = HTML.indexOf("</aside>");
  const inside = (id) => { const i = HTML.indexOf(`id="${id}"`); return i > start && i < end; };
  check("the frame facts (detector, wavelength, MJD, flags) are in the inspector", start > 0 && ["meta-det", "meta-wl", "meta-mjd", "meta-flags", "frame-meta"].every(inside));
  check("the marked position, the empty note and the slot for the candidate's description are in the inspector", ["insp-mark", "inspector-empty", "inspector-slot"].every(inside));
  check("the descriptions of a candidate start OUTSIDE the inspector (under their lists), so a narrow screen shows them where they were", ["mover-detail", "discover-detail"].every((id) => has(id) && !inside(id)));
  check("the inspector comes after the picture panel and before section 3 (the order of a phone: picture, search, inspector)",
    HTML.indexOf('class="panel player"') < start && end < HTML.indexOf('class="panel measure"'));
}
check("the old place of the frame facts (the end of the picture panel) is gone: each id exists once", ["meta-det", "meta-wl", "meta-mjd", "meta-flags"].every((id) => HTML.split(`id="${id}"`).length === 2));
check("the CSS has a three-column layout from the same width as the JavaScript", CSS.includes(`@media (min-width: ${BREAKPOINT_THREE}px)`));
check("the CSS one-column breakpoint is one pixel below the two-column width", CSS.includes(`@media (max-width: ${BREAKPOINT_TWO - 1}px)`));
check("the CSS closes a panel through the data attributes the script sets, for both sides, and hides a closed body with [hidden]",
  CSS.includes('.layout[data-left="closed"]') && CSS.includes('.layout[data-right="closed"]') && /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(CSS));
check("the CSS keeps the grid columns shrinkable (minmax(0, 1fr)) in the three-column layout", /\.layout \{ grid-template-columns: minmax\(250px, 320px\) minmax\(0, 1fr\) minmax\(280px, 340px\)/.test(CSS));
check("no colour is written into the new CSS (tokens only)", !/\.panel-toggle[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(CSS) && !/\.insp-[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(CSS));
check("the keyboard hint lists the two new keys", /<kbd>\[<\/kbd>[\s\S]{0,80}<kbd>\]<\/kbd>/.test(HTML));

// ---------------------------------------------------------------- the DOM part, against a small fake DOM
class Node {
  constructor(id = "", tagName = "DIV") {
    Object.assign(this, { id, tagName, hidden: false, dataset: {}, attrs: {}, parentNode: null, children: [], listeners: {}, textContent: "", title: "", classes: new Set() });
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn(event); }
  querySelector(sel) { return sel === ".sr-only" ? this.sr ?? null : null; }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  append(n) { n.remove(); this.children.push(n); n.parentNode = this; }
  insertBefore(n, ref) { n.remove(); this.children.splice(this.children.indexOf(ref), 0, n); n.parentNode = this; }
  after(n) { n.remove(); const p = this.parentNode; p.children.splice(p.children.indexOf(this) + 1, 0, n); n.parentNode = p; }
}
function makePage({ width = 1400, stored = undefined, storageThrows = false } = {}) {
  const byId = {};
  const make = (id, tag) => (byId[id] = new Node(id, tag));
  const root = make("workspace"), listBox = make("movers"), listBox2 = make("discover"), slot = make("inspector-slot"), empty = make("inspector-empty");
  const moverDetail = make("mover-detail"), discoverDetail = make("discover-detail");
  moverDetail.hidden = true; discoverDetail.hidden = true;
  listBox.append(make("mover-list")); listBox.append(moverDetail);
  listBox2.append(make("discover-list")); listBox2.append(discoverDetail);
  const leftBtn = make("panel-left-btn", "BUTTON"), rightBtn = make("panel-right-btn", "BUTTON");
  leftBtn.setAttribute("aria-controls", "controls-body"); rightBtn.setAttribute("aria-controls", "inspector-body");
  leftBtn.sr = new Node(); rightBtn.sr = new Node();
  make("controls-body"); make("inspector-body");
  const store = new Map(stored === undefined ? [] : [[STORAGE_KEY, stored]]);
  const localStorage = storageThrows
    ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }
    : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const winListeners = {}, observers = [], mediaListeners = [];
  const win = {
    innerWidth: width, viewport: width, localStorage,
    // like a browser: a media query answers from the viewport, which can differ from innerWidth for a moment while the window is resized or emulated
    matchMedia: (query) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(query)[1]);
      const mq = { get matches() { return win.viewport >= min; }, addEventListener: (t, fn) => { if (t === "change") mediaListeners.push(fn); } };
      return mq;
    },
    addEventListener: (t, fn) => (winListeners[t] ??= []).push(fn),
    MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} },
  };
  const docListeners = {};
  const doc = { createComment: () => new Node("#comment"), getElementById: (id) => byId[id] ?? null, addEventListener: (t, fn) => (docListeners[t] ??= []).push(fn) };
  const ws = setupWorkspace({ root, leftBtn, rightBtn, slot, empty, details: [moverDetail, discoverDetail], win, doc });
  const key = (k, extra = {}) => { const e = { key: k, target: new Node("x"), ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const fn of docListeners.keydown ?? []) fn(e); return e; };
  const resize = (w) => { win.innerWidth = w; win.viewport = w; for (const fn of winListeners.resize ?? []) fn(); };
  /** Only the media queries change (innerWidth stays stale) and only their change event fires: what an emulated or half-finished resize looks like. */
  const mediaOnly = (w) => { win.viewport = w; for (const fn of mediaListeners) fn(); };
  const touchDetails = () => { for (const o of observers) o.cb(); };
  return { ws, root, slot, empty, leftBtn, rightBtn, byId, store, moverDetail, discoverDetail, listBox, listBox2, key, resize, mediaOnly, touchDetails };
}

{
  const p = makePage({ width: 1400 });
  check("DOM: on a wide screen both descriptions are moved into the inspector's slot and the layout says three", p.slot.children.includes(p.moverDetail) && p.slot.children.includes(p.discoverDetail) && p.root.dataset.layout === "three");
  check("DOM: nothing selected, so the inspector says what will appear", !p.empty.hidden && /appear here/.test(p.empty.textContent));
  p.moverDetail.hidden = false; p.touchDetails();
  check("DOM: a selected candidate hides the note", p.empty.hidden === true);
  p.moverDetail.hidden = true; p.touchDetails();
  check("DOM: the note comes back when the selection is cleared", p.empty.hidden === false);

  check("DOM: both panels start open, buttons say Hide", p.root.dataset.left === "open" && p.root.dataset.right === "open" && p.leftBtn.attrs["aria-expanded"] === "true" && p.leftBtn.sr.textContent === "Hide the search panel");
  p.leftBtn.fire("click");
  check("DOM: the left button closes the search panel: state, attribute, aria-expanded, hidden body, words",
    p.ws.state.left === false && p.root.dataset.left === "closed" && p.leftBtn.attrs["aria-expanded"] === "false" && p.byId["controls-body"].hidden === true
    && p.leftBtn.sr.textContent === "Show the search panel" && p.leftBtn.title === "Show the search panel ([)" && p.root.dataset.right === "open" && p.byId["inspector-body"].hidden === false);
  check("DOM: the choice is saved as two booleans", p.store.get(STORAGE_KEY) === '{"left":false,"right":true}', String(p.store.get(STORAGE_KEY)));
  p.leftBtn.fire("click");
  check("DOM: the same button opens it again", p.ws.state.left === true && p.root.dataset.left === "open" && p.byId["controls-body"].hidden === false);

  const e1 = p.key("]");
  check("DOM: the key ] closes the inspector and is consumed", p.ws.state.right === false && p.root.dataset.right === "closed" && e1.defaultPrevented === true);
  p.key("]");
  check("DOM: and ] opens it again", p.ws.state.right === true);
  const e2 = p.key("[", { target: new Node("a", "INPUT") });
  check("DOM: a bracket typed in a field is not a command", p.ws.state.left === true && e2.defaultPrevented === false);
  const e3 = p.key("[", { target: new Node("b", "SELECT") });
  const e4 = p.key("[", { ctrlKey: true });
  const e5 = p.key("[", { altKey: true });
  const e6 = p.key("[", { target: Object.assign(new Node("c"), { isContentEditable: true }) });
  check("DOM: not in a select, not with Ctrl or Alt, not in editable text", p.ws.state.left === true && ![e3, e4, e5, e6].some((e) => e.defaultPrevented));
  p.key("[");
  check("DOM: a plain [ on the page closes the search panel", p.ws.state.left === false);
  p.key("x");
  check("DOM: any other key does nothing", p.ws.state.left === false && p.ws.state.right === true);

  p.resize(1000);
  check("DOM: on a narrower screen the descriptions go back under their own lists, in their old place", p.moverDetail.parentNode === p.listBox && p.discoverDetail.parentNode === p.listBox2
    && p.listBox.children[1].id === "#comment" && p.listBox.children[2] === p.moverDetail && p.slot.children.length === 0 && p.root.dataset.layout === "two");
  check("DOM: ... and the note says where they will appear", /under that list/.test(p.empty.textContent) && p.empty.hidden === false);
  p.moverDetail.hidden = false; p.touchDetails();
  check("DOM: ... and it stays, because the description is not in the inspector now", p.empty.hidden === false);
  p.resize(1500);
  check("DOM: back to a wide screen the descriptions return to the inspector", p.slot.children.length === 2 && p.root.dataset.layout === "three" && p.empty.hidden === true);
  p.resize(1600);
  check("DOM: a resize that keeps the layout moves nothing", p.slot.children.length === 2);
  p.resize(500);
  check("DOM: a phone width is one column", p.root.dataset.layout === "one" && p.listBox.children.includes(p.moverDetail));
  p.mediaOnly(1500);
  check("DOM: the layout follows the media queries, not window.innerWidth (a stale width and only a media change event): back to three, descriptions in the inspector",
    p.root.dataset.layout === "three" && p.slot.children.length === 2 && p.ws.layout === "three");
  p.mediaOnly(900);
  check("DOM: ... and down to two the same way", p.root.dataset.layout === "two" && p.slot.children.length === 0);
}
{
  const p = makePage({ width: 1400, stored: '{"left":false,"right":true}' });
  check("DOM: a saved choice is applied at the start", p.ws.state.left === false && p.root.dataset.left === "closed" && p.byId["controls-body"].hidden === true && p.root.dataset.right === "open");
}
{
  const p = makePage({ width: 1400, storageThrows: true });
  p.rightBtn.fire("click");
  check("DOM: with storage blocked the page still works (defaults, toggling, no error)", p.ws.state.left === true && p.ws.state.right === false && p.root.dataset.right === "closed");
}
{
  const p = makePage({ width: 1400, stored: "{broken" });
  check("DOM: a damaged saved value means both open", p.ws.state.left === true && p.ws.state.right === true);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
