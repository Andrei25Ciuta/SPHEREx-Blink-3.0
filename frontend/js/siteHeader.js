import { setupThemeSwitcher, readTheme, applyTheme, STORAGE_KEY } from "./features/theme.js";
import { patchLinks } from "./features/carryParams.js";

const header = document.querySelector(".site-header");
const current = header.dataset.page;
const brand = header.querySelector(".site-brand");
if (brand?.textContent.trim() === "SPHEREx Blink") brand.textContent = "SPHEREx Blink 4.0";
// Two modes: the visitor chooses one on the home page and the menu then shows only that mode's pages, with a switch to the other.
const MODE_KEY = "spherex-blink-mode";
const readMode = () => { try { return localStorage.getItem(MODE_KEY); } catch { return null; } };
const saveMode = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch {} };
const params = new URLSearchParams(location.search);
let mode = readMode();
if (current === "learn" || params.has("mission")) mode = "learn";
else if (["sky", "simulator", "results"].includes(current)) mode = "science";
else if (current === "index" && !mode) mode = "science";
if (mode && current !== "overview") saveMode(mode);
document.documentElement.dataset.mode = mode ?? "none";

const PRACTICE = "index.html?ra=269.4462&dec=4.769&fov=5&det=D2#workspace";
const MODES = {
  learn: { label: "Learn Mode", home: "learn.html", pages: [
    ["learn", "Missions", "learn.html#missions"],
    ["lessons", "Lessons", "learn.html#lesson-panel"],
    ["astra", "Astra guide", "learn.html#astra"],
    ["index", "Practice lab", PRACTICE],
  ] },
  science: { label: "Science Mode", home: "index.html#workspace", pages: [
    ["index", "Workspace", "index.html#workspace"],
    ["pins", "Pin Board", "index.html#pin-board"],
    ["sky", "Sky Explorer", "sky.html"],
    ["simulator", "Simulator", "simulator.html"],
    ["results", "Results", "results.html"],
    ["about", "About", "index.html#about"],
  ] },
};
// On the home page no mode is active: the menu shows only Home and the page's two mode cards choose one.
const showMode = mode && current !== "overview";
const overviewPages = [
  ["overview", "Overview", "overview.html"],
  ["index", "Workspace", "index.html#workspace"],
  ["sky", "Sky Explorer", "sky.html"],
  ["simulator", "Simulator", "simulator.html"],
  ["results", "Results", "results.html"],
  ["about", "About", "index.html#about"],
];
const pages = current === "overview"
  ? overviewPages
  : [["overview", "Home", "overview.html"], ...(showMode ? MODES[mode].pages : [])];

const nav = document.createElement("nav");
nav.id = "project-nav";
nav.setAttribute("aria-label", "Project pages");            // the chip below names the mode
if (showMode) {
  const chip = document.createElement("span");
  chip.className = `mode-chip mode-chip-${mode}`;
  chip.textContent = MODES[mode].label;
  nav.append(chip);
}
for (const [id, label, url] of pages) {
  const link = document.createElement("a");
  link.textContent = label;
  const samePage = (current === "index" && url.startsWith("index.html#")) || (current === "learn" && url.startsWith("learn.html#"));
  link.href = samePage ? url.slice(url.indexOf("#")) : url;
  link.dataset.page = id;
  nav.append(link);
}
if (showMode) {
  const other = mode === "learn" ? "science" : "learn";
  const sw = document.createElement("a");
  sw.className = "mode-switch-link";
  sw.href = MODES[other].home;
  sw.innerHTML = `⇄ <span class="msl-long">Switch to </span>${MODES[other].label}`;
  sw.addEventListener("click", () => saveMode(other));
  nav.append(sw);
}
// the home page's mode cards and buttons choose the mode
for (const a of document.querySelectorAll("a[href]")) {
  const h = a.getAttribute("href");
  if (a.closest("#project-nav")) continue;
  if (/^learn\.html/.test(h)) a.addEventListener("click", () => saveMode("learn"));
  else if (/^index\.html/.test(h) && current === "overview") a.addEventListener("click", () => saveMode("science"));
}
function indicatePage() {
  const hash = location.hash;
  let active = current;
  if (current === "index") active = hash === "#about" ? "about" : hash === "#pin-board" ? "pins" : "index";
  if (current === "learn") active = hash === "#lesson-panel" ? "lessons" : hash === "#astra" ? "astra" : "learn";
  for (const link of nav.querySelectorAll("a[data-page]")) {
    if (link.dataset.page === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
indicatePage();
addEventListener("hashchange", indicatePage);

const menu = document.createElement("div");
menu.className = "project-menu";
menu.id = "project-menu";
const theme = header.querySelector("select");
menu.append(nav, theme);
const toggle = document.createElement("button");
toggle.type = "button";
toggle.className = "btn";
toggle.id = "pages-toggle";
toggle.textContent = "Menu";
toggle.setAttribute("aria-controls", menu.id);
toggle.setAttribute("aria-expanded", "false");
header.append(toggle, menu);

function setOpen(open) {
  toggle.setAttribute("aria-expanded", String(open));
  menu.classList.toggle("is-open", open);
}
toggle.addEventListener("click", () => setOpen(!menu.classList.contains("is-open")));
document.addEventListener("click", event => {
  if (!header.contains(event.target) || event.target.closest("#project-nav a")) setOpen(false);
});
header.addEventListener("focusout", event => {
  if (!header.contains(event.relatedTarget)) setOpen(false);
});
header.addEventListener("keydown", event => {
  if (!menu.classList.contains("is-open")) return;
  event.stopPropagation();
  if (event.key === "Escape") {
    setOpen(false);
    toggle.focus();
  }
});
matchMedia("(max-width: 75rem)").addEventListener("change", () => setOpen(false));
setupThemeSwitcher(theme);
addEventListener("storage", event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  theme.value = applyTheme(readTheme({ search: location.search, storage: event.storageArea, defaultTheme: "light" }), { persist: false });
});

// Keep the choices of this visit (?data=api, ?api=..., ?embed=1, ?theme=...) on every link to another page, the links added later included (features/carryParams.js):
// without it, Workspace -> Overview -> Workspace dropped a person from real data to the synthetic demo.
patchLinks(document);
