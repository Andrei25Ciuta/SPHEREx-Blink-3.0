// results.js – the "Real-data results" page (results.html): draws every chart from data/real_results.json.
//
// Only derived numbers are shown (no pixels, no images). The charts are plain HTML + CSS (no library, no <canvas>, no big SVG
// scaled down): text keeps its real size on a phone, a row's label wraps above its track, and the same numbers are
// repeated in a real table under each chart for screen readers. The builders below are pure functions (they return
// strings), so scratch/test_results.mjs tests them without a browser.

import { createExplorer } from "./features/candidateExplorerView.js";
import { provenanceText, missingProvenance } from "./features/provenance.js";
import { setupExplorer } from "./features/resultsExplorer.js";
import { readResultsFile, validationDataset, MAX_FILE_BYTES } from "./features/resultsData.js";
import { dashboardCharts, kpiList } from "./features/resultsCharts.js";

// ---------- small pure helpers ----------

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** "Nice" tick values between min and max (about `target` of them): 1, 2, 5 times a power of ten. */
export function niceTicks(min, max, target = 5) {
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out = [];
  for (let i = Math.ceil(min / step - 1e-9); i * step <= max + step * 1e-9; i++) out.push(+(i * step).toPrecision(12));
  return out;
}

/** Where a value sits on a track, in percent of its width (clamped to 0-100), and whether it fell off the scale (-1 / 0 / +1). */
export function place(v, domain, log = false) {
  const [a, b] = domain;
  const f = log ? (Math.log10(v) - Math.log10(a)) / (Math.log10(b) - Math.log10(a)) : (v - a) / (b - a);
  const pct = f * 100;
  return { pct: Math.min(100, Math.max(0, pct)), off: pct < 0 ? -1 : pct > 100 ? 1 : 0 };
}

/**
 * Spread points that would overlap over several lanes: each point goes to the first lane whose last point is at
 * least `gapPct` away. Returns { lanes: lane of each input value (same order), count }.
 */
export function assignLanes(values, domain, gapPct = 2.2, log = false, maxLanes = 4) {
  const order = values.map((v, i) => ({ i, pct: place(v, domain, log).pct })).sort((p, q) => p.pct - q.pct);
  const last = [];
  const lanes = new Array(values.length).fill(0);
  for (const { i, pct } of order) {
    let lane = last.findIndex((l) => pct - l >= gapPct);
    if (lane < 0) lane = last.length < maxLanes ? last.length : last.indexOf(Math.min(...last));
    last[lane] = pct;
    lanes[i] = lane;
  }
  return { lanes, count: Math.max(1, last.length) };
}

const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
/** 2e-21 -> "2×10⁻²¹"; numbers from 0.1 up are written as they are ("17"). */
export function fmtChance(v) {
  if (v >= 0.1) return String(+v.toPrecision(3));
  const [m, e] = v.toExponential(0).split("e");
  return `${m}×10${[...String(Number(e))].map((c) => SUP[c]).join("")}`;
}
/** 10^k as "10⁻²⁰" for an axis label. */
export const fmtPow10 = (k) => (k === 0 ? "1" : `10${[...String(k)].map((c) => SUP[c]).join("")}`);
export const fixed = (v, d = 2) => (v === null || v === undefined ? "–" : Number(v).toFixed(d));
const signed = (v, d = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;

/** "makemake.fitAU" -> data.makemake.fitAU (undefined when something on the way is missing). */
export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}
/** Format a value for the prose of the page: spec = "fixed:2" | "int" | "chance" | "pct:0" | "signed:2" | "thousands" | "ofn" (default: as it is). */
export function fmtBy(spec, v) {
  const [kind, arg] = String(spec || "").split(":");
  if (v === undefined || v === null) return "?";
  if (kind === "fixed") return fixed(v, Number(arg ?? 2));
  if (kind === "int") return String(Math.round(v));
  if (kind === "chance") return fmtChance(v);
  if (kind === "pct") return `${(v * 100).toFixed(Number(arg ?? 0))} %`;
  if (kind === "signed") return signed(v, Number(arg ?? 2));
  if (kind === "thousands") return Math.round(v).toLocaleString("en-US");
  if (kind === "ofn") return `${v[0]} of ${v[1]}`;
  if (kind === "date") return fmtDate(v);
  return String(v);
}

// ---------- chart builders (each returns an HTML string) ----------

/** Vertical grid lines + the axis row (tick labels). `ticks` = [{ v, text }]. */
function axisHtml(ticks, domain, log, unit) {
  const marks = ticks.map((t) => `<span class="rtick" style="--x:${place(t.v, domain, log).pct.toFixed(2)}%">${esc(t.text)}</span>`).join("");
  return `<div class="rrow raxis"><div class="rlabel"></div><div class="rtrack">${marks}</div></div>${unit ? `<p class="raxis-unit">${esc(unit)}</p>` : ""}`;
}
const gridHtml = (ticks, domain, log) => ticks.map((t) => `<span class="rgrid" style="--x:${place(t.v, domain, log).pct.toFixed(2)}%"></span>`).join("");
const legendHtml = (items) => (items?.length ? `<ul class="rlegend">${items.map((i) => `<li><span class="rkey ${esc(i.shape || "bar")} ${esc(i.cls || "")}" aria-hidden="true"></span>${esc(i.text)}</li>`).join("")}</ul>` : "");

/**
 * Horizontal bars from a baseline, with optional error whiskers.
 * rows: [{ label, value (null = no bar), err?, cls?, text?, note? }]   opts: { domain, ticks, unit, baseline = 0, legend }
 */
export function barsHtml(rows, opts) {
  const { domain, ticks, unit, baseline = 0, legend } = opts;
  const x0 = place(baseline, domain).pct;
  const body = rows.map((r) => {
    if (r.value === null || r.value === undefined) {
      return `<div class="rrow"><div class="rlabel">${esc(r.label)}</div><div class="rtrack">${gridHtml(ticks, domain)}<span class="rnone">${esc(r.note || "no value")}</span></div></div>`;
    }
    const x = place(r.value, domain).pct;
    const left = Math.min(x0, x), width = Math.abs(x - x0);
    const lo = r.err ? place(r.value - r.err, domain).pct : x, hi = r.err ? place(r.value + r.err, domain).pct : x;
    const whisker = r.err ? `<span class="rwhisker" style="--x:${lo.toFixed(2)}%;--w:${(hi - lo).toFixed(2)}%"></span>` : "";
    const text = r.text ?? String(r.value);
    const inside = hi > 78;                                      // no room to the right of a long bar: put the value inside it
    const anchor = inside ? Math.min(x, lo) : Math.max(x, hi);   // the value never sits on the error whisker
    return `<div class="rrow"><div class="rlabel">${esc(r.label)}</div><div class="rtrack">${gridHtml(ticks, domain)}`
      + `<span class="rbar ${esc(r.cls || "")}" style="--x:${left.toFixed(2)}%;--w:${width.toFixed(2)}%"></span>${whisker}`
      + `<span class="rval${inside ? " inside" : ""}" style="--x:${anchor.toFixed(2)}%">${esc(text)}</span></div></div>`;
  }).join("");
  return `<div class="rplot" aria-hidden="true">${body}${axisHtml(ticks, domain, false, unit)}</div>${legendHtml(legend)}`;
}

/**
 * Dots on a line (linear or log scale): one or several points per row, an optional range, optional reference lines.
 * rows: [{ label, points: [{ v, shape: "circle"|"diamond", cls?, text? }], range?: [lo, hi] }]
 * opts: { domain, ticks, log, unit, refs: [{ v, text }], legend }
 */
export function dotsHtml(rows, opts) {
  const { domain, ticks, log = false, unit, refs = [], legend } = opts;
  const body = rows.map((r) => {
    const { lanes, count } = assignLanes(r.points.map((p) => p.v), domain, 2.4, log);
    const refsHtml = refs.map((f) => `<span class="rref" style="--x:${place(f.v, domain, log).pct.toFixed(2)}%"></span>`).join("");
    const range = r.range ? (() => {
      const lo = place(r.range[0], domain, log).pct, hi = place(r.range[1], domain, log).pct;
      return `<span class="rrange" style="--x:${lo.toFixed(2)}%;--w:${(hi - lo).toFixed(2)}%"></span>`;
    })() : "";
    const pts = r.points.map((p, i) => {
      const { pct, off } = place(p.v, domain, log);
      const edge = off ? ` off off${off > 0 ? "R" : "L"}` : "";
      const label = off ? `<span class="rofftext">${esc(p.text ?? p.v)}</span>` : "";
      return `<span class="rpt ${esc(p.shape || "circle")} ${esc(p.cls || "")}${edge}" style="--x:${pct.toFixed(2)}%;--lane:${lanes[i]}">${label}</span>`;
    }).join("");
    return `<div class="rrow rdots" style="--lanes:${count}"><div class="rlabel">${esc(r.label)}</div><div class="rtrack">${gridHtml(ticks, domain, log)}${refsHtml}${range}${pts}</div></div>`;
  }).join("");
  return `<div class="rplot" aria-hidden="true">${body}${axisHtml(ticks, domain, log, unit)}</div>${legendHtml(legend)}`;
}

/** A real table (the same numbers as the chart, for screen readers and for copying). */
export function tableHtml(caption, headers, rows) {
  const head = headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("");
  return `<details class="rtable"><summary>Show the numbers as a table</summary><div class="rtable-scroll"><table><caption>${esc(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></details>`;
}

// ---------- the charts of the page ----------

const REAL = "real", FALSE = "bad", TARGET = "target";
const log10Ticks = (lo, hi, step) => { const t = []; for (let k = lo; k <= hi; k += step) t.push({ v: 10 ** k, text: fmtPow10(k) }); return t; };
const linTicks = (lo, hi, n, d = 1) => niceTicks(lo, hi, n).map((v) => ({ v, text: fixed(v, d) }));

/** All charts, keyed by the id used in results.html (data-chart="..."). */
export function buildCharts(data) {
  const out = {};
  // each numbered block is tried on its own: a file that lacks a section still gets the charts of the others (the page says which are missing)
  const missing = [];
  const attempt = (fn) => { try { fn(); } catch (e) { missing.push(e.message); } };
  Object.defineProperty(out, "_missing", { value: missing, enumerable: false });
  const runs = data.movers?.runs, cal = data.calibration;

  attempt(() => {
  // 1. how far the measured motion is from the catalogue motion
  out.moversDifference = barsHtml(
    runs.map((r) => ({ label: r.label, value: r.difference, text: `${fixed(r.difference)}″/yr`, cls: REAL })),
    { domain: [0, 1], ticks: linTicks(0, 1, 5), unit: "Difference between the measured and the catalogue proper motion, arcsec per year (1 pixel = 6.14 arcsec)" },
  ) + tableHtml("Find movers on real images: measured against catalogue motion",
    ["Run", "Catalogue (east, north) ″/yr", "Measured (east, north) ″/yr", "Difference ″/yr", "Seen in", "Significance", "Chance lines expected"],
    runs.map((r) => [r.label, `${signed(r.catalogue[0])}, ${signed(r.catalogue[1])}`, `${signed(r.measured[0])}, ${signed(r.measured[1])}`, fixed(r.difference), fmtBy("ofn", r.seen) + " images", `${r.sigma} σ`, fmtChance(r.chanceLines)]));

  });
  attempt(() => {
  // 2. chance lines expected: real lines far below 1, false lines of the original rule above it
  const orr = data.movers.originalRule;
  out.chanceLines = dotsHtml([
    ...runs.map((r) => ({ label: r.label, points: [{ v: r.chanceLines, shape: "circle", cls: REAL }] })),
    { label: "Original rule · the real Epsilon Indi B line", points: [{ v: orr.realChanceLines, shape: "circle", cls: REAL }] },
    { label: "Original rule · three false lines", points: orr.falseChanceLines.map((v) => ({ v, shape: "diamond", cls: FALSE })) },
  ], {
    domain: [1e-32, 1e3], log: true, ticks: log10Ticks(-30, 0, 10).concat([{ v: 1e2, text: fmtPow10(2) }]), unit: "Lines this good expected by chance in that field (log scale; a candidate is kept only below 1)",
    refs: [{ v: 1, text: "1" }],
    legend: [{ shape: "circle", cls: REAL, text: "a line the detector kept (real)" }, { shape: "diamond", cls: FALSE, text: "a false line of the original rule" }, { shape: "ref", text: "limit: 1 chance line expected" }],
  }) + tableHtml("Chance lines expected", ["Line", "Chance lines expected"],
    [...runs.map((r) => [r.label, fmtChance(r.chanceLines)]), ["Original rule · real Epsilon Indi B line", fmtChance(orr.realChanceLines)], ...orr.falseChanceLines.map((v, i) => [`Original rule · false line ${i + 1} (dots in ${orr.falseSupportedImages[i][0]} of ${orr.falseSupportedImages[i][1]} measurable images)`, fmtChance(v)])]);

  });
  attempt(() => {
  // 3. the bad-pixel mask on Barnard's Star in D2
  const mk = data.movers.barnardD2Mask;
  out.barnardMask = barsHtml([
    { label: "Before the bad-pixel mask", value: mk.before, text: `${fixed(mk.before)}″/yr`, cls: FALSE },
    { label: "After the bad-pixel mask", value: mk.after, text: `${fixed(mk.after)}″/yr`, cls: REAL },
  ], { domain: [0, 4], ticks: linTicks(0, 4, 4), unit: "Difference from the catalogue motion, arcsec per year (Barnard's Star, D2)" })
    + tableHtml("Barnard's Star in D2", ["Version", "Difference from the catalogue ″/yr"], [["Before the bad-pixel mask", fixed(mk.before)], ["After the bad-pixel mask", fixed(mk.after)]]);

  });
  attempt(() => {
  // 4. Jansky scale
  out.jansky = dotsHtml(
    data.jansky.map((j) => ({ label: j.label, points: [{ v: j.median, shape: "circle", cls: REAL }], range: [j.p16, j.p84] })),
    { domain: [0.8, 1.1], ticks: linTicks(0.8, 1.1, 6, 2), unit: "Measured flux divided by the flux expected from the 2MASS / AllWISE magnitude (median and 16th-84th percentile)", refs: [{ v: 1, text: "1" }],
      legend: [{ shape: "circle", cls: REAL, text: "median of the stars" }, { shape: "range", text: "16th-84th percentile" }, { shape: "ref", text: "1 = same as the catalogue" }] },
  ) + tableHtml("Jansky scale against catalogue stars", ["Field, detector", "Stars", "Measurements", "Median measured / expected", "Robust scatter", "16th–84th percentile"],
    data.jansky.map((j) => [j.label, j.stars, j.measurements, fixed(j.median, 3), fixed(j.scatter, 3), `${fixed(j.p16)}–${fixed(j.p84)}`]));

  });
  attempt(() => {
  // 5. the asteroid that moved
  out.arosa = barsHtml(
    data.arosa.rows.map((r) => ({ label: r.label, value: r.fluxMilliJy, err: r.err, text: r.fluxMilliJy === null ? "" : `${fixed(r.fluxMilliJy)} mJy`, note: r.note, cls: r.fluxMilliJy !== null && r.fluxMilliJy < 3 ? FALSE : REAL })),
    { domain: [-2, 10], ticks: linTicks(-2, 10, 6, 0), unit: "Flux at the position where the asteroid is expected, mJy (± 1 error)", baseline: 0 },
  ) + tableHtml("Asteroid Arosa in two images 19.5 hours apart", ["Image and position", "Flux mJy", "Error mJy"], data.arosa.rows.map((r) => [r.label, r.fluxMilliJy === null ? r.note : fixed(r.fluxMilliJy), r.err === null ? "–" : fixed(r.err)]));

  });
  attempt(() => {
  // 6. WISE 0855, stacked along its path against control places
  for (const det of ["D6", "D2"]) {
    const w = data.wise0855[det];
    const lo = det === "D6" ? -0.5 : -0.2, hi = det === "D6" ? 1.0 : 0.8;
    out[`wise${det}`] = dotsHtml([
      { label: `${w.controls.length} control places (the path moved 40–60″)`, points: w.controls.map((v) => ({ v, shape: "circle", cls: REAL, text: signed(v) })) },
      { label: "WISE 0855, along its predicted path", points: [{ v: w.stack, shape: "diamond", cls: TARGET }], range: [w.stack - w.err, w.stack + w.err] },
    ], { domain: [lo, hi], ticks: linTicks(lo, hi, 5, 1), unit: `Stacked flux, mJy, ${w.label}`, refs: [{ v: 0, text: "0" }],
      legend: [{ shape: "circle", cls: REAL, text: "control place (nothing expected)" }, { shape: "diamond", cls: TARGET, text: "WISE 0855 path, ± 1 error" }, { shape: "ref", text: "zero" }] })
      + tableHtml(`WISE 0855 stack, ${w.label}`, ["", "Value"], [
        ["Unflagged images used", fmtBy("ofn", w.unflagged)], ["Stack, mJy", `${fixed(w.stack, 3)} ± ${fixed(w.err, 3)}`], ["Nominal significance", `${w.nominalSigma} σ`],
        ["Controls: median, mJy", signed(w.controlMedian, 3)], ["Controls: robust scatter, mJy", fixed(w.controlRobustScatter, 3)], ["Controls: plain scatter, mJy", fixed(w.controlPlainScatter, 3)],
        ["Target against the robust scatter", `${w.timesRobust} ×`], ["Brighter than", `${w.brighterThan[0]} of ${w.brighterThan[1]} controls`], ["Control values, mJy", w.controls.map((v) => signed(v)).join(" ")]]);
  }
  out.wiseImages = tableHtml("WISE 0855, D6, flux at the predicted position in each image", ["Date", "Wavelength µm", "Flux mJy", "Error mJy", "Flagged"],
    data.wise0855.d6Images.map((r) => [r.date, fixed(r.um, 3), fixed(r.fluxMilliJy, 3), fixed(r.err, 3), r.flagged ? "yes (left out)" : "no"]));

  });
  attempt(() => {
  // 7. Makemake distance
  const m = data.makemake;
  out.makemake = dotsHtml([
    { label: "JPL Horizons (the answer)", points: [{ v: m.horizonsAU, shape: "circle", cls: REAL }] },
    { label: "Fitted from the dots (told where to look)", points: [{ v: m.fitAU, shape: "diamond", cls: TARGET }], range: [m.fitLowAU, m.fitHighAU] },
  ], { domain: [52.55, 52.70], ticks: linTicks(52.55, 52.70, 3, 2), unit: "Distance of Makemake, astronomical units (the fit's 1σ range is the line)",
    legend: [{ shape: "circle", cls: REAL, text: "ephemeris" }, { shape: "diamond", cls: TARGET, text: "fit to 4 detected positions, 1σ range" }] })
    + tableHtml("Makemake distance", ["", "AU"], [["JPL Horizons", fixed(m.horizonsAU)], ["Fit", `${fixed(m.fitAU)} (1σ ${fixed(m.fitLowAU)}–${fixed(m.fitHighAU)})`]]);
  });
  attempt(() => {
  // 8. how faint can one image go (fake movers injected into real frames)
  out.calibrationLimits = dotsHtml(
    cal.limits.map((l) => ({ label: l.label, points: [{ v: l.flux50, shape: "circle", cls: REAL }, ...(l.flux90 === null ? [] : [{ v: l.flux90, shape: "diamond", cls: TARGET }])] })),
    { domain: [0.3, 30], log: true, ticks: [0.3, 1, 3, 10, 30].map((v) => ({ v, text: String(v) })), unit: "Total flux of the fake star, mJy (log scale)",
      legend: [{ shape: "circle", cls: REAL, text: "found 50 % of the time in one image" }, { shape: "diamond", cls: TARGET, text: "found 90 % of the time (never reached in Barnard D2)" }] },
  ) + tableHtml("Faintest fake star the detector finds in one image", ["Field, detector", "Detector noise / pixel noise", "50 % of fakes found at, mJy", "90 % at, mJy"],
    cal.limits.map((l) => [l.label, fixed(l.noiseRatio), fixed(l.flux50), l.flux90 === null ? "not reached" : fixed(l.flux90)]));

  });
  attempt(() => {
  // 9. empty-sky calibration of the false-alarm number
  out.emptySky = dotsHtml(
    cal.emptySky.fields.map((f) => ({ label: f.label, points: [{ v: f.defaultRule, shape: "circle", cls: REAL }, { v: f.originalRule, shape: "diamond", cls: FALSE }] })),
    { domain: [0, 100], ticks: linTicks(0, 100, 5, 0), unit: `Share of ${cal.emptySky.copies} scrambled copies of the field that still show a candidate, %`,
      legend: [{ shape: "circle", cls: REAL, text: "with the rule now used" }, { shape: "diamond", cls: FALSE, text: "with the original rule" }] },
  ) + tableHtml("Empty-sky test: share of scrambled fields with a candidate", ["Field, detector (images, survey passes)", "Rule now used, %", "Original rule, %"],
    cal.emptySky.fields.map((f) => [f.label, fixed(f.defaultRule, 1), fixed(f.originalRule, 1)]));

  });
  attempt(() => {
  // 10. could SPHEREx see a Planet X?
  const px = data.planetX;
  out.planetX = dotsHtml(
    px.planets.map((p) => ({ label: p.label, points: [{ v: p.v300, shape: "circle", cls: REAL, text: String(p.v300) }, { v: p.v500, shape: "circle", cls: REAL }, { v: p.v1000, shape: "circle", cls: REAL }] })),
    { domain: [16, 25], ticks: linTicks(16, 25, 9, 0), unit: "Apparent magnitude V of the planet (fainter to the right)", refs: [{ v: 17, text: "17" }],
      legend: [{ shape: "circle", cls: REAL, text: "the planet at 300, 500 and 1000 AU, from left to right" }, { shape: "ref", text: "faintest star found in one image (about V 17)" }] },
  ) + tableHtml("Reflected-light brightness of a distant planet", ["Planet", "V at 300 AU", "V at 500 AU", "V at 1000 AU"],
    px.planets.map((p) => [p.label, fixed(p.v300, 1), fixed(p.v500, 1), fixed(p.v1000, 1)]));
  });
  return out;
}

// ---------- the page ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-07" -> "7 Nov 2026"; anything else is returned as it is. */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(iso);
}

const VALIDATION_URL = "https://github.com/mateibut/SPHEREx/blob/main/docs/VALIDATION.md";

/**
 * The line under the heading of sections 1-10: which command made the numbers of the section and where VALIDATION.md reports it.
 * Honest about the way: these numbers were typed into the data file from the printed report of the command (on the date of the measurement);
 * the page cannot remake them by itself. Section 11 is different: a command writes its file.
 */
export function originHtml(origin, measuredOn) {
  const cmds = origin.commands.map((c) => `<code>${esc(c)}</code>`).join("; ");
  if (origin.generated) {                                    // made by a script from the images the backend held that day: remade every time the command is run
    return `<strong>Where these numbers come from.</strong> <span class="rmade">Made by a command, not typed:</span> ${cmds}. It ran on ${esc(fmtDate(origin.generated))} on the real images the backend held that day `
      + `and wrote them into this page's data file (<code>real_results_generated.json</code>); running it again remakes them. The report of that day is in <a href="${VALIDATION_URL}">VALIDATION.md &sect;${esc(origin.validation)}</a>.`;
  }
  return `<strong>Where these numbers come from.</strong> ${cmds}. Reported in <a href="${VALIDATION_URL}">VALIDATION.md &sect;${esc(origin.validation)}</a>. `
    + `Measured on ${esc(fmtDate(measuredOn))} and typed into this page's data file from the report of that command; this page does not remake them (the list in section 11 is made by a command).`;
}

/**
 * The numbers of the page: the typed file (sections 4-10, copied from the reports of 7 Nov) with the generated file (sections 1-3, made by scratch/make_results.mjs from the real
 * images) laid over it. A generated key replaces the typed one; the origins of the generated sections replace the typed origins of the same sections.
 */
export function mergeResults(typed, generated) {
  const made = new Set((generated.origins ?? []).map((o) => o.section));
  const { origins: _o, ...rest } = generated;
  return { ...typed, ...rest, origins: [...(typed.origins ?? []).filter((o) => !made.has(o.section)), ...(generated.origins ?? [])].sort((a, b) => a.section - b.section) };
}

/** Fill the page: charts into [data-chart], numbers into [data-n], the origin lines into [data-origin], the limits list into [data-limits]. */
export function renderPage(data, root = document) {
  const charts = buildCharts(data);
  for (const el of root.querySelectorAll("[data-origin]")) {
    const origin = (data.origins ?? []).find((o) => String(o.section) === el.dataset.origin);
    el.innerHTML = origin ? originHtml(origin, data.measuredOn) : "";
  }
  for (const el of root.querySelectorAll("[data-chart]")) {
    const html = charts[el.dataset.chart];
    if (html) el.innerHTML = html;
  }
  for (const el of root.querySelectorAll("[data-n]")) el.textContent = fmtBy(el.dataset.fmt, getPath(data, el.dataset.n));
  for (const el of root.querySelectorAll("[data-limits]")) el.innerHTML = data.limits.map((t) => `<li>${esc(t)}</li>`).join("");
}

// ---------- every source on the six real fields (data/real_sources.json): the candidate explorer, with the provenance of each run ----------

/** The rows of one field, or of all of them ("all"). Every row says which field it came from. */
export function sourceRows(file, fieldId = "all") {
  return file.fields.filter((f) => fieldId === "all" || f.id === fieldId).flatMap((f) => f.rows.map((r) => ({ ...r, field: r.field ?? f.label })));
}

/** The numbers above the table, all counted from the rows (nothing is typed in): how many sources, in how many fields, how many of each class. */
export function sourcesSummary(file) {
  const rows = sourceRows(file);
  const by = {};
  for (const r of rows) by[r.class] = (by[r.class] ?? 0) + 1;
  const known = (by.catalogued ?? 0) + (by["catalogued-moving"] ?? 0) + (by["solar-system"] ?? 0);
  return { total: rows.length, fields: file.fields.length, byClass: by, known, needChecking: by.unknown ?? 0, weak: by["unknown-weak"] ?? 0, artefacts: by.artefact ?? 0, unchecked: by.unchecked ?? 0 };
}

/** The verdict under the table, from the counts: nothing left unexplained says that this test cannot show the tool would find something new; sources left over are leads. */
export function sourcesVerdict(s) {
  const left = s.needChecking + s.weak + s.artefacts + s.unchecked;
  return left === 0
    ? "Every source was explained by a catalogue or a known body: it found nothing new, and this test cannot say whether it would."
    : `${left} source${left === 1 ? " is" : "s are"} not explained by a catalogue or a known body: leads to check, not discoveries.`;
}

/** One sentence from those counts. It claims no discovery; it says what the catalogues explained and what is left. */
export function sourcesSentence(s) {
  const left = s.needChecking + s.weak + s.artefacts + s.unchecked;
  return `${s.total} source${s.total === 1 ? "" : "s"} in ${s.fields} field${s.fields === 1 ? "" : "s"}: ${s.known} in a catalogue or a known Solar System body` +
    (left === 0 ? "; none is left unexplained." : `; ${left} not explained (${s.needChecking} need checking, ${s.weak} weakly supported, ${s.artefacts} possible artefacts, ${s.unchecked} not checked).`);
}

function renderSources(file, root = document) {
  const section = root.getElementById("sources-section");
  if (!section) return;
  const select = root.getElementById("sources-field");
  select.replaceChildren(new Option("All fields", "all"), ...file.fields.map((f) => new Option(`${f.label} (${f.total})`, f.id)));
  const summary = sourcesSummary(file);
  root.getElementById("sources-summary").textContent = sourcesSentence(summary);
  root.getElementById("sources-verdict").textContent = sourcesVerdict(summary);
  const explorer = createExplorer({ root: root.getElementById("sources-explorer"), threshold: file.fields[0]?.provenance?.settings?.needsCheckingScore ?? null, showField: true,
    onSelect: (id) => { const r = sourceRows(file).find((x) => x.id === id && (select.value === "all" || x.field === file.fields.find((f) => f.id === select.value)?.label)); root.getElementById("sources-detail").textContent = r ? `${r.id} · ${r.field} · ${r.headline}${r.match ? ` · match: ${r.match}` : ""}` : ""; } });
  explorer.setRows(sourceRows(file));
  select.addEventListener("change", () => { explorer.reset(); explorer.setRows(sourceRows(file, select.value)); root.getElementById("sources-detail").textContent = ""; });
  const prov = root.getElementById("sources-provenance");
  prov.replaceChildren(...file.fields.map((f) => {
    const d = document.createElement("details");
    d.className = "provenance";
    const missing = missingProvenance(f.provenance);
    d.innerHTML = `<summary>${esc(f.label)}: how it was made</summary><p>${esc(provenanceText(f.provenance))}${missing.length ? ` <strong>Missing from this record: ${esc(missing.join(", "))}.</strong>` : ""}</p>`;
    return d;
  }));
  root.getElementById("sources-command").textContent = file.command;
  root.getElementById("sources-date").textContent = file.measuredOn;
  section.hidden = false;
}

// ---------- the page: ONE file in, everything on the page from that file ----------
//
// The page starts on the archived validation (data/real_results.json laid over real_results_generated.json), the numbers the project reported. A person can load
// another file (the buttons, a drop anywhere on the page, or the file field): a candidate export of the workspace (JSON or CSV), a list of sources, or validation numbers.
// Then the numbers at the top, the charts, the table, the detail and the report all come from THAT file (features/resultsData.js, resultsCharts.js, resultsExplorer.js);
// the archived sections 1-12 are the author's commentary on the archived run, so they are shown only while it is the file on the page.

const $ = (id) => document.getElementById(id);
const IMPORTED = { export: "Candidate export loaded.", "export-csv": "Candidate export loaded.", sources: "List of sources loaded.", validation: "Validation numbers loaded." };

/** The charts a validation file can have, in the order of the archived page: [key in buildCharts, title]. */
export const GENERIC_CHARTS = [
  ["moversDifference", "Distance of the measured motion from the catalogue motion"], ["chanceLines", "Lines expected by chance"], ["barnardMask", "Effect of the bad-pixel mask"],
  ["jansky", "Measured flux divided by catalogue flux"], ["arosa", "Flux at the positions where the asteroid is expected"], ["wiseD6", "WISE 0855, stacked flux along its path (D6)"],
  ["wiseD2", "WISE 0855, stacked flux along its path (D2)"], ["wiseImages", "WISE 0855, flux in each image"], ["makemake", "Distance of Makemake from the parallax fit"],
  ["calibrationLimits", "Faintest fake star found in one image"], ["emptySky", "Empty fields that still show a candidate"], ["planetX", "Brightness of a distant planet"],
];

/** The validation numbers of a loaded file as charts and tables, with no commentary: the commentary of the page belongs to the archived run. A chart the file lacks is named as missing. */
export function genericValidationHtml(data) {
  const charts = buildCharts(data);
  const figs = GENERIC_CHARTS.map(([id, title]) => (charts[id]
    ? `<figure class="rfig"><figcaption>${esc(title)}</figcaption>${charts[id]}</figure>`
    : `<p class="rmissing">${esc(title)}: not in this file.</p>`)).join("");
  return `<section class="panel rsec" aria-labelledby="g-title"><h2 id="g-title">Validation numbers of this file</h2>`
    + `<p class="rorigin">Drawn from the loaded file only. The explanations written for the archived run are not shown, because they describe other numbers.</p>${figs}</section>`;
}

/** "How this file was made": the provenance records the file carries (a candidate export has one, a list of sources has one per field). */
export function provenanceHtml(ds) {
  const items = ds.kind === "sources" ? (ds.raw.fields ?? []).map((f) => ({ label: f.label ?? f.id, p: f.provenance })) : ds.raw?.provenance ? [{ label: ds.label, p: ds.raw.provenance }] : [];
  const parts = items.map(({ label, p }) => {
    let text;
    try { text = provenanceText(p); } catch { return `<details class="provenance"><summary>${esc(label)}: how it was made</summary><p>This file has no complete record of how it was made.</p></details>`; }
    const missing = missingProvenance(p);
    return `<details class="provenance"><summary>${esc(label)}: how it was made</summary><p>${esc(text)}${missing.length ? ` <strong>Missing from this record: ${esc(missing.join(", "))}.</strong>` : ""}</p></details>`;
  });
  return parts.join("");
}

function renderDashboard(ds) {
  const badge = $("data-badge");
  badge.textContent = ds.provenance;
  badge.classList.toggle("synthetic", /synthetic/i.test(ds.provenance));
  $("current-file").textContent = `${ds.label} · ${ds.rows.length} record${ds.rows.length === 1 ? "" : "s"} · ${ds.date}`;
  $("kpis").innerHTML = kpiList(ds).map((k) => `<li><b>${esc(k.value)}</b><span>${esc(k.label)}</span></li>`).join("");
  $("dash-charts").innerHTML = dashboardCharts(ds).map((c) => `<figure class="dcard${c.wide ? " wide" : ""}"><figcaption>${esc(c.title)}</figcaption>`
    + `${c.note ? `<p class="dnote">${esc(c.note)}</p>` : ""}${c.html ?? `<p class="dempty">${esc(c.empty)}</p>`}</figure>`).join("");
  $("dash-provenance").innerHTML = provenanceHtml(ds);
}

async function main() {
  const status = $("results-status");
  const explorer = setupExplorer();
  let archive = null, current = null, version = 0;
  const examples = {};                                    // the sample files, read once when asked for

  const say = (text, bad = false) => { const el = $("import-status"); el.textContent = text; el.classList.toggle("bad", bad); };
  const highlight = (id) => { for (const p of document.querySelectorAll("#dash-charts .dpt")) p.classList.toggle("sel", p.dataset.id === id); };
  explorer.onSelect = highlight;
  $("dash-charts").addEventListener("click", (e) => { const id = e.target.closest?.(".dpt")?.dataset.id; if (id) explorer.focusRow(id); });

  /** Put a dataset on the page. The dashboard is drawn first so that the table can mark the selected record in it. */
  function view(ds) {
    current = ds;
    renderDashboard(ds);
    explorer.show(ds);
    const isArchive = ds === archive;
    $("validation-archive").hidden = !isArchive;
    $("validation-generic").hidden = isArchive || ds.kind !== "validation";
    $("validation-note").hidden = isArchive || ds.kind === "validation";
    if (!$("validation-generic").hidden) $("validation-generic").innerHTML = genericValidationHtml(ds.raw);
    for (const b of document.querySelectorAll("[data-example]")) b.setAttribute("aria-pressed", String(examples[b.dataset.example] === ds));
  }

  async function loadFile(file) {
    const mine = ++version;
    try {
      if (file.size > MAX_FILE_BYTES) throw Error("Choose a file under 16 MiB.");
      const { format, dataset } = readResultsFile(await file.text(), file.name, { lastModified: file.lastModified });
      if (mine !== version) return;
      view(dataset);
      say(IMPORTED[format]);
    } catch (error) {
      if (mine === version) say(`Import failed. ${error.message}${current ? ` The page still shows ${current.label}.` : ""}`, true);
    }
  }

  // ---- the ways in: the file field, a drop anywhere on the page, the sample files
  $("candidate-file").addEventListener("change", (event) => { const file = event.target.files[0]; event.target.value = ""; if (file) loadFile(file); });
  const zone = $("drop-zone");
  window.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) zone.classList.remove("over"); });
  window.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); const file = e.dataTransfer?.files?.[0]; if (file) loadFile(file); });
  $("ex-sources").addEventListener("click", async () => {
    const mine = ++version;
    try {
      if (!examples.sources) {
        const r = await fetch("data/real_sources.json");
        if (!r.ok) throw new Error(`data/real_sources.json: HTTP ${r.status}`);
        examples.sources = { ...readResultsFile(await r.text(), "data/real_sources.json").dataset, label: "Find everything on the six real fields" };
      }
      if (mine !== version) return;
      view(examples.sources);
      say(IMPORTED.sources);
    } catch (error) { if (mine === version) say(`Import failed. ${error.message}`, true); }
  });
  $("ex-archive").addEventListener("click", () => { version++; say(""); if (archive) view(archive); });

  // ---- the archived validation: what the page shows until a file is loaded
  try {
    const [typed, generated] = await Promise.all(["data/real_results.json", "data/real_results_generated.json"].map(async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.json();
    }));
    const merged = mergeResults(typed, generated);
    renderPage(merged);
    archive = { ...validationDataset(merged, "Archived mover validation"), source: "data/real_results.json" };
    examples.archive = archive;
    view(archive);
    if (status) status.hidden = true;
  } catch (err) {
    if (status) {
      status.hidden = false;
      status.textContent = location.protocol === "file:"
        ? "This page needs to be served over http (for example: py -m http.server 8765 -d frontend), not opened as a file."
        : `The numbers could not be loaded (${err.message}).`;
    }
  }
  // The sources table is a separate file: if it fails, say so in its own place and leave the rest of the page as it is.
  const note = $("sources-status");
  try {
    const r = await fetch("data/real_sources.json");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    renderSources(await r.json());
    if (note) note.hidden = true;
  } catch (err) {
    if (note) { note.hidden = false; note.textContent = `The list of sources could not be loaded (${err.message}).`; }
  }
}
if (typeof document !== "undefined" && document.getElementById("results-status")) main();
