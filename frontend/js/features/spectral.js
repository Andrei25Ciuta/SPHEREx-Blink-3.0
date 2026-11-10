// spectral.js – the spectral and multi-detector side of the app (pure: no DOM, no network).
//
// SPHEREx has six detectors, each looking through its own strip of wavelengths. A field on screen has images of only some of them (the author's real files: D2 and D6), and a
// spectrum measured at a position has gaps where no image covers it. This module says plainly what is there and what is MISSING:
//
//   detectorCoverage()  one row per detector of the instrument: its images (count, wavelength range, dates, flagged share) or "no images here"
//   bandSeries()        a spectrum with its uncertainty as a BAND (upper and lower edge against wavelength) that breaks where there is a gap in wavelength, so that a missing
//                       stretch is drawn as missing and never joined by a line across it
//   missingSummary()    how many images were measured, how many had no usable data, how many were flagged, and the wavelength stretches nobody covers
//
// The wavelength range of each detector is the project's own table (docs/IRSA_FACTS.md section 3 and LESSON_SPHEREX.md): approximate and partly FROM MEMORY; only D2 (1.10-1.62 µm) is
// confirmed by the documentation read. The range that is shown for an image the app HAS is always the one in that image's own header, never this table.

/** The six detectors and where they look (µm). Approximate: see above. */
export const EXPECTED_DETECTORS = [
  { id: "D1", wlMin: 0.75, wlMax: 1.09 }, { id: "D2", wlMin: 1.10, wlMax: 1.62 }, { id: "D3", wlMin: 1.63, wlMax: 2.41 },
  { id: "D4", wlMin: 2.42, wlMax: 3.82 }, { id: "D5", wlMin: 3.83, wlMax: 4.41 }, { id: "D6", wlMin: 4.42, wlMax: 5.00 },
];

const GAP_EPS = 1e-9;                         // 1.5 - 1.2 is 0.30000000000000004 in floating point: a gap of exactly 0.3 um is not wider than 0.3 um
const detOrder = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const MJD_UNIX_EPOCH = 40587;
const mjdToDate = (mjd) => new Date((mjd - MJD_UNIX_EPOCH) * 86400000).toISOString().slice(0, 10);

/**
 * One row for every detector of the instrument (and any other detector name the frames carry).
 * frames: [{ detector, wavelengthMinUm, wavelengthMaxUm, mjd, flags: { fractionFlagged } | null }].
 * -> [{ id, status: "images" | "none", count, wlMin, wlMax, firstDate, lastDate, flaggedMean (0-1 or null), expected: { wlMin, wlMax } | null }]
 */
export function detectorCoverage(frames, expected = EXPECTED_DETECTORS) {
  const by = new Map();
  for (const f of frames ?? []) {
    if (!by.has(f.detector)) by.set(f.detector, []);
    by.get(f.detector).push(f);
  }
  const ids = [...new Set([...expected.map((d) => d.id), ...by.keys()])].sort(detOrder);
  return ids.map((id) => {
    const list = by.get(id) ?? [], exp = expected.find((d) => d.id === id) ?? null;
    if (!list.length) return { id, status: "none", count: 0, wlMin: null, wlMax: null, firstDate: null, lastDate: null, flaggedMean: null, expected: exp ? { wlMin: exp.wlMin, wlMax: exp.wlMax } : null };
    const known = list.filter((f) => f.flags && Number.isFinite(f.flags.fractionFlagged));
    const mjds = list.map((f) => f.mjd);
    return {
      id, status: "images", count: list.length,
      wlMin: Math.min(...list.map((f) => f.wavelengthMinUm)), wlMax: Math.max(...list.map((f) => f.wavelengthMaxUm)),
      firstDate: mjdToDate(Math.min(...mjds)), lastDate: mjdToDate(Math.max(...mjds)),
      flaggedMean: known.length ? known.reduce((s, f) => s + f.flags.fractionFlagged, 0) / known.length : null,
      expected: exp ? { wlMin: exp.wlMin, wlMax: exp.wlMax } : null,
    };
  });
}

/** The words of one tile of the detector overview: what is there, or that nothing is. */
export function coverageText(row) {
  if (row.status === "none") {
    const band = row.expected ? `expected ${row.expected.wlMin.toFixed(2)}–${row.expected.wlMax.toFixed(2)} µm` : "no known band";
    return { title: row.id, line1: "no images here", line2: band };
  }
  const flagged = row.flaggedMean === null ? "flags not known" : `${(row.flaggedMean * 100).toFixed(1)} % flagged`;
  return {
    title: row.id,
    line1: `${row.wlMin.toFixed(2)}–${row.wlMax.toFixed(2)} µm · ${row.count} image${row.count === 1 ? "" : "s"}`,
    line2: `${row.firstDate === row.lastDate ? row.firstDate : `${row.firstDate} to ${row.lastDate}`} · ${flagged}`,
  };
}

/**
 * A spectrum with its uncertainty as a band. points: [{ wavelengthUm, y, err }] (anything with a missing y or err is left out).
 * Sorted by wavelength; where two neighbours are more than `maxGapUm` apart a null is put between them, so that a line and a band drawn from it BREAK there
 * (a gap in the coverage is shown as a gap). -> { x, y, upper, lower, gaps: [[from, to]] } with nulls at the breaks.
 */
export function bandSeries(points, { maxGapUm = 0.3 } = {}) {
  const ok = (points ?? []).filter((p) => Number.isFinite(p.wavelengthUm) && Number.isFinite(p.y) && Number.isFinite(p.err)).sort((a, b) => a.wavelengthUm - b.wavelengthUm);
  const out = { x: [], y: [], upper: [], lower: [], gaps: [] };
  ok.forEach((p, i) => {
    if (i > 0 && p.wavelengthUm - ok[i - 1].wavelengthUm > maxGapUm + GAP_EPS) {
      out.gaps.push([ok[i - 1].wavelengthUm, p.wavelengthUm]);
      out.x.push(null); out.y.push(null); out.upper.push(null); out.lower.push(null);
    }
    out.x.push(p.wavelengthUm); out.y.push(p.y); out.upper.push(p.y + Math.abs(p.err)); out.lower.push(p.y - Math.abs(p.err));
  });
  return out;
}

/**
 * What a set of measurements at one position holds. points: [{ flux (null = no data), flagged, wavelengthUm, detector }].
 * -> { total, measured, noData, flagged, gaps: [[from, to]] (wavelength stretches between measured points that nobody covers, wider than maxGapUm), text }
 */
export function missingSummary(points, { maxGapUm = 0.3 } = {}) {
  const list = points ?? [];
  const measured = list.filter((p) => p.flux !== null && p.flux !== undefined);
  const flagged = measured.filter((p) => p.flagged).length;
  const wl = measured.map((p) => p.wavelengthUm).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < wl.length; i++) if (wl[i] - wl[i - 1] > maxGapUm + GAP_EPS) gaps.push([wl[i - 1], wl[i]]);
  const noData = list.length - measured.length;
  const parts = [`${measured.length} of ${list.length} images were measured here`];
  if (noData) parts.push(`${noData} had no data at this position (shown as “—” in the table, never filled in)`);
  if (flagged) parts.push(`${flagged} of the measurements ${flagged === 1 ? "is" : "are"} flagged (⚠)`);
  if (gaps.length) parts.push(`no image covers ${gaps.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)} µm`).join(", ")}: the spectrum is not drawn across ${gaps.length === 1 ? "it" : "them"}`);
  return { total: list.length, measured: measured.length, noData, flagged, gaps, text: `${parts.join("; ")}.` };
}

/** "#RRGGBB" with an opacity -> "rgba(r, g, b, a)" (for the fill of a band). */
export function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return `rgba(128, 128, 128, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}
