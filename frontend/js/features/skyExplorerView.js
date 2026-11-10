// skyExplorerView.js – the page part of the sky explorer (the maths is in skyExplorer.js, tested with Node).
//
//   const explorer = setupSkyExplorer({ els, fetchFootprints, openField });
//
// fetchFootprints() -> Promise of { footprints, note } from the backend (or rejects: no backend, synthetic data), openField({ ra, dec, fov }) opens a field in the viewer.
//
// An all-sky map (Hammer projection, east to the left) with the ecliptic and the plane of the Milky Way, and one circle for each FIELD the files on the server make; a list of the
// same fields (the way in for the keyboard and for screen readers: the picture is decoration); and, for the field chosen, its images at true scale, with their dates. It draws only
// what the backend read from the files that exist.

import { formatRA, formatDec } from "../coords.js";
import {
  hammer, inverseHammer, eclipticLine, galacticLine, pathSegments, groupFields, nearestField, fieldText, suggestedFov, fieldOffsets, MAP_HALF_WIDTH, MAP_HALF_HEIGHT,
} from "./skyExplorer.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
};
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

const linePath = (segments) => segments.map((s) => `M${s.map((p) => `${p.x.toFixed(4)},${(-p.y).toFixed(4)}`).join("L")}`).join("");

export function setupSkyExplorer({ els, fetchFootprints, openField }) {
  let fields = [], selected = null;

  function drawMap() {
    const svg = svgEl("svg", { viewBox: `${-MAP_HALF_WIDTH - 0.15} ${-MAP_HALF_HEIGHT - 0.12} ${2 * MAP_HALF_WIDTH + 0.3} ${2 * MAP_HALF_HEIGHT + 0.24}`, class: "sky-svg", role: "img",
      "aria-label": `All-sky map with ${fields.length} field${fields.length === 1 ? "" : "s"} of image files. The list below has the same fields.` });
    svg.append(svgEl("ellipse", { cx: 0, cy: 0, rx: MAP_HALF_WIDTH, ry: MAP_HALF_HEIGHT, class: "sky-outline" }));
    for (const dec of [-60, -30, 0, 30, 60]) svg.append(svgEl("path", { d: linePath(pathSegments(Array.from({ length: 121 }, (_, i) => ({ ra: (i / 120) * 359.999, dec })))), class: "sky-grid" }));
    for (let ra = 0; ra < 360; ra += 30) svg.append(svgEl("path", { d: linePath(pathSegments(Array.from({ length: 61 }, (_, i) => ({ ra: ra === 0 ? 0.0001 : ra, dec: -90 + (i / 60) * 180 })))), class: "sky-grid" }));
    svg.append(svgEl("path", { d: linePath(pathSegments(galacticLine(361))), class: "sky-galactic" }), svgEl("path", { d: linePath(pathSegments(eclipticLine(361))), class: "sky-ecliptic" }));
    for (const h of [0, 6, 12, 18]) {
      const p = hammer(h * 15 === 0 ? 0.5 : h * 15, 0);
      svg.append(svgEl("text", { x: p.x, y: -p.y + 0.16, class: "sky-label", "text-anchor": "middle" }, `${h} h`));
    }
    fields.forEach((f) => {
      const p = hammer(f.ra, f.dec);
      const g = svgEl("g", { class: `sky-field${f === selected ? " is-selected" : ""}`, "data-id": f.id });
      g.append(svgEl("circle", { cx: p.x, cy: -p.y, r: 0.045 + 0.018 * Math.sqrt(f.count) }), svgEl("text", { x: p.x + 0.09, y: -p.y - 0.07, class: "sky-field-label" }, f.id));
      svg.append(g);
    });
    svg.addEventListener("click", (e) => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const m = svg.getScreenCTM(); if (!m) return;
      const loc = pt.matrixTransform(m.inverse()), sky = inverseHammer(loc.x, -loc.y);
      const near = sky ? nearestField(fields, sky.ra, sky.dec, 12) : null;
      if (near) select(near);
    });
    els.map.replaceChildren(svg);
  }

  function drawList() {
    els.list.replaceChildren(...fields.map((f) => {
      const b = el("button", { type: "button", className: "sky-item", ariaPressed: f === selected ? "true" : "false" },
        el("span", { className: "sky-item-id", textContent: f.id }),
        el("span", { className: "sky-item-main", textContent: `RA ${formatRA(f.ra)}  Dec ${formatDec(f.dec)}` }),
        el("span", { className: "sky-item-sub", textContent: fieldText(f) }));
      b.setAttribute("aria-pressed", f === selected ? "true" : "false");
      b.addEventListener("click", () => select(f));
      return el("li", {}, b);
    }));
  }

  function drawDetail() {
    els.detail.replaceChildren();
    if (!selected) { els.detail.hidden = true; return; }
    els.detail.hidden = false;
    const f = selected, polys = fieldOffsets(f), xs = polys.flatMap((p) => p.polygon.map((q) => q[0])), ys = polys.flatMap((p) => p.polygon.map((q) => q[1]));
    const pad = 1 + 0.08 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const svg = svgEl("svg", { viewBox: `${x0} ${-y1} ${x1 - x0} ${y1 - y0}`, class: "sky-field-svg", role: "img", "aria-label": `The ${f.count} images of field ${f.id} at true scale, east to the left, north up. The table below lists them.` });
    for (const p of polys) svg.append(svgEl("polygon", { points: p.polygon.map(([x, y]) => `${x.toFixed(3)},${(-y).toFixed(3)}`).join(" "), class: `fp-poly${p.detector === "D2" ? "" : " fp-dash"}` }));
    svg.append(svgEl("circle", { cx: 0, cy: 0, r: Math.max(0.08, (x1 - x0) / 120), class: "fp-centre" }));
    const rows = f.footprints.map((p) => el("tr", {}, el("td", { textContent: p.dateISO.slice(0, 16).replace("T", " ") }), el("td", { textContent: p.detector }),
      el("td", { textContent: `${p.wavelengthMinUm.toFixed(2)}–${p.wavelengthMaxUm.toFixed(2)}` }), el("td", { textContent: `${p.widthArcmin.toFixed(1)}′` })));
    const open = el("button", { type: "button", className: "btn btn-small btn-primary", textContent: `Open ${f.id} in the viewer (${suggestedFov(f)}′ field)` });
    open.addEventListener("click", () => openField({ ra: f.ra, dec: f.dec, fov: suggestedFov(f) }));
    els.detail.append(
      el("h3", { textContent: `Field ${f.id}: RA ${formatRA(f.ra)}  Dec ${formatDec(f.dec)}` }),
      el("p", { className: "muted small", textContent: `${fieldText(f)}. The squares are the images at true scale (east left, north up; the white dot is the centre of the field); solid = D2, dashed = another detector.` }),
      el("div", { className: "chart" }, svg), el("p", {}, open),
      el("details", { className: "table-view" }, el("summary", { textContent: "Show the images as a table" }),
        el("div", { className: "table-scroll" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Date (UTC)", "Detector", "λ (µm)", "Width"].map((t) => el("th", { scope: "col", textContent: t })))), el("tbody", {}, ...rows)))));
  }

  function select(f) { selected = f; drawMap(); drawList(); drawDetail(); }

  async function load() {
    els.status.textContent = "Reading the footprints of the image files…";
    els.refreshBtn.disabled = true;
    try {
      const { footprints, note } = await fetchFootprints();
      fields = groupFields(footprints);
      selected = fields.includes(selected) ? selected : null;
      els.status.textContent = fields.length
        ? `${footprints.length} image${footprints.length === 1 ? "" : "s"} in ${fields.length} field${fields.length === 1 ? "" : "s"}. ${note ?? ""}`.trim()
        : `The backend has no image files, so there is nothing to draw. ${note ?? ""}`.trim();
      els.mapWrap.hidden = !fields.length;
      drawMap(); drawList(); drawDetail();
    } catch (err) {
      fields = []; selected = null;
      els.mapWrap.hidden = true;
      els.status.textContent = `No footprints: ${err.message} Nothing is drawn in their place.`;
    } finally { els.refreshBtn.disabled = false; }
  }

  els.refreshBtn.addEventListener("click", load);
  return { load, get fields() { return fields; } };
}
