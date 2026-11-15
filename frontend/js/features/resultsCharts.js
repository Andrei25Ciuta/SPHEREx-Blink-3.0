// resultsCharts.js – the charts and the numbers at the top of the Results page, all computed from the rows of the loaded file.
//
// Nothing here is typed in: a chart is built from the rows that have the numbers it needs, says how many rows it left out, and when no row has them it says so
// (an empty frame, never an invented one). Every chart comes with the same numbers as a real table, which is what a screen reader gets (the picture itself is
// aria-hidden). Plain HTML and CSS like the charts of the validation sections (no library, no <canvas>, no scaled SVG): text keeps its real size on a phone.
// Pure (they return strings and plain objects): scratch/test_results_file.mjs.

import { datasetStats } from "./resultsData.js";

const num = (v) => typeof v === "number" && Number.isFinite(v);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fixed = (v, d = 2) => (num(v) ? v.toFixed(d) : "–");
const short = (t, n = 42) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** "Nice" tick values between min and max (1, 2 or 5 times a power of ten). */
export function niceTicks(min, max, target = 4) {
  if (!(max > min)) return [min];
  const raw = (max - min) / target, mag = 10 ** Math.floor(Math.log10(raw)), norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out = [];
  for (let i = Math.ceil(min / step - 1e-9); i * step <= max + step * 1e-9; i++) out.push(+(i * step).toPrecision(12));
  return out;
}
const decimalsFor = (ticks) => { const s = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1; return s >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(s) - 1e-9)); };

// ---------------------------------------------------------------- the numbers

const MJD_UNIX = 40587;
const dateOfMjd = (mjd) => new Date((mjd - MJD_UNIX) * 86400000).toISOString().slice(0, 10);

/** The headline numbers of a dataset: [{ value, label }]. A number the file does not have is left out, not shown as 0. */
export function kpiList(ds) {
  const s = datasetStats(ds);
  const noun = ds.kind === "sources" ? "source" : ds.kind === "validation" ? "validation run" : "candidate";
  const list = [{ value: String(s.total), label: `${noun}${s.total === 1 ? "" : "s"} in this file` }];
  const detectors = [...new Set(Object.keys(s.detectors).flatMap((k) => k.split(" + ")))].sort();   // "D2 + D6" is two detectors
  if (detectors.length) list.push({ value: detectors.join(" + "), label: detectors.length === 1 ? "detector" : "detectors" });
  if (ds.kind === "sources") list.push({ value: String(ds.fields.length), label: ds.fields.length === 1 ? "sky field" : "sky fields" });
  if (s.fastest) list.push({ value: `${fixed(s.fastest.motion, s.fastest.motion < 10 ? 2 : 1)}″/yr`, label: `fastest: ${short(s.fastest.label)}` });
  if (num(s.medianMotion) && s.withMotion > 1) list.push({ value: `${fixed(s.medianMotion, 2)}″/yr`, label: `median motion of ${plural(s.withMotion, "record")}` });
  if (num(s.meanShare)) list.push({ value: `${Math.round(s.meanShare * 100)} %`, label: "of the images show a record, on average" });
  if (num(s.maxSigma)) list.push({ value: `${fixed(s.maxSigma, 1)} σ`, label: "highest motion significance" });
  if (s.withMatch) list.push({ value: `${s.withMatch} of ${s.total}`, label: "with a named object or catalogue match" });
  if (num(s.firstMjd)) list.push({ value: `${dateOfMjd(s.firstMjd)} – ${dateOfMjd(s.lastMjd)}`, label: "dates of the images behind the fits" });
  return list;
}

// ---------------------------------------------------------------- bars

/** Horizontal bars. rows: [{ label, value, text?, cls? }]; the longest bar fills the track. */
function barsBlock(rows, unit) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const body = rows.map((r) => `<div class="dbar-row"><span class="dbar-label">${esc(r.label)}</span><span class="dbar-track"><span class="dbar ${esc(r.cls || "")}" style="--w:${(100 * r.value / max).toFixed(1)}%"></span></span><span class="dbar-val">${esc(r.text ?? r.value)}</span></div>`).join("");
  return `<div class="dbars" aria-hidden="true">${body}</div>${unit ? `<p class="dchart-unit">${esc(unit)}</p>` : ""}`;
}

/** A real table under a chart (the same numbers, for screen readers and for copying). */
export function tableBlock(caption, headers, rows) {
  const head = headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("");
  return `<details class="rtable"><summary>Show the numbers as a table</summary><div class="rtable-scroll"><table><caption>${esc(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></details>`;
}

const SPEED_EDGES = [0, 1, 5, 10, 50, Infinity];
/** Counts of the records in speed bins (half-open, so a value on an edge is counted once). */
export function speedBins(rows) {
  const bins = SPEED_EDGES.slice(1).map((hi, i) => ({ label: Number.isFinite(hi) ? `${SPEED_EDGES[i]} to < ${hi}` : `≥ ${SPEED_EDGES[i]}`, count: 0 }));
  for (const r of rows) if (num(r.motion) && r.motion >= 0) bins[SPEED_EDGES.findIndex((e) => e > r.motion) - 1].count++;
  return bins;
}
const SHARE_BINS = [["fewer than half of the images", 0, 0.5], ["half to three quarters", 0.5, 0.75], ["three quarters to all but one", 0.75, 1], ["every image", 1, Infinity]];
/** Counts of the records by the share of images they were seen in. */
export function shareBins(rows) {
  const out = SHARE_BINS.map(([label]) => ({ label, count: 0 }));
  for (const r of rows) {
    if (!(r.images > 0)) continue;
    const f = r.detections / r.images;
    const i = f >= 1 ? 3 : f >= 0.75 ? 2 : f >= 0.5 ? 1 : 0;
    out[i].count++;
  }
  return out;
}
const countRows = (by) => Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

// ---------------------------------------------------------------- scatter and sky map (positioned HTML)

const GROUP_CLASSES = 6;
/** The group of a row for colour: its class (sources), its kind (candidates) or its detector. Stable order of first appearance. */
function groupsOf(rows) {
  const key = (r) => r.classLabel ?? r.kind ?? r.detector ?? "records";
  const order = [...new Set(rows.map(key))];
  return { key, order, cls: (g) => `g${Math.min(GROUP_CLASSES - 1, order.indexOf(g))}` };
}
const legendBlock = (groups) => (groups.order.length > 1 ? `<ul class="dlegend" aria-hidden="true">${groups.order.map((g) => `<li><span class="dkey ${groups.cls(g)}"></span>${esc(g)}</li>`).join("")}</ul>` : "");

/**
 * A plot of points on two axes. spec = { points: [{ id, label, x, y, group }], x: { domain, ticks, log, flip, title, unit }, y: { ... }, aspect }
 * The domain is in data units; the position of a point is a percentage of the plot box, so it needs no script to draw.
 */
export function scatterBlock(spec, groups) {
  const pos = (v, ax) => {
    const [a, b] = ax.domain;
    const f = ax.log ? (Math.log10(v) - Math.log10(a)) / (Math.log10(b) - Math.log10(a)) : (v - a) / (b - a);
    return Math.min(1, Math.max(0, ax.flip ? 1 - f : f)) * 100;
  };
  const d = (ax) => decimalsFor(ax.ticks);
  const xt = spec.x.ticks.map((t) => `<span class="dtick dtick-x" style="--p:${pos(t, spec.x).toFixed(2)}%">${esc(fixed(t, d(spec.x)))}</span>`).join("");
  const yt = spec.y.ticks.map((t) => `<span class="dtick dtick-y" style="--p:${pos(t, spec.y).toFixed(2)}%">${esc(fixed(t, d(spec.y)))}</span>`).join("");
  const gx = spec.x.ticks.map((t) => `<span class="dgrid dgrid-x" style="--p:${pos(t, spec.x).toFixed(2)}%"></span>`).join("");
  const gy = spec.y.ticks.map((t) => `<span class="dgrid dgrid-y" style="--p:${pos(t, spec.y).toFixed(2)}%"></span>`).join("");
  const pts = spec.points.map((p) => `<span class="dpt ${groups.cls(p.group)}" data-id="${esc(p.id)}" style="--x:${pos(p.x, spec.x).toFixed(2)}%;--y:${pos(p.y, spec.y).toFixed(2)}%" title="${esc(p.label)}"></span>`).join("");
  return `<div class="dscatter" aria-hidden="true"><div class="dsc-yaxis">${yt}</div><div class="dsc-plot" style="--aspect:${spec.aspect ?? 1.9}">${gx}${gy}${pts}</div><div class="dsc-corner"></div><div class="dsc-xaxis">${xt}</div></div>`
    + `<p class="dchart-unit">${esc(spec.x.title)} (across) · ${esc(spec.y.title)} (up)${spec.x.flip ? " · east is to the left" : ""}</p>${legendBlock(groups)}`;
}

const pad = (lo, hi, frac, min) => { const span = Math.max(hi - lo, min), p = span * frac, mid = (lo + hi) / 2; return [mid - span / 2 - p, mid + span / 2 + p]; };
const niceLogRange = (lo, hi) => [10 ** Math.floor(Math.log10(lo)), 10 ** Math.ceil(Math.log10(hi))];
const logTicks = (a, b) => { const t = []; for (let k = Math.round(Math.log10(a)); k <= Math.round(Math.log10(b)); k++) t.push(10 ** k); return t; };

/** The axes of the scatter: motion against significance when the file has both, else S/N against support. null when it has neither pair for two records. */
export function scatterSpec(rows) {
  const groups = groupsOf(rows);
  const pair = (xk, yk, filter = () => true) => rows.filter((r) => num(r[xk]) && num(r[yk]) && filter(r));
  const a = pair("motion", "sigma", (r) => r.motion > 0);
  if (a.length >= 2) {
    const xs = a.map((r) => r.motion), ys = a.map((r) => r.sigma);
    const xd = niceLogRange(Math.min(...xs) * 0.8, Math.max(...xs) * 1.25), yd = pad(Math.min(0, ...ys), Math.max(...ys), 0.08, 1);
    return { groups, used: a.length, skipped: rows.length - a.length, title: "Motion against its significance", spec: { points: a.map((r) => ({ id: r.id, label: `${r.label}: ${fixed(r.motion)} ″/yr, ${fixed(r.sigma, 1)} σ`, x: r.motion, y: r.sigma, group: groups.key(r) })),
      x: { domain: xd, ticks: logTicks(...xd), log: true, title: "Motion, arcsec per year (log)" }, y: { domain: yd, ticks: niceTicks(...yd, 4), title: "Significance, σ" } },
      table: { headers: ["Record", "Motion ″/yr", "Significance σ"], rows: a.map((r) => [r.label, fixed(r.motion, 3), fixed(r.sigma, 1)]) } };
  }
  const b = pair("snr", "support", (r) => r.snr > 0);
  if (b.length >= 2) {
    const xs = b.map((r) => r.snr);
    const xd = niceLogRange(Math.min(...xs) * 0.8, Math.max(...xs) * 1.25);
    return { groups, used: b.length, skipped: rows.length - b.length, title: "Support against signal-to-noise", spec: { points: b.map((r) => ({ id: r.id, label: `${r.label}: S/N ${fixed(r.snr, 1)}, support ${r.support}`, x: r.snr, y: r.support, group: groups.key(r) })),
      x: { domain: xd, ticks: logTicks(...xd), log: true, title: "Median signal-to-noise (log)" }, y: { domain: [0, 100], ticks: [0, 25, 50, 75, 100], title: "Support score, 0-100" } },
      table: { headers: ["Record", "S/N", "Support"], rows: b.map((r) => [r.label, fixed(r.snr, 1), String(r.support)]) } };
  }
  return null;
}

/** Where the records lie on the sky: right ascension across (east to the left), declination up, one degree of each drawn at the same length. null when no record has a position. */
export function skySpec(rows) {
  const groups = groupsOf(rows);
  const p = rows.filter((r) => num(r.ra) && num(r.dec));
  if (!p.length) return null;
  const meanDec = p.reduce((a, r) => a + r.dec, 0) / p.length, k = Math.max(0.05, Math.cos((meanDec * Math.PI) / 180));
  const xs = p.map((r) => r.ra * k), ys = p.map((r) => r.dec);
  const half = 0.5 / 60 / 2;                                              // no field is shown smaller than half an arcminute across
  let [x0, x1] = pad(Math.min(...xs), Math.max(...xs), 0.1, half * 2), [y0, y1] = pad(Math.min(...ys), Math.max(...ys), 0.1, half * 2);
  const w = x1 - x0, h = y1 - y0;
  if (w / h > 2.4) { const m = (y0 + y1) / 2; y0 = m - w / 4.8; y1 = m + w / 4.8; } else if (h / w > 1.4) { const m = (x0 + x1) / 2; x0 = m - h / 2.8; x1 = m + h / 2.8; }
  const raDomain = [x1 / k, x0 / k].sort((a, b) => a - b);
  return { groups, used: p.length, skipped: rows.length - p.length, title: "Where the records lie on the sky",
    spec: { points: p.map((r) => ({ id: r.id, label: `${r.label}: RA ${fixed(r.ra, 5)}°, Dec ${fixed(r.dec, 5)}°`, x: r.ra, y: r.dec, group: groups.key(r) })),
      x: { domain: raDomain, ticks: niceTicks(...raDomain, 3), flip: true, title: "Right ascension, degrees" }, y: { domain: [y0, y1], ticks: niceTicks(y0, y1, 3), title: "Declination, degrees" }, aspect: Math.min(2.4, Math.max(0.7, (x1 - x0) / (y1 - y0))) },
    table: { headers: ["Record", "RA °", "Dec °"], rows: p.map((r) => [r.label, fixed(r.ra, 5), fixed(r.dec, 5)]) } };
}

// ---------------------------------------------------------------- the set of charts of a dataset

/**
 * Every chart of the dashboard: [{ id, title, note, html, empty }]. `html` is null when the file lacks what the chart needs; `empty` then says what is missing.
 * A chart that used fewer rows than the file has says how many it left out.
 */
export function dashboardCharts(ds) {
  const rows = ds.rows;
  const out = [];
  const leftOut = (used) => (used < rows.length ? `${plural(rows.length - used, "record")} without these numbers left out.` : "");

  const speed = speedBins(rows), withSpeed = speed.reduce((a, b) => a + b.count, 0);
  out.push(withSpeed ? { id: "speed", title: "How fast the records move", note: leftOut(withSpeed),
    html: barsBlock(speed.map((b) => ({ label: `${b.label} ″/yr`, value: b.count, text: String(b.count) })), "Number of records in each range of angular speed, arcseconds per year") + tableBlock("Records by speed", ["Speed range ″/yr", "Records"], speed.map((b) => [b.label, String(b.count)])) }
    : { id: "speed", title: "How fast the records move", empty: "No record in this file has a measured motion." });

  const share = shareBins(rows), withShare = share.reduce((a, b) => a + b.count, 0);
  out.push(withShare ? { id: "seen", title: "In how many images each record was seen", note: leftOut(withShare),
    html: barsBlock(share.map((b) => ({ label: b.label, value: b.count, text: String(b.count) })), "Number of records by the share of the searched images in which a dot was found") + tableBlock("Records by share of images", ["Seen in", "Records"], share.map((b) => [b.label, String(b.count)])) }
    : { id: "seen", title: "In how many images each record was seen", empty: "The file does not say how many images were searched." });

  const stats = datasetStats(ds);
  const kinds = countRows(stats.kinds), dets = countRows(stats.detectors);
  const split = kinds.length > 1 ? { title: ds.kind === "sources" ? "What the sources are" : "Kinds of record", by: kinds, head: ds.kind === "sources" ? "Class" : "Kind" } : { title: "Records by detector", by: dets, head: "Detector" };
  out.push(split.by.length ? { id: "split", title: split.title, note: split.by === dets ? "" : "",
    html: barsBlock(split.by.map(([k, n], i) => ({ label: k, value: n, text: String(n), cls: `g${Math.min(GROUP_CLASSES - 1, i)}` })), "Number of records") + tableBlock(split.title, [split.head, "Records"], split.by.map(([k, n]) => [k, String(n)])) }
    : { id: "split", title: split.title, empty: "The file does not say." });

  const sc = scatterSpec(rows);
  out.push(sc ? { id: "scatter", title: sc.title, note: leftOut(sc.used), wide: true, html: scatterBlock(sc.spec, sc.groups) + tableBlock(sc.title, sc.table.headers, sc.table.rows) }
    : { id: "scatter", title: "Strength of the records", wide: true, empty: "Needs the motion and its significance, or the signal-to-noise and the support score, for at least two records." });

  const sky = skySpec(rows);
  out.push(sky ? { id: "sky", title: sky.title, note: leftOut(sky.used), html: scatterBlock(sky.spec, sky.groups) + tableBlock(sky.title, sky.table.headers, sky.table.rows) }
    : { id: "sky", title: "Where the records lie on the sky", empty: "No record in this file has a position." });
  // the wide plot in the middle, the two small cards share the last row
  return ["speed", "seen", "scatter", "split", "sky"].map((id) => out.find((c) => c.id === id));
}
