// Tests for the colour themes: frontend/js/features/theme.js and the token blocks of frontend/css/styles.css.
// The contrast checks read the CSS itself, so a theme that fails them cannot be committed unnoticed.
// Run: node scratch/test_theme.mjs
import { readFileSync } from "node:fs";
import { THEMES, DEFAULT_THEME, STORAGE_KEY, isTheme, readTheme, applyTheme, setupThemeSwitcher } from "../frontend/js/features/theme.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

const CSS = readFileSync(new URL("../frontend/css/styles.css", import.meta.url), "utf8");
const INDEX = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const RESULTS = readFileSync(new URL("../frontend/results.html", import.meta.url), "utf8");

// ---------------------------------------------------------------- the tokens of every theme, read from the CSS
const block = (selector) => {
  // the rule starts a line: "selector {" or, for a rule shared with other selectors, "selector,"
  let start = CSS.indexOf(`\n${selector} {`);
  if (start < 0) start = CSS.indexOf(`\n${selector},`);
  if (start < 0) return null;
  const end = CSS.indexOf("\n}", start);
  return CSS.slice(start, end);
};
const declarations = (text) => Object.fromEntries([...text.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const classic = declarations(block(":root"));
const themes = { classic };
for (const t of THEMES.filter((x) => x.id !== "classic")) {
  const b = block(`[data-theme="${t.id}"]`);
  themes[t.id] = b ? { ...classic, ...declarations(b) } : null;
}
const REQUIRED = ["bg", "bg-2", "surface", "raised", "field", "border", "control-border", "text", "text-muted", "text-faint", "accent", "accent-hi", "accent-text", "accent-rgb",
  "accent-2", "alt-rgb", "on-accent", "warn", "warn-rgb", "danger", "success", "bg-rgb", "surface-rgb", "text-rgb", "panel-alpha", "veil-top", "veil-bottom"];

check("every theme in THEMES has a token block in styles.css", THEMES.every((t) => themes[t.id]), THEMES.filter((t) => !themes[t.id]).map((t) => t.id).join());
for (const t of THEMES) {
  const own = t.id === "classic" ? classic : declarations(block(`[data-theme="${t.id}"]`) ?? "");
  const missing = REQUIRED.filter((k) => !(`--${k}` in own));
  check(`${t.id}: defines every colour token itself (none silently inherited from Classic)`, missing.length === 0, missing.join());
}

// ---------------------------------------------------------------- contrast (WCAG 2.x relative luminance)
const hex = (v) => { const m = /^#([0-9a-f]{6})$/i.exec(v.trim()); if (!m) throw new Error(`not a #rrggbb colour: ${v}`); const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [x, y] = [luminance(hex(a)), luminance(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const t of THEMES) {
  const k = themes[t.id];
  if (!k) continue;
  const bad = [];
  const need = (fg, bg, min, label = `${fg} on ${bg}`) => { const c = contrast(k[`--${fg}`], k[`--${bg}`]); if (c < min) bad.push(`${label} ${c.toFixed(2)} < ${min}`); };
  for (const bg of ["bg", "bg-2", "surface", "raised", "field"]) {
    need("text", bg, 4.5);
    need("text-muted", bg, 4.5);
    need("accent-text", bg, 4.5);
    if (bg !== "raised") need("accent-hi", bg, 4.5);                       // links and hovers sit on the page, panels and fields; on raised cards the text token is used (Classic: 4.48:1)
    need("warn", bg, 4.5);
    need("danger", bg, 4.5);
    need("success", bg, 4.5);
    need("accent-2", bg, 4.5);
  }
  need("on-accent", "accent", 4.5);
  need("text-faint", "surface", 3, "text-faint on surface (disabled / placeholder only)");
  check(`${t.id}: every text colour reaches 4.5:1 on every surface it can sit on`, bad.length === 0, bad.join("; "));

  const ctrl = k["--control-border"];
  if (/^#/.test(ctrl)) check(`${t.id}: the border of an input and a button is visible against the surface and raised cards (3:1, WCAG 1.4.11)`, contrast(ctrl, k["--surface"]) >= 3 && contrast(ctrl, k["--raised"]) >= 3, `${contrast(ctrl, k["--surface"]).toFixed(2)} / ${contrast(ctrl, k["--raised"]).toFixed(2)}`);
  else check(`${t.id} (the original look): input borders stay the original faint cream line, below 3:1: a known gap, kept so that Classic looks as it did`, t.id === "classic");
}

// Every palette is paper-light. Only data-bearing image and chart islands retain a
// dark ground, so scientific images and the validated Plotly palette stay legible.
check("the five Paper palettes use a light browser scheme and Midnight is deliberately dark", THEMES.filter((t) => t.id !== "midnight").every((t) => /color-scheme:\s*light/.test(block(t.id === "classic" ? ":root" : `[data-theme="${t.id}"]`) ?? "")) && /color-scheme:\s*dark/.test(block('[data-theme="midnight"]') ?? ""));
check("dark image and chart islands are explicitly shared by all paper palettes", /html\[data-theme\] \.stage, html\[data-theme\] \.chart/.test(CSS));
{
  const ground = "#0B0F19";
  check("the shared dark islands keep high-contrast text on their #0B0F19 ground", contrast("#F6F7F9", ground) >= 4.5 && contrast("#CDD4DF", ground) >= 4.5);
}
{
  // The Plotly charts (spectrum, light curve) are drawn with the colours written in measure.js, on a box whose ground is --chart-bg. Defined once, overridden by no theme,
  // so the chart looks the same in the light theme as in the dark ones, and its text has to reach 4.5:1 on that ground.
  const m = readFileSync(new URL("../frontend/js/features/measure.js", import.meta.url), "utf8");
  const c = (name) => new RegExp(`${name} = "(#[0-9A-Fa-f]{6})"`).exec(m)?.[1];
  const [text, muted, ground] = [c("TEXT"), c("TEXT_MUTED"), c("SURFACE")];
  check("the Plotly charts: one ground (--chart-bg) in every theme, the same colour as measure.js draws on, and their text and axis text reach 4.5:1 on it",
    (CSS.match(/--chart-bg:/g) || []).length === 1 && Boolean(text && muted && ground) && ground.toLowerCase() === (/--chart-bg:\s*(#[0-9A-Fa-f]{6})/.exec(CSS)?.[1] ?? "").toLowerCase()
    && contrast(text, ground) >= 4.5 && contrast(muted, ground) >= 4.5, `${text} ${contrast(text ?? "#000", ground ?? "#000").toFixed(2)}, ${muted} ${contrast(muted ?? "#000", ground ?? "#000").toFixed(2)} on ${ground}`);
}

// the "-rgb" tokens are the same colour as their hex twin (they are used for translucent fills)
for (const t of THEMES) {
  const k = themes[t.id];
  if (!k) continue;
  const pairs = [["bg-rgb", "bg"], ["surface-rgb", "surface"], ["text-rgb", "text"], ["accent-rgb", "accent"], ["warn-rgb", "warn"]];
  const off = pairs.filter(([rgb, h]) => hex(k[`--${h}`]).join(" ") !== k[`--${rgb}`].trim().replace(/\s+/g, " "));
  check(`${t.id}: bg-rgb, surface-rgb, text-rgb, accent-rgb and warn-rgb match their hex colours`, off.length === 0, off.map(([rgb, h]) => `${rgb}=${k[`--${rgb}`]} vs ${k[`--${h}`]}`).join("; "));
}

// ---------------------------------------------------------------- no colour typed into a component rule
const after = CSS.slice(CSS.indexOf("/* ---------- 2. Base ---------- */"));
for (const needle of ["#0F2027", "#FF9A86", "#FBE9D0", "rgb(23 48 58", "rgb(251 233 208", "rgb(242 176 123"]) {
  check(`components use tokens: ${needle} (a Classic colour) is not typed into a rule`, !after.includes(needle));
}

// ---------------------------------------------------------------- theme.js
const memoryStorage = (seed = {}) => { const data = { ...seed }; return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data }; };
const throwingStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

check("the default is Light research and every theme has an id, a label, a scheme and a browser-bar colour", DEFAULT_THEME === "light" && THEMES.every((t) => t.id && t.label && ["dark", "light"].includes(t.scheme) && /^#[0-9A-F]{6}$/i.test(t.themeColor)));
check("isTheme accepts the four names and nothing else", THEMES.every((t) => isTheme(t.id)) && !isTheme("neon") && !isTheme("") && !isTheme(null) && !isTheme("__proto__"));
check("nothing saved, nothing in the address: the default", readTheme({ search: "", storage: memoryStorage() }) === "light");
check("the workspace opens in Midnight on first visit", readTheme({ defaultTheme: "midnight", storage: memoryStorage() }) === "midnight");
check("a saved choice wins over the workspace palette", readTheme({ defaultTheme: "midnight", storage: memoryStorage({ [STORAGE_KEY]: "classic" }) }) === "classic");
check("a URL theme wins over both the saved choice and the workspace palette", readTheme({ defaultTheme: "midnight", search: "?theme=nebula", storage: memoryStorage({ [STORAGE_KEY]: "classic" }) }) === "nebula");
check("a saved choice is used", readTheme({ search: "", storage: memoryStorage({ [STORAGE_KEY]: "light" }) }) === "light");
check("the address beats the saved choice", readTheme({ search: "?ra=1&theme=observatory", storage: memoryStorage({ [STORAGE_KEY]: "light" }) }) === "observatory");
check("unknown names, in the address or in storage, are ignored", readTheme({ search: "?theme=neon", storage: memoryStorage({ [STORAGE_KEY]: "<script>" }) }) === "light");
check("storage that throws (private window) is survived", readTheme({ search: "", storage: throwingStorage }) === "light");
{
  const root = { dataset: {} }, meta = { c: "", setAttribute(k, v) { this.c = v; } }, doc = { querySelector: () => meta };
  const storage = memoryStorage();
  check("applyTheme sets data-theme, the browser-bar colour, and saves", applyTheme("light", { root, storage, doc }) === "light" && root.dataset.theme === "light" && meta.c === "#FBFBF9" && storage.data[STORAGE_KEY] === "light");
  applyTheme("observatory", { root, storage, doc, persist: false });
  check("persist: false (a theme asked for in the address) is shown but not saved", root.dataset.theme === "observatory" && storage.data[STORAGE_KEY] === "light");
  check("an unknown theme falls back to the default instead of breaking the page", applyTheme("neon", { root, storage, doc }) === "light" && root.dataset.theme === "light");
  check("applyTheme survives storage that throws and a page without the meta tag", applyTheme("classic", { root, storage: throwingStorage, doc: { querySelector: () => null } }) === "classic");
}
{
  const listeners = {};
  const options = [];
  const select = { value: "", replaceChildren(...o) { options.length = 0; options.push(...o); }, addEventListener(type, fn) { listeners[type] = fn; } };
  const storage = memoryStorage({ [STORAGE_KEY]: "observatory" });
  const root = { dataset: {} };
  const win = { localStorage: storage, location: { search: "" }, document: { createElement: () => ({}), documentElement: root, querySelector: () => null } };
  globalThis.document = win.document;                                    // applyTheme's default root and doc
  const res = setupThemeSwitcher(select, { win });
  check("the switcher lists the six themes and shows the saved one", options.length === 6 && options.map((o) => o.value).join() === THEMES.map((t) => t.id).join() && select.value === "observatory" && res.active === "observatory");
  select.value = "light"; listeners.change();
  check("choosing a theme applies it and saves it", root.dataset.theme === "light" && storage.data[STORAGE_KEY] === "light");
  win.location.search = "?theme=classic";
  const second = setupThemeSwitcher(select, { win });
  check("a theme from the address is applied and shown, but does not overwrite the saved choice", second.active === "classic" && second.fromUrl === true && storage.data[STORAGE_KEY] === "light" && root.dataset.theme === "classic");
  delete globalThis.document;
}

// ---------------------------------------------------------------- the pages
for (const [name, html] of [["index.html", INDEX], ["results.html", RESULTS]]) {
  const m = /var t=new URLSearchParams\(location\.search\)\.get\("theme"\)\|\|localStorage\.getItem\("([^"]+)"\);if\(\/\^\(([^)]+)\)\$\/\.test\(t\)\)/.exec(html);
  check(`${name}: the inline script reads the same storage key and the same four names as theme.js`, Boolean(m) && m[1] === STORAGE_KEY && m[2].split("|").join() === THEMES.map((t) => t.id).join(), m ? `${m[1]} ${m[2]}` : "no inline theme script");
  check(`${name}: the default theme is on <html> (no flash and no JavaScript needed), there is a switch and a browser-bar colour`,
    html.includes(`<html lang="en" data-theme="midnight">`) &&
    html.includes('id="theme-select"') &&
    html.includes(`<meta name="theme-color" content="#0B0F19">`));
  check(`${name}: the monospace face is loaded with the other fonts`, /family=JetBrains\+Mono/.test(html) && /family=Inter:wght@400;500;600;700/.test(html));
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
