// workspaceView.js – the page part of the three-panel workspace (the maths and the words are in workspace.js, tested with Node).
//
//   const ws = setupWorkspace({ root, leftBtn, rightBtn, slot, empty, details: [el, el] });
//
// * Two side panels can be closed: the search panel (button, or the key [) and the inspector (button, or the key ]). A closed panel keeps its
//   heading and its button; its body is hidden and, on a wide screen, the picture takes its column. The choice is kept in localStorage
//   (this browser only; the page works without it) and is NOT part of the link.
// * On a wide screen (three panels) the description of a selected candidate (#mover-detail, #discover-detail) lives in the inspector, beside the
//   list it belongs to. On a narrower screen it goes back under its list. The two elements keep their ids and their code: they are only moved,
//   so the modules that fill them do not know.
// * The inspector says what it holds while nothing is selected: it watches the `hidden` attribute of the two details.

import {
  layoutFor, BREAKPOINT_THREE, BREAKPOINT_TWO, DEFAULT_PANELS, STORAGE_KEY, parsePanels, serialisePanels, togglePanel, sideForKey, detailsHome, toggleWords, emptyHint,
} from "./workspace.js";

/** localStorage can throw (private window, blocked site data): every access is wrapped and the page works without it. */
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

export function setupWorkspace({ root, leftBtn, rightBtn, slot, empty, details, win = window, doc = document }) {
  const buttons = { left: leftBtn, right: rightBtn };
  const storage = safe(() => win.localStorage);
  let state = { ...DEFAULT_PANELS, ...parsePanels(safe(() => storage?.getItem(STORAGE_KEY))) };
  // The layout is read from the SAME media queries the stylesheet uses, so the script and the CSS cannot disagree (the window width can lag behind
  // a media query while the window is being resized or emulated). Without matchMedia it falls back to the width.
  const mqThree = win.matchMedia?.(`(min-width: ${BREAKPOINT_THREE}px)`) ?? null;
  const mqTwo = win.matchMedia?.(`(min-width: ${BREAKPOINT_TWO}px)`) ?? null;
  const currentLayout = () => (mqThree && mqTwo ? (mqThree.matches ? "three" : mqTwo.matches ? "two" : "one") : layoutFor(win.innerWidth));
  let layout = currentLayout();

  const homes = new Map();                                    // element -> a comment node marking where it lives under its own list
  for (const el of details) {
    const mark = doc.createComment(`home of #${el.id}`);
    el.parentNode.insertBefore(mark, el);
    homes.set(el, mark);
  }

  function renderPanels() {
    for (const side of ["left", "right"]) {
      const open = state[side], btn = buttons[side], words = toggleWords(side, open);
      root.dataset[side] = open ? "open" : "closed";
      btn.setAttribute("aria-expanded", String(open));
      btn.title = words.title;
      const sr = btn.querySelector(".sr-only");
      if (sr) sr.textContent = words.label;
      const body = doc.getElementById(btn.getAttribute("aria-controls"));
      if (body) body.hidden = !open;
    }
  }

  function renderEmpty() {
    const anySelected = details.some((el) => !el.hidden);
    empty.hidden = anySelected && detailsHome(layout) === "inspector";
    empty.textContent = emptyHint(layout);
  }

  function placeDetails() {
    const inInspector = detailsHome(layout) === "inspector";
    for (const el of details) {
      if (inInspector) slot.append(el);
      else homes.get(el).after(el);
    }
    root.dataset.layout = layout;
    renderEmpty();
  }

  function toggle(side) {
    state = togglePanel(state, side);
    safe(() => storage?.setItem(STORAGE_KEY, serialisePanels(state)));
    renderPanels();
    return state[side];
  }

  leftBtn.addEventListener("click", () => toggle("left"));
  rightBtn.addEventListener("click", () => toggle("right"));

  doc.addEventListener("keydown", (e) => {
    const side = sideForKey(e.key);
    if (!side || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;     // typing a bracket into a field is not a command
    e.preventDefault();
    toggle(side);
  });

  const onWidth = () => { const next = currentLayout(); if (next !== layout) { layout = next; placeDetails(); } };
  win.addEventListener("resize", onWidth);
  mqThree?.addEventListener?.("change", onWidth);
  mqTwo?.addEventListener?.("change", onWidth);

  const watcher = new win.MutationObserver(renderEmpty);
  for (const el of details) watcher.observe(el, { attributes: true, attributeFilter: ["hidden"] });

  renderPanels();
  placeDetails();
  return { toggle, get state() { return { ...state }; }, get layout() { return layout; } };
}
