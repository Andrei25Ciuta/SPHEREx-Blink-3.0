// dialog.js – one way to open a modal box (the native <dialog>), and the list of keyboard shortcuts it first shows.
//
// A native <dialog> opened with showModal() already does the hard parts: the rest of the page is inert, Tab stays inside, Escape closes it, and the browser
// knows it is a dialog for screen readers. This module adds what it does not: a title tied to the dialog (aria-labelledby), a Close button, a click on
// the dark backdrop that closes it, focus going back to the button that opened it, and removal from the page when it closes.
//
// SHORTCUTS / shortcutsHtml are pure (scratch/test_ui.mjs checks the list against the hint in index.html); openDialog is the DOM part.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Every keyboard shortcut of the workspace, as { keys: [labels], does }. The hint under the picture in index.html must not name a key that is missing here. */
export const SHORTCUTS = [
  { keys: ["Space"], does: "Play or pause the blink" },
  { keys: ["←", "→"], does: "Show the previous or the next image" },
  { keys: ["+", "−"], does: "Zoom in or out" },
  { keys: ["0"], does: "Show the whole image" },
  { keys: ["Shift", "←", "↑", "↓", "→"], does: "Move the picture when it is zoomed in" },
  { keys: ["Ctrl", "scroll"], does: "Zoom with the mouse wheel or a trackpad pinch" },
  { keys: ["["], does: "Hide or show the search panel" },
  { keys: ["]"], does: "Hide or show the inspector" },
  { keys: ["Esc"], does: "Clear the marked position, or close a box" },
  { keys: ["?"], does: "Show this list" },
];

/** The shortcuts as a table (escaped). */
export function shortcutsHtml(list = SHORTCUTS) {
  const rows = list.map((s) => `<tr><th scope="row">${s.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(" ")}</th><td>${esc(s.does)}</td></tr>`).join("");
  return `<table class="keys"><caption class="sr-only">Keyboard shortcuts</caption><tbody>${rows}</tbody></table>`;
}

let counter = 0;

/**
 * Open a modal box. title: text. html: the body, already escaped by the caller. opener: the element to give the focus back to (default: the focused one).
 * Returns { close }.
 */
export function openDialog({ title, html, opener = null, doc = document }) {
  const back = opener ?? doc.activeElement;
  const id = `dlg-${++counter}`;
  const dlg = doc.createElement("dialog");
  dlg.className = "dlg";
  dlg.setAttribute("aria-labelledby", `${id}-title`);
  dlg.innerHTML = `<div class="dlg-head"><h2 id="${id}-title">${esc(title)}</h2>`
    + `<button type="button" class="btn btn-small dlg-close">Close</button></div><div class="dlg-body">${html}</div>`;
  doc.body.append(dlg);
  const close = () => { if (typeof dlg.close === "function" && dlg.open) dlg.close(); else dlg.dispatchEvent(new Event("close")); };
  dlg.querySelector(".dlg-close").addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });            // a click on the backdrop (the dialog element itself), not on its content
  dlg.addEventListener("close", () => { dlg.remove(); if (back && typeof back.focus === "function") back.focus(); });
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  dlg.querySelector(".dlg-close").focus();
  return { close };
}
