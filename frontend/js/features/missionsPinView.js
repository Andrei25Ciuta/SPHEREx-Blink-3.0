// missionsPinView.js – the DOM part of missions.js (the mission card) and pinBoard.js (the pin board with its sky map and the observer-name dialog).

import { missionWhy, termsFor, categoryInfo, stepWhy, xpFor, missionsDatabase, pickRandomMission, missionHref, loadProgress, saveProgress, markComplete, noteShown } from "./missions.js";
import { makePin, pinTag, loadPins, savePins, addPin, removePin, skyToMap, verifyPin, eclipticPoints, galacticToEquatorial, fieldOffsetArcmin, initials, timeAgo, decorativeStars, canPin } from "./pinBoard.js";
import { formatRA, formatDec } from "../coords.js";
import { sharedConfig, fetchSharedPins, pushSharedPin, mergePins } from "./pinSync.js";
import { PIN_BOARD_URL, PIN_BOARD_KEY } from "../config.js";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const $ = (id) => document.getElementById(id);
const store = (() => { try { return window.localStorage; } catch { return null; } })();
const fmt = (x, d) => (Number.isFinite(x) ? x.toFixed(d) : "–");

/** The mission card in Learn Mode: a random practical mission on every visit and on "Another random mission", with beginner explanations,
 *  plus the whole catalogue as topic cards; a mission tile previews that mission in the card. */
export function setupMissions() {
  const card = $("mission-card");
  if (!card) return null;
  let progress = loadProgress(store);
  let current = null;
  let openCat = null;
  const stars = (n) => "★".repeat(n) + "☆".repeat(3 - n);

  function renderCatalogue() {
    const box = $("mission-catalogue");
    if (!box) return;
    const groups = new Map();
    for (const m of missionsDatabase) (groups.get(m.category) ?? groups.set(m.category, []).get(m.category)).push(m);
    box.textContent = "";
    for (const [cat, list] of groups) {
      const done = list.filter((m) => progress.completed.includes(m.id)).length;
      const info = categoryInfo(list[0]);
      const topic = document.createElement("div");
      topic.className = "cm-topic" + (openCat === cat ? " is-open" : "");
      const head = document.createElement("button");
      head.type = "button";
      head.className = "cm-topic-head";
      head.setAttribute("aria-expanded", String(openCat === cat));
      head.innerHTML = `<span class="cm-topic-icon" aria-hidden="true">${info.icon}</span><span class="cm-topic-name">${esc(cat)}</span>
        <span class="cm-topic-count">${done}/${list.length}</span><span class="cm-topic-bar"><span style="width:${(100 * done / list.length).toFixed(0)}%"></span></span>`;
      head.addEventListener("click", () => { openCat = openCat === cat ? null : cat; renderCatalogue(); });
      topic.appendChild(head);
      if (openCat === cat) {
        const p = document.createElement("p");
        p.className = "cm-topic-intro";
        p.textContent = info.intro;
        const grid = document.createElement("div");
        grid.className = "cm-tiles";
        for (const m of list) {
          const t = document.createElement("button");
          t.type = "button";
          const isDone = progress.completed.includes(m.id);
          t.className = "cm-tile" + (isDone ? " is-done" : "") + (m.id === current?.id ? " is-current" : "");
          t.innerHTML = `<span class="cm-tile-title">${isDone ? "✓ " : ""}${esc(m.title)}</span><span class="cm-tile-meta">${stars(m.tier)} · ${m.steps.length} steps${m.needsReal ? " · real data" : ""}</span>`;
          t.addEventListener("click", () => { show(m); card.scrollIntoView({ behavior: "smooth", block: "start" }); });
          grid.appendChild(t);
        }
        topic.append(p, grid);
      }
      box.appendChild(topic);
    }
  }

  function show(m) {
    current = m;
    progress = noteShown(progress, m.id);
    saveProgress(store, progress);
    render();
  }

  function render() {
    const m = current;
    const done = progress.completed.includes(m.id);
    const info = categoryInfo(m);
    $("mission-icon").textContent = info.icon;
    $("mission-category").textContent = m.category;
    $("mission-meta").innerHTML = `<span title="Difficulty">${stars(m.tier)}</span><span>⏱ about ${Math.max(2, m.steps.length * 2)} min</span><span>+${xpFor(m)} XP</span>${m.needsReal ? "<span>needs real data</span>" : ""}${done ? "<span>✓ completed</span>" : ""}`;
    $("mission-title").textContent = m.title;
    $("mission-story").textContent = m.story;
    $("mission-intro").textContent = info.intro;
    $("mission-why").textContent = missionWhy(m);
    const terms = termsFor(m);
    const tbox = $("mission-terms");
    tbox.textContent = "";
    $("mission-term-def").textContent = terms.length ? "" : "No special words in this one.";
    for (const g of terms) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cm-term";
      b.textContent = g.term;
      b.addEventListener("click", () => {
        tbox.querySelectorAll(".cm-term").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        $("mission-term-def").innerHTML = `<strong>${esc(g.term)}:</strong> ${esc(g.simple)}`;
      });
      b.setAttribute("aria-pressed", "false");
      tbox.appendChild(b);
    }
    const ol = $("mission-steps-preview");
    ol.textContent = "";
    m.steps.forEach((st, i) => {
      const li = document.createElement("li");
      const why = stepWhy(st);
      li.innerHTML = `<span class="cm-step-n" aria-hidden="true">${i + 1}</span><span><strong>${esc(st.does)}</strong>${why ? `<small>${esc(why)}</small>` : ""}</span>`;
      ol.appendChild(li);
    });
    $("mission-feedback").hidden = !done;
    $("mission-feedback").textContent = `What you learned: ${m.successFeedback}`;
    $("mission-go").href = missionHref(m, location.search);
    $("mission-go").textContent = done ? "Play this mission again" : "Start this mission";
    $("cm-progress").textContent = `Missions completed: ${progress.completed.length} of ${missionsDatabase.length}`;
    $("cm-progress-bar").max = missionsDatabase.length;
    $("cm-progress-bar").value = progress.completed.length;
    renderCatalogue();
  }

  function loadRandom() {
    show(pickRandomMission(Math.random, [...progress.recent, ...progress.completed, current?.id].filter(Boolean)));
  }

  $("mission-random-btn").addEventListener("click", loadRandom);
  $("mission-reset-btn").addEventListener("click", () => {
    if (!confirm("Reset your Cosmic Missions progress on this device?")) return;
    progress = { completed: [], recent: [] };
    saveProgress(store, progress);
    render();
  });
  loadRandom();
  return { loadRandom };
}

/**
 * The pin board. getCandidate() returns the selected candidate ({ra, dec, label, ...}) or null; getContext() → { realData, field }.
 * Returns { refresh } so the page can enable the pin buttons when the selection changes.
 */
export function setupPinBoard({ getCandidate, getContext }) {
  if (!$("pin-board")) return null;
  const SVG = "http://www.w3.org/2000/svg";
  const W = 720, H = 360;
  let pins = loadPins(store);
  let view = "sky";
  const shared = sharedConfig(PIN_BOARD_URL, PIN_BOARD_KEY);
  let syncText = shared ? "Shared board: loading…" : "Pins are kept in this browser only.";
  let syncBad = false;
  let openId = null;
  const dialog = $("pin-dialog");
  const pinBtns = [$("pin-report-btn"), $("pin-board-pin-btn")].filter(Boolean);
  const svg = $("pin-map");
  const popup = $("pin-popup");
  const el = (tag, attrs = {}, parent = svg) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.appendChild(n); return n; };
  // zoom and pan: the map is drawn once in map units (W x H); the viewBox shows a part of it. Labels and pins keep their size on screen.
  let zoom = 1, cx = W / 2, cy = H / 2;
  const vb = () => { const w = W / zoom, h = H / zoom; const x = Math.min(Math.max(cx - w / 2, 0), W - w), y = Math.min(Math.max(cy - h / 2, 0), H - h); return { x, y, w, h }; };
  const text = (x, y, t, cls, anchor = "middle") => { const n = el("text", { x: 0, y: 0, transform: `translate(${x} ${y}) scale(${1 / zoom})`, class: cls, "text-anchor": anchor }); n.textContent = t; return n; };
  function applyView() {
    const v = vb(); cx = v.x + v.w / 2; cy = v.y + v.h / 2;
    svg.setAttribute("viewBox", `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
    const zl = $("pb-zoom-level"); if (zl) zl.textContent = `${zoom.toFixed(zoom < 2 ? 1 : 0)}×`;
  }
  function polyline(points, cls, extra = {}) {               // a path in RA/Dec, split where it wraps around RA 0h
    let d = "", prev = null;
    for (const [ra, dec] of points) { const p = project(ra, dec); d += (prev && Math.abs(p.x - prev.x) < W / 2 ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1); prev = p; }
    return el("path", { d, class: cls, ...extra });
  }

  let drawnField = "";
  function refresh() {
    const c = getCandidate(), allowed = canPin(c);
    for (const b of pinBtns) { b.disabled = !allowed.ok; b.title = allowed.ok ? "Pin this candidate to the shared Discovery Pin Board under your observer name" : allowed.reason; }
    const note = $("pin-known-note");
    if (note) { note.hidden = !c || allowed.ok; note.textContent = c && !allowed.ok ? `${allowed.reason}` : ""; }
    const f = JSON.stringify(getContext().field);            // redraw when the field on screen changes ("you are here")
    if (f !== drawnField) { drawnField = f; render(); }
  }

  // ---- projections: all sky (equirectangular, RA grows to the left) or the field on screen (arcminutes around its centre)
  function project(ra, dec) {
    if (view === "sky") { const { x, y } = skyToMap(ra, dec); return { x: x * W, y: y * H, inside: true }; }
    const f = getContext().field ?? {};
    const half = Math.max(1, (f.fov ?? 5)) * 0.75;           // arcmin from the centre to the top edge
    const k = (H / 2) / half;
    const o = fieldOffsetArcmin(ra, dec, f.ra ?? 0, f.dec ?? 0);
    const x = W / 2 - o.east * k, y = H / 2 - o.north * k;
    return { x, y, inside: x >= 0 && x <= W && y >= 0 && y <= H };
  }

  function drawBase() {
    svg.textContent = "";
    const defs = el("defs");
    defs.innerHTML = `<radialGradient id="pb-sky" cx="50%" cy="45%" r="75%"><stop offset="0" class="pb-sky-in"/><stop offset="1" class="pb-sky-out"/></radialGradient>
      <radialGradient id="pb-glow"><stop offset="0" class="pb-glow-in"/><stop offset="1" class="pb-glow-out"/></radialGradient>
      <filter id="pb-blur-wide" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
      <filter id="pb-blur" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>`;
    el("rect", { width: W, height: H, fill: "url(#pb-sky)" });
    for (const [x, y, r, o] of decorativeStars(view === "sky" ? 320 : 140, view === "sky" ? 7 : 11)) el("circle", { cx: x * W, cy: y * H, r: r / Math.sqrt(zoom), class: "pb-star", "fill-opacity": o });
    const f = getContext().field;
    if (view === "sky") {
      // the Milky Way: the galactic plane (b = 0) drawn as a soft glowing band (real positions, from the standard galactic rotation)
      const plane = (b) => Array.from({ length: 181 }, (_, i) => galacticToEquatorial(i * 2, b));
      polyline(plane(0), "pb-milkyway-wide", { filter: "url(#pb-blur-wide)" });
      polyline(plane(0), "pb-milkyway", { filter: "url(#pb-blur)" });
      for (const b of [-6, 6]) polyline(plane(b), "pb-milkyway-edge", { filter: "url(#pb-blur)" });
      const gc = project(...galacticToEquatorial(0, 0));
      el("circle", { cx: gc.x, cy: gc.y, r: 10, class: "pb-gc", filter: "url(#pb-blur)" });
      text(gc.x, gc.y + 22 / zoom, "Galactic centre", "pb-label pb-gc-label");
      const ac = project(...galacticToEquatorial(150, 0));
      text(ac.x, ac.y - 12 / zoom, "Milky Way", "pb-label pb-mw-label");
      const v = vb(), stepH = zoom >= 4 ? 1 : 2, stepD = zoom >= 4 ? 10 : 30;
      for (let h = 0; h < 24; h += stepH) { const x = (1 - h / 24) * W; el("line", { x1: x, y1: 0, x2: x, y2: H, class: "pb-grid" }); if (h) text(x, v.y + 16 / zoom, `${h}h`, "pb-label"); }
      for (let d = -90 + stepD; d < 90; d += stepD) { const y = (90 - d) / 180 * H; el("line", { x1: 0, y1: y, x2: W, y2: y, class: d ? "pb-grid" : "pb-equator" }); text(v.x + 6 / zoom, y - 4 / zoom, `${d > 0 ? "+" : ""}${d}°`, "pb-label", "start"); }
      polyline(eclipticPoints(), "pb-ecliptic");
      const ep = project(...eclipticPoints(5)[12]);
      text(ep.x, ep.y - 6 / zoom, "ecliptic", "pb-label pb-ecl-label");
      if (f && Number.isFinite(f.ra)) { const p = project(f.ra, f.dec); const g = el("g", { class: "pb-here", transform: `translate(${p.x} ${p.y}) scale(${1 / zoom})` }); el("circle", { r: 9 }, g); el("path", { d: "M-14 0H-5M5 0H14M0 -14V-5M0 5V14" }, g); text(p.x, p.y - 16 / zoom, "you are here", "pb-label pb-here-label"); }
    } else {
      const half = Math.max(1, (f?.fov ?? 5)) * 0.75, k = (H / 2) / half;
      for (let a = -Math.floor(half * 2); a <= half * 2; a++) { const x = W / 2 + a * k, y = H / 2 + a * k; el("line", { x1: x, y1: 0, x2: x, y2: H, class: a ? "pb-grid" : "pb-equator" }); if (y >= 0 && y <= H) el("line", { x1: 0, y1: y, x2: W, y2: y, class: a ? "pb-grid" : "pb-equator" }); }
      const s = (f?.fov ?? 5) * k;
      el("rect", { x: W / 2 - s / 2, y: H / 2 - s / 2, width: s, height: s, class: "pb-fieldbox" });
      text(W / 2, H / 2 - s / 2 - 6, `field on screen · ${f?.fov ?? 5}′ wide · grid every 1′`, "pb-label");
      text(14, H / 2 - 4, "E", "pb-label pb-compass"); text(W - 14, H / 2 - 4, "W", "pb-label pb-compass"); text(W / 2, 14, "N", "pb-label pb-compass");
    }
  }

  function drawPins() {
    let outside = 0;
    for (const p of pins) {
      const q = project(p.ra, p.dec);
      if (!q.inside) { outside++; continue; }
      const g = el("g", { class: "pin-marker" + (p.dataKind === "synthetic" ? " is-synthetic" : "") + (p.id === openId ? " is-open" : ""), transform: `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) scale(${(1 / zoom).toFixed(3)})`, tabindex: 0, role: "button", "data-id": p.id, "aria-label": `${pinTag(p)}, RA ${formatRA(p.ra)}, Dec ${formatDec(p.dec)}` });
      el("circle", { r: 16, fill: "url(#pb-glow)", class: "pb-halo" }, g);
      el("circle", { r: 7, class: "pb-pulse" }, g);
      el("path", { d: "M0 0 C-3 -6 -9 -9 -9 -15 A9 9 0 1 1 9 -15 C9 -9 3 -6 0 0Z", class: "pb-drop" }, g);
      const t = el("text", { x: 0, y: -12.5, class: "pb-initials", "text-anchor": "middle" }, g); t.textContent = initials(p.observer);
    }
    if (view === "field" && outside) text(W - 10, H - 10, `${outside} pin${outside > 1 ? "s" : ""} outside this field`, "pb-label", "end");
  }

  function chips(p) {
    const c = [];
    if (p.speedArcsecPerYear != null) c.push(`☄️ ${fmt(p.speedArcsecPerYear, 2)}″/yr`);
    if (p.checks?.detections != null) c.push(`✓ seen in ${p.checks.detections}/${p.checks.images} images`);
    if (p.checks?.knownObject) c.push(`known: ${p.checks.knownObject}`);
    c.push(p.dataKind === "synthetic" ? "synthetic demo" : "real data");
    return c.map((t) => `<span class="pb-chip">${esc(t)}</span>`).join("");
  }
  function fieldLink(p) {
    const f = p.field ?? {};
    const q = new URLSearchParams(location.search);
    q.set("ra", (f.ra ?? p.ra).toFixed(5)); q.set("dec", (f.dec ?? p.dec).toFixed(5)); if (f.fov) q.set("fov", f.fov); if (f.det) q.set("det", f.det); q.delete("mission");
    return `index.html?${q}`;
  }
  function cardHtml(p) {
    return `<div class="pb-card-head"><span class="pb-avatar" aria-hidden="true">${esc(initials(p.observer))}</span>
      <div><strong>${esc(pinTag(p))}</strong><span class="pb-when">${esc(p.label ?? "candidate")} · ${esc(timeAgo(p.foundAt))} · ${esc(new Date(p.foundAt).toLocaleString())}</span></div></div>
      <p class="pb-coords"><span>RA <b>${esc(formatRA(p.ra))}</b></span><span>Dec <b>${esc(formatDec(p.dec))}</b></span><span class="muted">(${fmt(p.ra, 5)}°, ${fmt(p.dec, 5)}°)</span></p>
      <p class="pb-chips">${chips(p)}</p>
      <p class="pb-hash"><code title="${esc(p.hash)}">SHA-256 ${esc(p.hash.slice(0, 16))}…${esc(p.hash.slice(-6))}</code> <span class="pb-verify" data-verify="${esc(p.id)}">checking…</span></p>`;
  }
  function verifyInto(root) {
    for (const v of root.querySelectorAll("[data-verify]")) {
      const p = pins.find((x) => x.id === v.dataset.verify);
      if (p) verifyPin(p).then((ok) => { v.textContent = ok ? "✓ hash checks out" : "⚠ hash does not match (edited?)"; v.classList.toggle("is-bad", !ok); });
    }
  }

  function showPopup() {
    const p = pins.find((x) => x.id === openId);
    const q = p && project(p.ra, p.dec);
    if (!p || !q.inside) { popup.hidden = true; return; }
    popup.innerHTML = `<button type="button" class="pb-close" data-act="close" aria-label="Close">×</button>${cardHtml(p)}
      <p class="pb-popup-actions"><a class="btn btn-small" href="${esc(fieldLink(p))}">Open this field</a> <button type="button" class="btn btn-small" data-act="copy">Copy hash</button></p>`;
    popup.hidden = false;
    if (getComputedStyle(popup).position !== "absolute") { popup.style.left = popup.style.top = ""; verifyInto(popup); return; }
    const box = svg.getBoundingClientRect(), v = vb(), sx = box.width / v.w, sy = box.height / v.h;
    const px = (q.x - v.x) * sx, py = (q.y - v.y) * sy;
    if (px < 0 || px > box.width || py < 0 || py > box.height) { popup.hidden = true; return; }
    const left = Math.min(Math.max(8, px - popup.offsetWidth / 2), box.width - popup.offsetWidth - 8);
    const above = py - 30 - popup.offsetHeight;
    popup.style.left = `${left}px`;
    popup.style.top = `${above > 4 ? above : py + 14}px`;
    verifyInto(popup);
  }

  async function sync() {
    if (!shared) return;
    try {
      for (const p of pins.filter((x) => x.pending)) { await pushSharedPin(shared, p); p.pending = false; }
      const { pins: remote, dropped } = await fetchSharedPins(shared);
      pins = mergePins(pins.filter((p) => !p.shared || remote.some((r) => r.hash === p.hash)), remote);
      savePins(store, pins);
      const people = new Set(remote.map((p) => p.observer)).size;
      syncText = `Shared board: ${remote.length} pin${remote.length === 1 ? "" : "s"} from ${people} observer${people === 1 ? "" : "s"}, seen by everyone who opens this site. Updated ${new Date().toLocaleTimeString()}.` + (dropped ? ` ${dropped} record(s) failed their hash check and are not shown.` : "");
      syncBad = false;
    } catch (err) {
      syncText = `⚠ The shared board cannot be reached (${err.message}) Your pins are kept in this browser and will be sent when it answers again.`;
      syncBad = true;
    }
    render();
  }

  function render() {
    applyView();
    drawBase();
    drawPins();
    const list = $("pin-list");
    list.textContent = "";
    $("pin-empty").hidden = pins.length > 0;
    const observers = new Set(pins.map((p) => p.observer));
    $("pin-stats").innerHTML = `<span class="pb-stat"><b>${pins.length}</b> pin${pins.length === 1 ? "" : "s"}</span><span class="pb-stat"><b>${observers.size}</b> observer${observers.size === 1 ? "" : "s"}</span>`;
    $("pin-sync").textContent = syncText;
    $("pin-sync").parentElement.classList.toggle("is-bad", syncBad);
    $("pin-refresh-btn").hidden = !shared;
    $("pin-clear-btn").hidden = Boolean(shared);
    for (const p of pins) {
      const li = document.createElement("li");
      li.className = "pin-item" + (p.id === openId ? " is-open" : "");
      li.innerHTML = cardHtml(p) + `<p class="pb-popup-actions"><button type="button" class="btn btn-small" data-act="locate" data-id="${esc(p.id)}">Show on map</button> <a class="btn btn-small" href="${esc(fieldLink(p))}">Open this field</a> ${p.shared ? `<span class="pb-chip">shared · permanent</span>` : p.pending ? `<span class="pb-chip">waiting to be sent</span>` : `${shared ? `<button type="button" class="btn btn-small btn-primary" data-act="share" data-id="${esc(p.id)}">Share with everyone</button> ` : ""}<span class="pb-chip">only in this browser</span> <button type="button" class="btn btn-small" data-act="remove" data-id="${esc(p.id)}">Remove</button>`}</p>`;
      list.appendChild(li);
    }
    verifyInto(list);
    showPopup();
  }

  // ---- events
  let drag = null, dragged = false;
  svg.addEventListener("click", (e) => { if (dragged) { dragged = false; return; } const g = e.target.closest(".pin-marker"); openId = g ? (g.dataset.id === openId ? null : g.dataset.id) : null; render(); });
  const toMap = (e) => { const r = svg.getBoundingClientRect(), v = vb(); return { x: v.x + (e.clientX - r.left) / r.width * v.w, y: v.y + (e.clientY - r.top) / r.height * v.h }; };
  svg.addEventListener("pointerdown", (e) => { if (zoom > 1 && !e.target.closest(".pin-marker")) { drag = { x: e.clientX, y: e.clientY, cx, cy }; svg.setPointerCapture(e.pointerId); } });
  svg.addEventListener("pointermove", (e) => {
    const m = toMap(e), out = $("pb-readout");
    if (out) out.textContent = view === "sky" ? `RA ${formatRA((1 - m.x / W) * 360)} · Dec ${formatDec(90 - m.y / H * 180)}` : "";
    if (!drag) return;
    const r = svg.getBoundingClientRect(), v = vb();
    const dx = (e.clientX - drag.x) / r.width * v.w, dy = (e.clientY - drag.y) / r.height * v.h;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) dragged = true;
    cx = drag.cx - dx; cy = drag.cy - dy; applyView(); if (!popup.hidden) showPopup();
  });
  svg.addEventListener("pointerup", () => { if (drag && dragged) render(); drag = null; });
  svg.addEventListener("pointerleave", () => { const out = $("pb-readout"); if (out) out.textContent = "Move over the map to read RA and Dec. Zoom with + / − (or Ctrl + scroll), drag to move."; });
  function zoomTo(z, at) {
    const nz = Math.min(16, Math.max(1, z));
    if (at) { cx = at.x + (cx - at.x) * zoom / nz; cy = at.y + (cy - at.y) * zoom / nz; }
    zoom = nz; render();
  }
  svg.addEventListener("wheel", (e) => { if (!(e.ctrlKey || e.metaKey || document.fullscreenElement)) return; e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.25 : 0.8), toMap(e)); }, { passive: false });
  document.querySelectorAll("[data-pb-zoom]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.pbZoom;
    if (a === "in") zoomTo(zoom * 1.5); else if (a === "out") zoomTo(zoom / 1.5); else { zoom = 1; cx = W / 2; cy = H / 2; render(); }
  }));
  $("pb-fullscreen")?.addEventListener("click", () => {
    const wrap = svg.closest(".pb-map-wrap");
    if (document.fullscreenElement) document.exitFullscreen?.(); else wrap.requestFullscreen?.().catch(() => wrap.classList.toggle("is-expanded"));
  });
  document.addEventListener("fullscreenchange", () => { $("pb-fullscreen").textContent = document.fullscreenElement ? "✕ Exit full screen" : "Full screen"; if (!popup.hidden) showPopup(); });
  svg.addEventListener("keydown", (e) => { const g = e.target.closest(".pin-marker"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openId = g.dataset.id; render(); } });
  popup.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") { openId = null; render(); }
    if (act === "copy") { const p = pins.find((x) => x.id === openId); navigator.clipboard?.writeText(p.hash).then(() => { $("pin-status").textContent = "Hash copied."; }, () => {}); }
  });
  $("pin-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "share") {
      const p = pins.find((x) => x.id === b.dataset.id);
      if (!p || !confirm(`Share this pin with everyone? “${pinTag(p)}” and its position become public and permanent.`)) return;
      p.pending = true; savePins(store, pins);
      $("pin-status").textContent = "Sending the pin to the shared board…";
      sync().then(() => { $("pin-status").textContent = p.pending ? "The shared board did not answer; the pin will be sent later." : `Shared with everyone: ${pinTag(p)}.`; });
      return;
    }
    if (b.dataset.act === "remove") { pins = removePin(pins, b.dataset.id); if (openId === b.dataset.id) openId = null; savePins(store, pins); render(); }
    if (b.dataset.act === "locate") {
      openId = b.dataset.id;
      const p = pins.find((x) => x.id === openId);
      if (view === "field" && !project(p.ra, p.dec).inside) setView("sky");
      const q = project(p.ra, p.dec); cx = q.x; cy = q.y; if (view === "sky") zoom = Math.max(zoom, 4);
      render(); svg.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
  function setView(v) {
    view = v; zoom = 1; cx = W / 2; cy = H / 2;
    document.querySelectorAll(".pb-view").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  }
  document.querySelectorAll(".pb-view").forEach((b) => b.addEventListener("click", () => { setView(b.dataset.view); render(); }));
  window.addEventListener("resize", () => { if (!popup.hidden) showPopup(); });

  function openDialog() {
    const c = getCandidate();
    if (!canPin(c).ok) return;
    const ctx = getContext();
    $("pin-preview").innerHTML = `<p class="pb-coords"><span>RA <b>${esc(formatRA(c.ra))}</b></span><span>Dec <b>${esc(formatDec(c.dec))}</b></span></p>
      <p class="pb-chips">${chips({ ...c, checks: { detections: c.nDet, images: c.nFrames, knownObject: c.known }, dataKind: ctx.realData ? "real" : "synthetic" })}</p>
      <p class="small muted">Your observer name and this position will be <strong>public and permanent</strong> on the shared board. Time of the report: now (${esc(new Date().toLocaleString())}). The pin gets a SHA-256 hash of its own text.</p>`;
    $("pin-name-error").textContent = "";
    try { $("pin-name").value = store?.getItem("spherex-blink-observer") ?? ""; } catch {}
    dialog.showModal();
    $("pin-name").focus();
  }
  for (const b of pinBtns) b.addEventListener("click", openDialog);
  $("pin-cancel").addEventListener("click", () => dialog.close());
  $("pin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const pin = await makePin(getCandidate(), { observer: $("pin-name").value, ...getContext() });
      if (shared) pin.pending = true;
      pins = addPin(pins, pin);
      try { store?.setItem("spherex-blink-observer", pin.observer); } catch {}
      savePins(store, pins);
      $("pin-status").textContent = shared ? `Pinned: ${pinTag(pin)}. Sending it to the shared board…` : `Pinned: ${pinTag(pin)}.`;
      if (shared) sync().then(() => { $("pin-status").textContent = pin.pending ? `${pinTag(pin)} is saved here; it will be shared when the board answers.` : `Shared with everyone: ${pinTag(pin)}. It stays on the board permanently.`; });
      dialog.close();
      openId = pin.id;
      if (view === "field" && !project(pin.ra, pin.dec).inside) setView("sky");
      render();
      $("pin-board").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      $("pin-name-error").textContent = err.message;
    }
  });
  $("pin-clear-btn").addEventListener("click", () => {
    if (!pins.length || !confirm(`Remove all ${pins.length} pins from this browser?`)) return;
    pins = []; openId = null; savePins(store, pins); render();
  });

  render();
  refresh();
  // the shared board is asked only once the pin board is on screen (the synthetic demo contacts no other host until then), then every minute
  if (shared) {
    let started = false;
    const start = () => { if (started) return; started = true; sync(); setInterval(() => { if (!document.hidden) sync(); }, 60000); };
    if (navigator.webdriver) syncText = "Shared board not loaded automatically in an automated browser (tests stay offline). Press Refresh to load it.";
    else if ("IntersectionObserver" in window) new IntersectionObserver((entries, obs) => { if (entries.some((e) => e.isIntersecting)) { obs.disconnect(); start(); } }).observe($("pin-board"));
    else start();
    $("pin-refresh-btn")?.addEventListener("click", () => { if (started) sync(); else start(); });
    for (const b of pinBtns) b.addEventListener("click", start);
  }
  return { refresh, render };
}
