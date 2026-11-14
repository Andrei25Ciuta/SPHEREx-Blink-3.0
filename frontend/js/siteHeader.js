import { setupThemeSwitcher, readTheme, applyTheme, STORAGE_KEY } from "./features/theme.js";

const header = document.querySelector(".site-header");
const current = header.dataset.page;
const pages = [
  ["overview", "Overview", "overview.html"],
  ["index", "Workspace", "index.html#workspace"],
  ["sky", "Sky Explorer", "sky.html"],
  ["simulator", "Simulator", "simulator.html"],
  ["planet-x", "Planet X Lab", "planet-x.html"],
  ["results", "Results", "results.html"],
  ["about", "About", "index.html#about"],
];

const nav = document.createElement("nav");
nav.id = "project-nav";
nav.setAttribute("aria-label", "Project pages");
for (const [id, label, url] of pages) {
  const link = document.createElement("a");
  link.textContent = label;
  link.href = current === "index" && (id === "index" || id === "about") ? url.slice(url.indexOf("#")) : url;
  link.dataset.page = id;
  nav.append(link);
}
function indicatePage() {
  const active = current === "index" && location.hash === "#about" ? "about" : current;
  for (const link of nav.children) {
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
matchMedia("(max-width: 64rem)").addEventListener("change", () => setOpen(false));
setupThemeSwitcher(theme);
addEventListener("storage", event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  theme.value = applyTheme(readTheme({ search: location.search, storage: event.storageArea, defaultTheme: "midnight" }), { persist: false });
});
