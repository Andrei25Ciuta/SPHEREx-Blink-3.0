// viewerControls.js – the page part of the image viewer: zoom buttons, drag and pinch, keyboard, the readout under the pointer and the layer list.
// The maths is in view.js, readout.js and layers.js (pure, tested with Node: scratch/test_view.mjs); this file only connects them to the DOM,
// so it is checked in the browser.
//
//   const viewer = setupViewer({ player, canvas, crosshair, zoomEls, readoutEls, layersRoot, getGeo, loadFloat });
//
// Zoom:  the + and − buttons, the keys + − 0, Ctrl + scroll (a trackpad pinch is a Ctrl + scroll too), two fingers on a touch screen.
// Move:  drag the picture (only when zoomed in), Shift + arrow keys. A click that was really a drag does NOT measure.
// Readout: pixel, RA/Dec, offset from the centre of the field and the pixel value, under the pointer.

import { LAYERS, layerCounts } from "./layers.js";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, zoomLabel, fracToCanvas } from "./view.js";
import { describePoint, formatValue, readoutParts } from "./readout.js";

const DRAG_PIXELS = 4;                           // a pointer must move this far (screen pixels) before it counts as a drag
const OWN_LAYERS = ["candidates", "marker", "scalebar"];   // layers whose switch the viewer wires (the others are wired in main.js: they fetch data)

export function setupViewer({ player, canvas, crosshair, zoomEls, readoutEls, layersRoot, getGeo, loadFloat = null }) {
  const pointers = new Map();                    // active pointers: id -> { x, y } in client pixels
  let gesture = null;                            // { startX, startY, dragged }
  let suppressClick = false;                     // the pointer-up of a drag is followed by a click that must not measure
  let lastPointer = null;                        // where the pointer was last seen over the canvas, for refreshing the readout
  const floats = new Map();                      // dataUrl -> { values } (pixel values of the frames the pointer has visited)
  const loading = new Set();

  // ------------------------------------------------------------------ canvas <-> screen
  const toCanvas = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * canvas.width, y: ((clientY - r.top) / r.height) * canvas.height };
  };
  const perScreenPx = () => canvas.width / canvas.getBoundingClientRect().width;      // canvas pixels per screen pixel

  // ------------------------------------------------------------------ zoom buttons, crosshair
  function refresh() {
    const has = player.length > 0, z = player.zoom;
    zoomEls.level.textContent = zoomLabel(z);
    zoomEls.inBtn.disabled = !has || z >= MAX_ZOOM;
    zoomEls.outBtn.disabled = !has || z <= MIN_ZOOM;
    zoomEls.fitBtn.disabled = !has || z <= MIN_ZOOM;
    canvas.classList.toggle("zoomed", z > 1);
    if (crosshair) {                             // the mark for the requested position moves with the picture
      const p = fracToCanvas(player.view, 0.5, 0.5, canvas.width, canvas.height);
      const inside = p.x >= 0 && p.x <= canvas.width && p.y >= 0 && p.y <= canvas.height;
      crosshair.hidden = !inside;
      crosshair.style.left = `${(p.x / canvas.width) * 100}%`;
      crosshair.style.top = `${(p.y / canvas.height) * 100}%`;
    }
  }
  zoomEls.inBtn.addEventListener("click", () => player.zoomBy(ZOOM_STEP));
  zoomEls.outBtn.addEventListener("click", () => player.zoomBy(1 / ZOOM_STEP));
  zoomEls.fitBtn.addEventListener("click", () => player.resetView());
  player.onViewChange = refresh;

  // ------------------------------------------------------------------ drag, pinch
  canvas.addEventListener("pointerdown", (e) => {
    if (!player.length || (e.pointerType === "mouse" && e.button !== 0)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) gesture = { startX: e.clientX, startY: e.clientY, dragged: false };
    else if (gesture) gesture.dragged = true;                       // a second finger: this is a pinch, never a click
    try { canvas.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
  });

  canvas.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (prev) {
      const now = { x: e.clientX, y: e.clientY };
      if (pointers.size === 1 && gesture && player.zoom > 1) {
        if (!gesture.dragged && Math.hypot(now.x - gesture.startX, now.y - gesture.startY) > DRAG_PIXELS) {
          gesture.dragged = true;
          canvas.classList.add("dragging");
        }
        if (gesture.dragged) player.panByCanvas((now.x - prev.x) * perScreenPx(), (now.y - prev.y) * perScreenPx());
      } else if (pointers.size === 2) {
        const other = [...pointers].find(([id]) => id !== e.pointerId)[1];
        const before = Math.hypot(prev.x - other.x, prev.y - other.y), after = Math.hypot(now.x - other.x, now.y - other.y);
        const midBefore = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }, midAfter = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
        if (before > 0 && after > 0) {
          const c = toCanvas(midAfter.x, midAfter.y);
          player.zoomBy(after / before, c.x, c.y);
          player.panByCanvas((midAfter.x - midBefore.x) * perScreenPx(), (midAfter.y - midBefore.y) * perScreenPx());
        }
      }
      pointers.set(e.pointerId, now);
    }
    if (pointers.size < 2) showReadout(e.clientX, e.clientY);
  });

  const release = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    canvas.classList.remove("dragging");
    if (pointers.size === 0 && gesture) {
      if (gesture.dragged) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 60); }
      gesture = null;
    }
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && pointers.size === 0) hideReadout(); });

  // Registered before main.js adds its own click handler: a click that ends a drag stops here.
  canvas.addEventListener("click", (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  // ------------------------------------------------------------------ wheel
  canvas.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey) || !player.length) return;       // a plain wheel keeps scrolling the page
    e.preventDefault();
    const c = toCanvas(e.clientX, e.clientY);
    const dy = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY));
    player.zoomBy(Math.exp(-dy * 0.008), c.x, c.y);
  }, { passive: false });

  // ------------------------------------------------------------------ keyboard
  document.addEventListener("keydown", (e) => {
    if (!(e.target instanceof Element) || e.target.closest("input, select, textarea, summary, .skymap") || !player.length) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;                // leave the browser's own shortcuts alone
    if (e.key === "+" || e.key === "=") { e.preventDefault(); player.zoomBy(ZOOM_STEP); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); player.zoomBy(1 / ZOOM_STEP); }
    else if (e.key === "0") { e.preventDefault(); player.resetView(); }
    else if (e.shiftKey && e.key.startsWith("Arrow") && player.zoom > 1) {
      e.preventDefault();
      player.panByStep(e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0);
    }
  });

  // ------------------------------------------------------------------ readout under the pointer
  function setReadout(parts) {
    readoutEls.root.classList.add("active");
    readoutEls.pixel.textContent = parts.pixel;
    readoutEls.sky.textContent = parts.sky;
    readoutEls.offset.textContent = parts.offset;
    readoutEls.value.textContent = parts.value;
  }
  function hideReadout() {
    lastPointer = null;
    readoutEls.root.classList.remove("active");
    for (const k of ["pixel", "sky", "offset", "value"]) readoutEls[k].textContent = "";
  }

  /** The pixel value under the pointer: real numbers where the backend served them, the 8-bit display level otherwise. null = none to show. */
  function valueAt(d, geo) {
    if (player.mode !== "blink") return null;                       // the other modes show a combination of images, not one image's value
    const frame = player.frames[player.index];
    if (frame?.dataUrl && loadFloat) {
      const hit = floats.get(frame.dataUrl);
      if (hit && hit.values.length === geo.n * geo.n) return { text: `value ${formatValue(hit.values[d.iy * geo.n + d.ix], frame.unit)}` };
      if (!hit) requestFloat(frame);
      return { text: "value …" };
    }
    const level = player.greyLevelAt(d.ix, d.iy);
    return level === null ? null : { text: `display level ${level}/255` };
  }

  function requestFloat(frame) {
    if (loading.has(frame.dataUrl)) return;
    loading.add(frame.dataUrl);
    loadFloat(frame).then((values) => {
      if (values) floats.set(frame.dataUrl, { values });
    }).catch(() => { /* no value then; the position is still shown */ }).finally(() => {
      loading.delete(frame.dataUrl);
      if (lastPointer) showReadout(lastPointer.x, lastPointer.y);
    });
  }

  function showReadout(clientX, clientY) {
    const geo = getGeo();
    if (!geo || !player.length) { hideReadout(); return; }
    lastPointer = { x: clientX, y: clientY };
    const { fx, fy } = player.pointToFrac(clientX, clientY);
    const d = describePoint(fx, fy, geo);
    setReadout(readoutParts(d, d.inside ? valueAt(d, geo) : null));
  }

  // ------------------------------------------------------------------ layer list
  for (const layer of LAYERS) {
    const row = layersRoot.querySelector(`[data-layer="${layer.id}"]`);
    if (!row) continue;
    const key = row.querySelector(".layer-key");
    key.dataset.shape = layer.swatch;
    key.style.setProperty("--key", layer.color);
    if (OWN_LAYERS.includes(layer.id)) {
      const box = row.querySelector("input[type=checkbox]");
      player.setLayerVisible(layer.id, box.checked);
      box.addEventListener("change", () => player.setLayerVisible(layer.id, box.checked));
    }
  }
  const countEls = Object.fromEntries(LAYERS.map((l) => [l.id, layersRoot.querySelector(`[data-count="${l.id}"]`)]));
  const shown = {};
  function updateCounts() {
    const counts = layerCounts(player);
    for (const l of LAYERS) {
      const el = countEls[l.id], c = counts[l.id];
      const text = c ? String(c) : "";
      if (el && shown[l.id] !== text) { el.textContent = text; shown[l.id] = text; }
    }
  }
  player.onDraw = () => {
    updateCounts();
    if (lastPointer && gesture === null) showReadout(lastPointer.x, lastPointer.y);   // another frame under a resting pointer
  };

  refresh();
  return { refresh, hideReadout };
}
