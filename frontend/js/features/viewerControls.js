// viewerControls.js – the page part of the image viewer: zoom buttons, drag and pinch, keyboard, the readout under the pointer and the layer list.
// The maths is in view.js, readout.js and layers.js (pure, tested with Node: scratch/test_view.mjs); this file only connects them to the DOM,
// so it is checked in the browser.
//
//   const viewer = setupViewer({ player, canvas, crosshair, zoomEls, readoutEls, layersRoot, getGeo, loadFloat });
//
// Zoom:  the + and − buttons, the keys + − 0, Ctrl + scroll (a trackpad pinch is a Ctrl + scroll too), two fingers on a touch screen.
// Move:  drag the picture (only when zoomed in), Shift + arrow keys. A click that was really a drag does NOT measure.
// Readout: pixel, RA/Dec, offset from the centre of the field and the pixel value, under the pointer.

import { LAYERS, layerCounts, clampOpacity, moveLayer, opacityLabel } from "./layers.js";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, zoomLabel, fracToCanvas } from "./view.js";
import { describePoint, formatValue, readoutParts, levelsText } from "./readout.js";

const DRAG_PIXELS = 4;                           // a pointer must move this far (screen pixels) before it counts as a drag
const OWN_LAYERS = ["candidates", "marker", "grid", "scalebar"];   // layers whose switch the viewer wires (the others are wired in main.js: they fetch data)

export function setupViewer({ player, canvas, crosshair, zoomEls, readoutEls, layersRoot, getGeo, loadFloat = null, skyFn = undefined }) {
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
  // Aiming without a mouse: the CENTRE of the view is the place that is read out and measured. Zoom (+ and -) and move (Shift and the arrows) put the star there; Enter measures it, as a click would.
  const centreOfCanvas = () => { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  let sayTimer = 0;
  const showCentreReadout = () => {
    const c = centreOfCanvas();
    showReadout(c.x, c.y);
    if (!readoutEls.announce) return;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { const r = readoutEls; r.announce.textContent = `Centre of the view: ${r.pixel.textContent}; ${r.sky.textContent}; ${r.offset.textContent}${r.value.textContent ? `; ${r.value.textContent}` : ""}.`; }, 400);       // the last of a run of key presses is the one said
  };
  canvas.addEventListener("focus", () => { if (player.length) showCentreReadout(); });
  canvas.addEventListener("blur", () => hideReadout());
  canvas.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey || !player.length) return;
    e.preventDefault();
    const c = centreOfCanvas();
    canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y }));      // the same handler as a click: the mark, the measurement, the announcements
  });
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
    if (document.activeElement === canvas && ["+", "=", "-", "_", "0"].concat(e.shiftKey ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] : []).includes(e.key)) showCentreReadout();     // the readout follows the centre
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
    if (!player.showsOriginal) {                                  // the other modes show a combination of images: its display levels, said to be such
      const v = player.levelsAt(d.ix, d.iy);
      return v ? { text: levelsText(player.mode, v) } : null;
    }
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
    const d = describePoint(fx, fy, geo, skyFn);
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
  // ------------------------------------------------------------------ opacity and order of the layers
  // A second list under the switches: one row per layer, the front-most first, with an opacity slider and two buttons that move the layer one place.
  const orderRoot = layersRoot.querySelector("#layer-order");
  function renderLayerOrder(focus = null) {
    if (!orderRoot) return;
    orderRoot.textContent = "";
    const frontToBack = [...player.layerOrder].reverse();
    frontToBack.forEach((id, row) => {
      const layer = LAYERS.find((l) => l.id === id);
      const li = document.createElement("li");
      li.className = "layer-row";
      li.dataset.layer = id;
      const opacity = clampOpacity(player.layerOpacity[id] ?? 1);
      const key = Object.assign(document.createElement("span"), { className: "layer-key" });
      key.dataset.shape = layer.swatch; key.style.setProperty("--key", layer.color); key.setAttribute("aria-hidden", "true");
      const name = Object.assign(document.createElement("span"), { className: "layer-name", textContent: layer.label });
      const slider = Object.assign(document.createElement("input"), { type: "range", className: "layer-opacity", min: "0", max: "100", step: "5", value: String(Math.round(opacity * 100)) });
      slider.setAttribute("aria-label", `Opacity of ${layer.label}`);
      slider.setAttribute("aria-valuetext", opacityLabel(opacity));
      const pct = Object.assign(document.createElement("span"), { className: "layer-pct", textContent: opacityLabel(opacity) });
      slider.addEventListener("input", () => {
        const v = clampOpacity(Number(slider.value) / 100);
        player.setLayerOpacity(id, v);
        pct.textContent = opacityLabel(v);
        slider.setAttribute("aria-valuetext", opacityLabel(v));
      });
      const move = (toward, glyph, disabled) => {
        const b = Object.assign(document.createElement("button"), { type: "button", className: "layer-move", textContent: glyph, disabled });
        b.dataset.toward = toward;
        b.setAttribute("aria-label", `Move ${layer.label} toward the ${toward}`);
        b.addEventListener("click", () => { player.setLayerOrder(moveLayer(player.layerOrder, id, toward)); renderLayerOrder({ id, toward }); });
        return b;
      };
      li.append(key, name, slider, pct, move("front", "↑", row === 0), move("back", "↓", row === frontToBack.length - 1));
      orderRoot.append(li);
    });
    if (focus) {                                                  // the layer that was moved keeps the keyboard focus on the same button (or its twin at an end)
      const row = orderRoot.querySelector(`[data-layer="${focus.id}"]`);
      const b = row?.querySelector(`[data-toward="${focus.toward}"]:not(:disabled)`) ?? row?.querySelector(".layer-move:not(:disabled)");
      b?.focus();
    }
  }
  renderLayerOrder();

  player.onDraw = () => {
    updateCounts();
    if (lastPointer && gesture === null) showReadout(lastPointer.x, lastPointer.y);   // another frame under a resting pointer
  };

  /**
   * The readout strings (pixel, RA/Dec, offset) for an image fraction, the same as under the pointer, for the inspector's marked position.
   * No pixel value: it belongs to the image that was on screen when the pointer was there, and the picture changes under a mark.
   */
  function describeAt(fx, fy) {
    const geo = getGeo();
    if (!geo || !player.length) return null;
    return readoutParts(describePoint(fx, fy, geo, skyFn));
  }

  refresh();
  return { refresh, hideReadout, describeAt };
}
