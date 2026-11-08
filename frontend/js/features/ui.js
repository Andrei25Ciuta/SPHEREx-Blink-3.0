// ui.js – two small shared pieces of the interface: icons and the box for an empty, failed, loading or partial state.
//
// Pure (strings in, strings out, so scratch/test_ui.mjs tests them with Node); applyIcons is the one DOM helper.
//
// Icons: a handful of simple line icons drawn for this project (24 x 24, stroke = the text colour), no third-party icon set and no download. An icon is
// decoration: it is hidden from screen readers and the button next to it keeps its text.
//
// State boxes: the page said "No images yet", "Nothing to show yet" or an error in a different way in every place. stateHtml writes them one way:
// an icon, a short title, one sentence that says what happened and what to do, and (optionally) a button. An error is announced at once (role="alert");
// the others politely (role="status").

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Name -> the "d" attribute of one path (or several, joined by spaces), in a 24 x 24 box. */
export const ICONS = {
  save: "M12 4v11m0 0-4-4m4 4 4-4M5 19h14",
  record: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  code: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  keyboard: "M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.01",
  alert: "M12 4 3 20h18zM12 10v4M12 17v.01",
  inbox: "M4 13l2-7h12l2 7v5H4zM4 13h5l1 2h4l1-2h5",
  loading: "M12 4a8 8 0 1 0 8 8",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17.2v.01",
};

/** The SVG for an icon: inline, in the text colour, hidden from assistive technology. An unknown name gives an empty string. */
export function iconSvg(name, { size = 18 } = {}) {
  const d = ICONS[name];
  if (!d) return "";
  return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

/** Put the icon into every element that asks for one with data-icon="name" (data-icon-size for another size). */
export function applyIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) el.innerHTML = iconSvg(el.dataset.icon, { size: Number(el.dataset.iconSize) || 18 });
}

/**
 * The points of a small line plot of y against x (a "sparkline"), in a box w x h with a margin: x from the smallest to the largest x, y from the smallest to
 * the largest y, y up. points = [{ x, y }] (anything that is not a finite pair is dropped). Fewer than 3 usable points, or all at one x, give null: three
 * points are the least that say anything about a shape. All y equal gives a flat line in the middle.
 */
export function sparklinePoints(points, { w = 96, h = 26, pad = 2 } = {}) {
  const ok = (Array.isArray(points) ? points : []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  if (ok.length < 3 || ok[0].x === ok.at(-1).x) return null;
  const x0 = ok[0].x, x1 = ok.at(-1).x;
  const ys = ok.map((p) => p.y), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return ok.map((p) => ({
    x: pad + ((p.x - x0) / (x1 - x0)) * (w - 2 * pad),
    y: y1 === y0 ? h / 2 : pad + (1 - (p.y - y0) / (y1 - y0)) * (h - 2 * pad),
  }));
}

/** A sparkline as an inline SVG (decoration: hidden from assistive technology, the numbers are in the dossier), or "" when there is too little to draw. */
export function sparklineSvg(points, { w = 96, h = 26 } = {}) {
  const pts = sparklinePoints(points, { w, h });
  if (!pts) return "";
  const list = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.6"/>`).join("");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false"><polyline points="${list}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><g fill="currentColor">${dots}</g></svg>`;
}

/** The kinds of state box, the icon of each, and how a screen reader hears it. */
export const STATE_KINDS = {
  empty: { icon: "inbox", role: "status" },
  error: { icon: "alert", role: "alert" },
  loading: { icon: "loading", role: "status" },
  partial: { icon: "info", role: "status" },
  notice: { icon: "info", role: "status" },
};

/**
 * A box for a state. kind: empty | error | loading | partial | notice (anything else is a notice).
 * title: a few words. text: one sentence, what happened and what to do next. action: { label, id } for a button the caller wires, or omitted.
 * Everything is escaped.
 */
export function stateHtml({ kind = "notice", title, text = "", action = null }) {
  const k = STATE_KINDS[kind] ? kind : "notice";
  const { icon, role } = STATE_KINDS[k];
  const button = action ? `<button type="button" class="btn btn-small" id="${esc(action.id)}">${esc(action.label)}</button>` : "";
  return `<div class="state state-${k}" role="${role}"><span class="state-icon">${iconSvg(icon, { size: 22 })}</span>`
    + `<div class="state-body"><strong>${esc(title)}</strong>${text ? `<p>${esc(text)}</p>` : ""}${button}</div></div>`;
}
