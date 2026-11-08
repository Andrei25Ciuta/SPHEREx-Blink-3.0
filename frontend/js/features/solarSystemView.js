// solarSystemView.js – the page part of the Solar System simulator (the maths is in solarSystem.js, tested with Node against JPL Horizons).
//
//   const sim = setupSolarSystem({ els, getField });   // getField() -> { ra, dec, mjds } of the images on screen, or null
//   sim.refresh();                                     // call it when the images change: the dates of the survey passes and the direction of the field follow
//
// A top-down view of the ecliptic plane. Two modes, named for what they are:
//   SCIENTIFIC   true scale (linear in AU), the planets where the elements put them (checked against JPL Horizons), the Earth of the parallax search;
//   EDUCATIONAL  the distances are compressed (square root) so that all the planets can be seen at once, and the planets are drawn larger than any scale would allow: NOT TO SCALE, said on the picture.
// A distant body can be added in the direction of the field on screen, with the lines of sight from the Earth on the dates of the survey passes: the angle between them is the parallax
// that the Planet X search measures.

import { PLANETS, RANGES_AU, position, periodYears, bodyAt, screenRadius, mjdLabel, earthPosition } from "./solarSystem.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); e.append(...kids); return e; };
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

const DEFAULT_RANGE = [60800, 61500];                                 // when there are no images: Apr 2025 to Mar 2027

export function setupSolarSystem({ els, getField }) {
  let timer = null;
  const mode = () => els.modes.find((r) => r.checked)?.value ?? "true";
  const maxAU = () => RANGES_AU.find((r) => r.id === els.range.value)?.maxAU ?? 6;
  const mjd = () => Number(els.date.value);

  function bounds() {
    const f = getField();
    if (f?.mjds?.length) return [Math.floor(Math.min(...f.mjds)) - 60, Math.ceil(Math.max(...f.mjds)) + 60];
    return DEFAULT_RANGE;
  }

  function draw() {
    const m = mode(), R = maxAU(), t = mjd(), field = getField();
    const toScreen = (p) => { const r = Math.hypot(p[0], p[1]); if (r === 0) return [0, 0]; const s = screenRadius(m, r, R); return [(p[0] / r) * s, -(p[1] / r) * s]; };
    const inside = (p) => Math.hypot(p[0], p[1]) <= R * 1.0001;
    const svg = svgEl("svg", { viewBox: "-1.12 -1.12 2.24 2.24", class: "ss-svg", role: "img",
      "aria-label": `The Solar System seen from the north pole of the ecliptic on ${mjdLabel(t)}, ${m === "true" ? "to scale" : "not to scale"}, as far as ${R} AU. The table below has the positions.` });
    svg.append(svgEl("circle", { cx: 0, cy: 0, r: 1, class: "ss-edge" }));
    for (const f of [0.25, 0.5, 0.75]) svg.append(svgEl("circle", { cx: 0, cy: 0, r: f, class: "ss-ring" }));
    const ringLabel = (f) => { const au = m === "true" ? f * R : f * f * R; return `${au >= 10 ? au.toFixed(0) : au.toFixed(1)} AU`; };
    for (const f of [0.5, 1]) svg.append(svgEl("text", { x: 0.02, y: -f + 0.07, class: "ss-label" }, ringLabel(f)));
    // the orbits: where each planet is over one period starting on this date
    for (const name of PLANETS) {
      const P = periodYears(name) * 365.25, pts = [];
      for (let i = 0; i <= 120; i++) { const p = position(name, t + (i / 120) * P); if (inside(p)) pts.push(toScreen(p)); else pts.push(null); }
      let d = "", pen = false;
      for (const q of pts) { if (!q) { pen = false; continue; } d += `${pen ? "L" : "M"}${q[0].toFixed(4)},${q[1].toFixed(4)}`; pen = true; }
      if (d) svg.append(svgEl("path", { d, class: `ss-orbit${name === "Earth" ? " is-earth" : ""}` }));
    }
    svg.append(svgEl("circle", { cx: 0, cy: 0, r: m === "true" ? 0.018 : 0.04, class: "ss-sun" }));
    const rows = [];
    for (const name of PLANETS) {
      const p = position(name, t), r = Math.hypot(p[0], p[1], p[2]);
      rows.push({ name, r, lon: ((Math.atan2(p[1], p[0]) * 180) / Math.PI + 360) % 360, shown: inside(p) });
      if (!inside(p)) continue;
      const [x, y] = toScreen(p);
      svg.append(svgEl("circle", { cx: x, cy: y, r: m === "true" ? 0.014 : name === "Earth" ? 0.038 : 0.028, class: `ss-planet${name === "Earth" ? " is-earth" : ""}` }),
        svgEl("text", { x: x + 0.045, y: y - 0.03, class: "ss-name" }, name));
    }
    // the Earth on the dates of the survey passes, and a distant body in the direction of the field
    let swingText = "";
    if (field?.mjds?.length) {
      const passDates = [...new Set(field.mjds.map((v) => Math.round(v)))].sort((a, b) => a - b);
      const first = passDates[0];
      if (els.body.checked && Number.isFinite(Number(els.distance.value)) && Number(els.distance.value) > 0) {
        const d = Number(els.distance.value), b = bodyAt(first, field.ra, field.dec, d), toward = (p) => (inside(p) ? toScreen(p) : null);
        const edge = (() => { const n = [b.body[0] - earthPosition(first)[0], b.body[1] - earthPosition(first)[1]]; const l = Math.hypot(...n) || 1; return [(n[0] / l) * 0.97, -(n[1] / l) * 0.97]; })();
        const bs = toward(b.body) ?? edge;
        const picked = [];
        for (const day of passDates) if (!picked.some((q) => Math.abs(q - day) < 20)) picked.push(day);       // one Earth per survey pass (images of a pass are days apart)
        for (const day of picked) {
          const e = earthPosition(day);
          if (!inside(e)) continue;
          const [ex, ey] = toScreen(e);
          svg.append(svgEl("line", { x1: ex, y1: ey, x2: bs[0], y2: bs[1], class: "ss-sight" }), svgEl("circle", { cx: ex, cy: ey, r: 0.018, class: "ss-earth-date" }));
        }
        svg.append(svgEl("path", { d: `M${bs[0] - 0.03},${bs[1]} h0.06 M${bs[0]},${bs[1] - 0.03} v0.06`, class: "ss-body" }),
          svgEl("text", { x: Math.max(-0.95, Math.min(0.55, bs[0] + 0.04)), y: bs[1] - 0.04, class: "ss-name" }, inside(b.body) ? `body at ${d} AU` : `toward the field: ${d} AU away`));
        const swings = picked.map((day) => b.swingArcsec(day));
        const biggest = Math.max(...swings);
        swingText = `A body ${d} AU away in the direction of the field (RA ${field.ra.toFixed(2)}°, Dec ${field.dec.toFixed(2)}°) is seen from the Earth of ${picked.length} survey pass${picked.length === 1 ? "" : "es"} (${picked.map(mjdLabel).join(", ")}) ` +
          `in directions that differ by up to ${biggest >= 60 ? `${(biggest / 60).toFixed(1)} arcmin` : `${biggest.toFixed(0)} arcsec`}: that swing is what the Planet X search measures.`;
      }
    }
    els.map.replaceChildren(svg);
    els.dateLabel.textContent = mjdLabel(t);
    els.date.setAttribute("aria-valuetext", mjdLabel(t));
    els.swing.textContent = swingText;
    els.table.replaceChildren(el("caption", { className: "sr-only", textContent: `Positions of the planets on ${mjdLabel(t)}.` }),
      el("thead", {}, el("tr", {}, ...["Planet", "Distance from the Sun (AU)", "Ecliptic longitude (°)", "Period (years)", "In this view"].map((h) => el("th", { scope: "col", textContent: h })))),
      el("tbody", {}, ...rows.map((r) => el("tr", {}, el("th", { scope: "row", textContent: r.name }), el("td", { className: "num", textContent: r.r.toFixed(3) }), el("td", { className: "num", textContent: r.lon.toFixed(1) }),
        el("td", { className: "num", textContent: periodYears(r.name).toFixed(2) }), el("td", { textContent: r.shown ? "shown" : `beyond ${R} AU` })))));
    els.modeNote.textContent = m === "true"
      ? "Scientific mode: true scale (linear in AU). The planets are put where the Keplerian elements of JPL's approximate-position table place them (checked against JPL Horizons: VALIDATION 17); the Earth is the one the parallax search uses. Dots are far larger than the planets."
      : "Educational mode: NOT TO SCALE. Distances from the Sun are compressed (square root) so that all the planets can be seen at once, and the planets are drawn bigger than they are. The directions are the true ones.";
  }

  function setBounds() {
    const [lo, hi] = bounds();
    const keep = Number(els.date.value);
    els.date.min = String(lo); els.date.max = String(hi);
    els.date.value = String(Number.isFinite(keep) && keep >= lo && keep <= hi ? keep : Math.round((lo + hi) / 2));
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } els.playBtn.textContent = "Play"; els.playBtn.setAttribute("aria-pressed", "false"); }
  function play() {
    if (timer) { stop(); return; }
    els.playBtn.textContent = "Pause"; els.playBtn.setAttribute("aria-pressed", "true");
    timer = setInterval(() => { const next = mjd() + Number(els.speed.value); els.date.value = String(next > Number(els.date.max) ? els.date.min : next); draw(); }, 80);
  }

  for (const r of els.modes) r.addEventListener("change", draw);
  for (const c of [els.range, els.body, els.distance, els.date, els.speed]) c.addEventListener("input", draw);
  els.playBtn.addEventListener("click", play);
  if (matchMedia?.("(prefers-reduced-motion: reduce)").matches) els.speed.value = "1";
  setBounds(); draw();
  return { refresh: () => { stop(); setBounds(); draw(); } };
}
