// tooltip.js – tooltips that work with the keyboard and keep the text for screen readers.
//
// The browser's own tooltip (the title attribute) shows only for a mouse that rests on an element, never for the keyboard, and it cannot be styled or
// placed. This module shows the same text in a small box of our own: after a short rest of the mouse, at once on keyboard focus, hidden by Escape, a
// click, a scroll or leaving the element. It needs no markup: any element with a title (or a data-tip) gets it, also the ones the page creates later,
// because the listeners are on the document.
//
//   * While the box is shown, the element's title is taken off (or the browser would show its own box as well) and given back when the box goes away.
//   * While it is shown, the element points at the box with aria-describedby, so a screen reader reads the text as the description.
//   * A touch screen has no hover: no box for a finger. A keyboard user gets it on focus.
//
// placeTip, tipText are pure (scratch/test_ui.mjs); setupTooltips is the DOM part.

/**
 * Where to put the box (px, viewport coordinates) around an element: above it if it fits, else below, else pinned inside the top edge.
 * target = { top, left, width, height }, tip = { width, height }, view = { width, height }. The box never leaves the viewport sideways.
 */
export function placeTip(target, tip, view, { gap = 8, margin = 8 } = {}) {
  const left = Math.min(Math.max(margin, target.left + target.width / 2 - tip.width / 2), Math.max(margin, view.width - tip.width - margin));
  const above = target.top - gap - tip.height;
  if (above >= margin) return { placement: "above", left, top: above };
  const below = target.top + target.height + gap;
  if (below + tip.height + margin <= view.height) return { placement: "below", left, top: below };
  return { placement: "inside", left, top: margin };
}

/** The text of an element's tooltip: data-tip first, then title; trimmed; null when there is none. */
export function tipText(el) {
  const raw = el?.getAttribute?.("data-tip") ?? el?.getAttribute?.("title") ?? "";
  const text = String(raw).replace(/\s+/g, " ").trim();
  return text || null;
}

const SELECTOR = "[data-tip], [title]";

/** Set the tooltips up for the whole document. Returns { hide }. */
export function setupTooltips({ doc = document, win = window, delay = 450, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const box = doc.createElement("div");
  box.id = "tooltip";
  box.className = "tooltip";
  box.setAttribute("role", "tooltip");
  box.hidden = true;
  doc.body.append(box);

  let current = null;                 // { el, title, describedBy } while the box is shown for el
  let pending = null;                 // { el, timer } while waiting for the mouse to rest

  function hide() {
    if (pending) { clearTimer(pending.timer); pending = null; }
    if (!current) return;
    const { el, title, describedBy } = current;
    if (title !== null) el.setAttribute("title", title);
    if (describedBy === null) el.removeAttribute("aria-describedby"); else el.setAttribute("aria-describedby", describedBy);
    current = null;
    box.hidden = true;
  }

  function show(el) {
    const text = tipText(el);
    if (!text) return;
    if (current?.el === el) return;
    hide();
    const title = el.getAttribute("title");
    const describedBy = el.getAttribute("aria-describedby");
    if (title !== null) el.removeAttribute("title");       // or the browser draws its own box too
    el.setAttribute("aria-describedby", [describedBy, box.id].filter(Boolean).join(" "));
    const host = el.closest?.("dialog[open]") ?? doc.body;
    if (box.parentNode !== host) host.append(box);
    current = { el, title, describedBy };
    box.textContent = text;
    box.hidden = false;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const view = { width: win.innerWidth, height: win.innerHeight };
    const at = placeTip({ top: r.top, left: r.left, width: r.width, height: r.height }, { width: b.width, height: b.height }, view);
    box.style.left = `${Math.round(at.left)}px`;
    box.style.top = `${Math.round(at.top)}px`;
    box.dataset.placement = at.placement;
  }

  const targetOf = (node) => (node && node.closest ? node.closest(SELECTOR) : null);

  doc.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = targetOf(e.target);
    if (!el || el === current?.el || el === pending?.el) return;
    if (pending) { clearTimer(pending.timer); pending = null; }
    if (!tipText(el)) return;
    pending = { el, timer: setTimer(() => { pending = null; show(el); }, delay) };
  });
  doc.addEventListener("pointerout", (e) => {
    // Find the element by remembering it, not by its selector: while its box is shown the title is off, so closest("[title]") would no longer find it.
    const leaves = (el) => el && el.contains?.(e.target) && !(e.relatedTarget && el.contains(e.relatedTarget));      // moving inside the same element is not leaving
    if (leaves(pending?.el)) { clearTimer(pending.timer); pending = null; }
    if (leaves(current?.el)) hide();
  });
  doc.addEventListener("focusin", (e) => {
    const el = targetOf(e.target);
    if (!el) return;
    let keyboard = true;
    try { keyboard = el.matches(":focus-visible"); } catch { keyboard = true; }      // a click that focuses a button is not keyboard use
    if (keyboard) show(el);
  });
  doc.addEventListener("focusout", hide);
  doc.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  doc.addEventListener("pointerdown", hide);
  doc.addEventListener("scroll", hide, true);
  win.addEventListener("resize", hide);

  return { hide, get shown() { return current?.el ?? null; } };
}
