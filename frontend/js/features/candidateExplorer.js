// candidateExplorer.js – the maths of the candidate table: filter, search, sort by a column, page, and the layout of the diagnostic plot.
// Pure (no DOM, no network): scratch/test_explorer.mjs. The page part is candidateExplorerView.js.
//
// The table works on ROWS, a flat summary of a candidate that the live panel makes from a discover() candidate (discoverPanel.js explorerRow) and
// that the results page reads from its data file (data/real_sources.json), so both show the same table:
//   { id, class, classLabel, headline, ra, dec, motion, nDet, nFrames, passes, snr, support, fluxMilliJy, tags: [], match, field? }
//   class = a key of CLASSES (discovery.js); motion = arcsec/yr or null; snr = median detector S/N; match = the best catalogue match as text ("" = none)

import { formatRA, formatDec } from "../coords.js";

/** The order of the classes in a sorted table: what a person should look at first comes first (the same order as discovery.js). */
export const CLASS_ORDER = ["unknown", "unchecked", "unknown-weak", "artefact", "catalogued-moving", "solar-system", "catalogued"];
const CLASS_RANK = Object.fromEntries(CLASS_ORDER.map((k, i) => [k, i]));
const KNOWN = ["catalogued", "catalogued-moving", "solar-system"];

/** The filters of the list and of the table: [label, predicate on a candidate or a row]. */
export const FILTERS = {
  all: ["Everything", () => true],
  check: ["Needs checking", (c) => c.class === "unknown"],
  unknown: ["Not explained (also the weak ones)", (c) => c.class === "unknown" || c.class === "unknown-weak"],
  known: ["Known (catalogue or asteroid)", (c) => KNOWN.includes(c.class)],
  artefact: ["Possible artefacts", (c) => c.class === "artefact"],
  moving: ["Moving", (c) => c.tags.includes("moving")],
  transient: ["Seen in one pass only", (c) => c.tags.includes("transient")],
  red: ["Red (cool or warm objects)", (c) => c.tags.includes("red") || c.tags.includes("very-red")],
};

/** The columns of the table. `numeric` ones sort by value and align right; the others by text (the class by CLASS_ORDER). */
export const COLUMNS = [
  { key: "class", label: "Class", title: "What the cross-match says: unknown first, known last" },
  { key: "headline", label: "Source", title: "The best match, or what kind of source it is" },
  { key: "ra", label: "RA", numeric: true, title: "Right ascension (hours, minutes, seconds)" },
  { key: "dec", label: "Dec", numeric: true, title: "Declination (degrees, arcminutes, arcseconds)" },
  { key: "motion", label: "Motion ″/yr", numeric: true, title: "Measured motion, when it is significant" },
  { key: "nDet", label: "Seen in", numeric: true, title: "Images where the detector found it as a dot, of all the images" },
  { key: "snr", label: "S/N", numeric: true, title: "Median signal-to-noise of its dots" },
  { key: "support", label: "Support", numeric: true, title: "How well the images support it, 0 to 100 (a sum of documented terms, not a probability)" },
  { key: "fluxMilliJy", label: "Flux mJy", numeric: true, title: "Median flux in the images where it was found, not flagged" },
];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** The value of a row for sorting: a number, or a rank for the class, or lower-case text; null when it has none. */
function sortValue(row, key) {
  if (key === "class") return CLASS_RANK[row.class] ?? CLASS_ORDER.length;
  const v = row[key];
  if (isNum(v)) return v;
  if (v === null || v === undefined || v === "" || (typeof v === "number")) return null;
  return String(v).toLowerCase();
}

/** A new array sorted by one column. dir = "asc" | "desc". Rows without a value always go last, whichever way; equal rows keep their order. */
export function sortRows(rows, key, dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  return rows.map((r, i) => ({ r, i, v: sortValue(r, key) })).sort((a, b) => {
    if (a.v === null && b.v === null) return a.i - b.i;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    const d = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), "en", { numeric: true });
    return d !== 0 ? sign * d : a.i - b.i;
  }).map((x) => x.r);
}

/** Keep the rows that contain every word of `text` (case does not matter) in their id, source, match, class, field or tags. */
export function searchRows(rows, text) {
  const words = String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const hay = [r.id, r.headline, r.match, r.classLabel, r.field, ...(r.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** One page of a list. page is 1-based and is brought inside 1..pages. -> { rows, page, pages, from, to, total } (from, to: 1-based positions, 0 when empty) */
export function pageOf(rows, page = 1, size = 10) {
  const per = Math.max(1, Math.floor(size) || 10);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const p = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  const start = (p - 1) * per, slice = rows.slice(start, start + per);
  return { rows: slice, page: p, pages, from: slice.length ? start + 1 : 0, to: start + slice.length, total: rows.length };
}

/**
 * Everything the table needs, from the state of its controls.
 * state = { filter: key of FILTERS, text, sortKey, sortDir, page, pageSize }  -> pageOf(...) plus { all, matched } (how many rows exist, how many pass filter and search)
 */
export function exploreRows(rows, state = {}) {
  const filter = FILTERS[state.filter ?? "all"]?.[1] ?? FILTERS.all[1];
  const matched = searchRows(rows.filter(filter), state.text);
  const sorted = state.sortKey ? sortRows(matched, state.sortKey, state.sortDir) : matched;
  return { ...pageOf(sorted, state.page, state.pageSize), all: rows.length, matched: matched.length, ordered: sorted };
}

/** The text of one cell. A missing value is "–", never 0 or a blank that could be read as a number. */
export function cellText(row, key) {
  const v = row[key];
  switch (key) {
    case "class": return row.classLabel ?? row.class;
    case "ra": return isNum(v) ? formatRA(v) : "–";
    case "dec": return isNum(v) ? formatDec(v) : "–";
    case "motion": return isNum(v) ? v.toFixed(v < 10 ? 2 : 1) : "–";
    case "nDet": return isNum(v) ? `${v} of ${row.nFrames}` : "–";
    case "snr": return isNum(v) ? v.toFixed(v < 10 ? 1 : 0) : "–";
    case "support": return isNum(v) ? String(v) : "–";
    case "fluxMilliJy": return isNum(v) ? (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2)) : "–";
    default: return v === null || v === undefined || v === "" ? "–" : String(v);
  }
}

// ---------------------------------------------------------------- the diagnostic plot: support against signal-to-noise

const X_TICKS = [3, 10, 30, 100, 300, 1000];

/**
 * Where each candidate goes on a plot of support score (up, 0-100) against median S/N (across, logarithmic), and where the "needs checking" line is.
 * rows with no S/N or no support are left out and counted in `skipped` (the table still lists them).
 * options: { width, height, margin: { left, right, top, bottom }, threshold }
 * -> { points: [{ id, x, y, class }], xTicks: [{ value, x }], yTicks: [{ value, y }], thresholdY, plot: { x0, x1, y0, y1 }, skipped }   (x, y in pixels of the plot, y grows downwards)
 */
export function scatterLayout(rows, { width = 560, height = 260, margin = { left: 44, right: 14, top: 12, bottom: 34 }, threshold = null } = {}) {
  const x0 = margin.left, x1 = width - margin.right, y0 = margin.top, y1 = height - margin.bottom;
  const usable = rows.filter((r) => isNum(r.snr) && r.snr > 0 && isNum(r.support));
  const snrs = usable.map((r) => r.snr);
  const lo = Math.min(3, ...snrs) * 0.9, hi = Math.max(30, ...snrs) * 1.15;
  const lx = (v) => x0 + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (x1 - x0);
  const ly = (v) => y1 - (Math.min(100, Math.max(0, v)) / 100) * (y1 - y0);
  return {
    points: usable.map((r) => ({ id: r.id, x: lx(r.snr), y: ly(r.support), class: r.class })),
    xTicks: X_TICKS.filter((t) => t >= lo && t <= hi).map((value) => ({ value, x: lx(value) })),
    yTicks: [0, 25, 50, 75, 100].map((value) => ({ value, y: ly(value) })),
    thresholdY: isNum(threshold) ? ly(threshold) : null,
    plot: { x0, x1, y0, y1 },
    skipped: rows.length - usable.length,
  };
}
