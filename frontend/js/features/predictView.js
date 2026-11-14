// predictView.js – the "Predicting objects" panel of Science Mode: a chart of where the selected mover was and where the straight-line
// model puts it at a chosen future date, with its 1-sigma range; four numbers; one line of caveat. The maths is in predict.js.

import { HORIZONS, predictAt, predictPath, daysUntilOutside, mjdToDate, reliabilityNote, motionOf } from "./predict.js";
import { formatRA, formatDec } from "../coords.js";

const SVG = "http://www.w3.org/2000/svg";
const W = 640, H = 320, PAD = 34;

/** getCandidate(): selected mover or null; getContext(): { scaleArcsec, field: { ra, dec, fov } }. Returns { refresh }. */
export function setupPredict({ getCandidate, getContext }) {
  const root = document.getElementById("predict");
  if (!root) return null;
  const $ = (id) => document.getElementById(id);
  const svg = $("predict-chart"), slider = $("predict-days"), chips = $("predict-horizons");
  let days = HORIZONS[2].days;
  // zoom and pan of the chart: zoom multiplies the scale, (cx, cy) is the centre of the view in arcseconds (east, north)
  let zoom = 1, cx = 0, cy = 0, lastK = 1, lastCandidate = null;
  const zoomLabel = $("predict-zoom-level");
  function setZoom(z, atEast = cx, atNorth = cy) {
    if (root.classList.contains("is-empty")) return;
    const nz = Math.min(64, Math.max(1, z));
    cx = atEast - (atEast - cx) * (zoom / nz); cy = atNorth - (atNorth - cy) * (zoom / nz);   // the point under the cursor stays put
    zoom = nz; if (zoom === 1) { cx = 0; cy = 0; }
    render();
  }
  const toSky = (ev) => { const b = svg.getBoundingClientRect(); const px = (ev.clientX - b.left) * W / b.width, py = (ev.clientY - b.top) * H / b.height;
    return { east: cx - (px - W / 2) / lastK, north: cy - (py - H / 2) / lastK }; };
  svg.addEventListener("wheel", (ev) => { if (root.classList.contains("is-empty")) return; ev.preventDefault(); const p = toSky(ev); setZoom(zoom * (ev.deltaY < 0 ? 1.25 : 0.8), p.east, p.north); }, { passive: false });
  let drag = null;
  svg.addEventListener("pointerdown", (ev) => { if (zoom === 1) return; drag = { x: ev.clientX, y: ev.clientY, cx, cy }; svg.setPointerCapture(ev.pointerId); svg.classList.add("is-dragging"); });
  svg.addEventListener("pointermove", (ev) => { if (!drag) return; const b = svg.getBoundingClientRect();
    cx = drag.cx + (ev.clientX - drag.x) * W / b.width / lastK; cy = drag.cy + (ev.clientY - drag.y) * H / b.height / lastK; render(); });
  const endDrag = () => { drag = null; svg.classList.remove("is-dragging"); };
  svg.addEventListener("pointerup", endDrag); svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("dblclick", (ev) => { const p = toSky(ev); setZoom(zoom * 2, p.east, p.north); });
  $("predict-zoom-in")?.addEventListener("click", () => setZoom(zoom * 1.5));
  $("predict-zoom-out")?.addEventListener("click", () => setZoom(zoom / 1.5));
  $("predict-zoom-reset")?.addEventListener("click", () => setZoom(1));
  svg.tabIndex = 0;
  svg.addEventListener("keydown", (ev) => { if (ev.key === "+" || ev.key === "=") setZoom(zoom * 1.5); else if (ev.key === "-") setZoom(zoom / 1.5); else if (ev.key === "0") setZoom(1); else return; ev.preventDefault(); });

  chips.replaceChildren(...HORIZONS.map((h) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pr-chip"; b.textContent = h.label; b.dataset.days = String(h.days);
    b.addEventListener("click", () => { days = h.days; slider.value = String(Math.round(days)); render(); });
    return b;
  }));
  slider.addEventListener("input", () => { days = Number(slider.value); render(); });

  const el = (tag, attrs = {}, parent = svg) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.appendChild(n); return n; };
  const label = (x, y, t, cls = "pr-lbl", anchor = "start") => { const n = el("text", { x, y, class: cls, "text-anchor": anchor }); n.textContent = t; return n; };

  function render() {
    const c = getCandidate(), ctx = getContext() ?? {};
    const scale = ctx.scaleArcsec;
    const m = c && motionOf(c, scale);
    if (c !== lastCandidate) { lastCandidate = c; zoom = 1; cx = 0; cy = 0; }      // a new object starts at the full view
    root.classList.toggle("is-empty", !m);
    chips.querySelectorAll(".pr-chip").forEach((b) => b.setAttribute("aria-pressed", String(Math.abs(Number(b.dataset.days) - days) < 1)));
    svg.textContent = "";
    if (!m) {
      el("rect", { width: W, height: H, class: "pr-bg" });
      label(W / 2, H / 2 - 6, "Select a moving object in the search results", "pr-empty", "middle");
      label(W / 2, H / 2 + 16, "Find movers → click a card → its future path appears here", "pr-empty-sub", "middle");
      for (const id of ["predict-date", "predict-ra", "predict-dec", "predict-sigma"]) $(id).textContent = "–";
      $("predict-note").textContent = "";
      $("predict-leave").hidden = true;
      return;
    }

    // past detections in arcseconds from the reference position (east left, north up, as on the sky)
    const past = (c.dots ?? c.fitPoints ?? []).map((p) => ({ east: -(p.x - c.x) * scale, north: -(p.y - c.y) * scale })).filter((p) => Number.isFinite(p.east) && Number.isFinite(p.north));
    const now = predictAt(c, days, scale);
    const path = predictPath(c, scale, 0, days, 48);
    const firstPast = past.length ? Math.min(...past.map((p) => p.east * m.east + p.north * m.north)) : 0;
    // view box in arcseconds: everything drawn, plus the uncertainty, with some room
    const xs = [0, now.east, ...past.map((p) => p.east)], ys = [0, now.north, ...past.map((p) => p.north)];
    const r = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs), (now.sigma ?? 0) * 1.4, 3) * 1.25;
    const k = Math.min((W - 2 * PAD) / (2 * r), (H - 2 * PAD) / (2 * r)) * zoom;
    lastK = k;
    const X = (e) => W / 2 - (e - cx) * k, Y = (n) => H / 2 - (n - cy) * k;
    const vr = r / zoom + Math.hypot(cx, cy);                         // half-size of what is visible, for the grid

    el("rect", { width: W, height: H, class: "pr-bg" });
    // grid every "nice" step
    const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => s * k >= 42) ?? 10000;
    for (let v = -Math.ceil(vr * 1.6 / step) * step; v <= vr * 1.6; v += step) {
      el("line", { x1: X(v), y1: 0, x2: X(v), y2: H, class: v ? "pr-grid" : "pr-axis" });
      el("line", { x1: 0, y1: Y(v), x2: W, y2: Y(v), class: v ? "pr-grid" : "pr-axis" });
    }
    label(8, 16, `grid: ${step}″`, "pr-lbl pr-faint");
    label(W - 10, 18, "N ↑   E ←", "pr-lbl pr-faint", "end");
    if (zoomLabel) zoomLabel.textContent = zoom === 1 ? "1×" : `${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×`;

    // the uncertainty cone along the future path
    if (now.sigma !== null) {
      const ux = -m.north / m.speed, uy = m.east / m.speed;          // unit vector across the motion (in east/north)
      const side = (sgn) => path.map((p) => `${X(p.east + sgn * ux * p.sigma).toFixed(1)},${Y(p.north + sgn * uy * p.sigma).toFixed(1)}`);
      el("polygon", { points: [...side(1), ...side(-1).reverse()].join(" "), class: "pr-cone" });
      el("circle", { cx: X(now.east), cy: Y(now.north), r: Math.max(now.sigma * k, 4), class: "pr-sigma" });
    }
    // fitted path through the detections, and the predicted path
    if (past.length) {
      const back = predictAt(c, (firstPast / (m.speed ** 2)) * 365.25, scale);
      el("line", { x1: X(back.east), y1: Y(back.north), x2: X(0), y2: Y(0), class: "pr-fit" });
    }
    el("line", { x1: X(0), y1: Y(0), x2: X(now.east), y2: Y(now.north), class: "pr-future" });
    for (const p of past) el("circle", { cx: X(p.east), cy: Y(p.north), r: 3.2, class: "pr-past" });
    // horizon ticks on the way
    for (const h of HORIZONS) {
      if (h.days >= days - 1) continue;
      const p = predictAt(c, h.days, scale);
      el("circle", { cx: X(p.east), cy: Y(p.north), r: 2.4, class: "pr-tick" });
    }
    el("circle", { cx: X(0), cy: Y(0), r: 5, class: "pr-ref" });
    label(X(0) + 8, Y(0) - 8, "measured", "pr-lbl");
    const g = el("g", { class: "pr-target", transform: `translate(${X(now.east).toFixed(1)} ${Y(now.north).toFixed(1)})` });
    el("circle", { r: 7 }, g);
    el("path", { d: "M-13 0H-8M8 0H13M0 -13V-8M0 8V13" }, g);
    label(X(now.east) + 12, Y(now.north) + 22, mjdToDate(now.mjd), "pr-lbl pr-target-lbl");

    $("predict-date").textContent = mjdToDate(now.mjd);
    $("predict-ra").textContent = formatRA(now.ra);
    $("predict-dec").textContent = formatDec(now.dec);
    $("predict-sigma").textContent = now.sigma === null ? "unknown" : `± ${now.sigma < 10 ? now.sigma.toFixed(1) : Math.round(now.sigma)}″`;
    const f = ctx.field;
    const leave = f && daysUntilOutside(c, scale, f.ra, f.dec, f.fov);
    $("predict-leave").hidden = !leave;
    if (leave) $("predict-leave").textContent = `Leaves this ${f.fov}′ field around ${mjdToDate(c.mjdRef + leave)}`;
    $("predict-note").textContent = reliabilityNote(c, scale);
  }

  render();
  return { refresh: render };
}
