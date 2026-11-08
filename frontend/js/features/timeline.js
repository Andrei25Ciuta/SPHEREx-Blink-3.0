// timeline.js – the timeline of the images on screen, as pure functions (no DOM; tested with Node: scratch/test_timeline.mjs).
//
// Each image is one point: its place in TIME ORDER along x (images are grouped by survey pass, with a gap between passes; the spacing
// inside a pass is by order, not to scale) and its WAVELENGTH up y (SPHEREx has a variable filter, so every image of a detector has its own).
// A filter chooses which images the blink visits and which ones Stack, Trail and Difference use: a wavelength window and a list of survey
// passes to leave out. The searches (Find movers, Find everything) always use all the images: that is not changed here.

import { passIndices } from "./movers.js";      // the same meaning of "survey pass" as in Find movers and Compare

/** Middle of an image's wavelength band, µm. */
export const midWavelength = (f) => (f.wavelengthMinUm + f.wavelengthMaxUm) / 2;

/** { min, max } of the middle wavelengths, or null when there are no usable numbers. */
export function wavelengthRange(frames) {
  const w = frames.map(midWavelength).filter(Number.isFinite);
  return w.length ? { min: Math.min(...w), max: Math.max(...w) } : null;
}

/** An image with more than this share of flagged pixels counts as badly flagged: the limit of "Skip frames with > 1 % flagged pixels". */
export const FLAGGED_LIMIT = 0.01;
export const hasManyFlags = (f) => Boolean(f.flags) && f.flags.fractionFlagged > FLAGGED_LIMIT;

const day = (f) => String(f.dateISO).slice(0, 10);

/** Survey passes of frames in time order: [{ id, indices, first, last, label }]. */
export function surveyPasses(frames) {
  if (!frames.length) return [];
  const pass = passIndices(frames.map((f) => f.mjd));
  const out = [];
  for (let p = 0; p <= pass.at(-1); p++) {
    const indices = frames.map((_, i) => i).filter((i) => pass[i] === p);
    const first = day(frames[indices[0]]), last = day(frames[indices.at(-1)]);
    out.push({ id: p, indices, first, last, label: `Pass ${p + 1}`, when: first === last ? first : `${first} → ${last}` });
  }
  return out;
}

/**
 * Where every image and every pass goes on the plot, as fractions of its width and height.
 * -> { range, points: [{ index, pass, x, y }], passes: [{ id, x0, x1 }] }   x: 0 = left (earliest), y: 0 = bottom (shortest wavelength)
 * `gap` = the width of the space between two passes, in units of one image.
 */
export function layoutTimeline(frames, { gap = 1.2 } = {}) {
  const passes = surveyPasses(frames), range = wavelengthRange(frames);
  const total = frames.length + gap * Math.max(0, passes.length - 1);
  const points = new Array(frames.length), spans = [];
  let cursor = 0;
  for (const p of passes) {
    const start = cursor;
    for (const i of p.indices) {
      const w = midWavelength(frames[i]);
      const y = range && range.max > range.min && Number.isFinite(w) ? (w - range.min) / (range.max - range.min) : 0.5;
      points[i] = { index: i, pass: p.id, x: (cursor + 0.5) / total, y };
      cursor += 1;
    }
    spans.push({ id: p.id, x0: start / total, x1: cursor / total });
    cursor += gap;
  }
  return { range, points, passes: spans };
}

/**
 * The images that pass the filter: indices in order. filter = { wlMin, wlMax, offPasses } where wlMin / wlMax are µm (null or missing = no limit)
 * and offPasses is a Set (or array) of pass ids that are switched off. A bound a hair outside the range of an image still keeps it (1e-6 µm).
 */
export function activeIndices(frames, filter = {}) {
  const { wlMin = null, wlMax = null } = filter;
  const off = new Set(filter.offPasses ?? []);
  const pass = passIndices(frames.map((f) => f.mjd));
  const eps = 1e-6;
  return frames.map((_, i) => i).filter((i) => {
    if (off.has(pass[i])) return false;
    const w = midWavelength(frames[i]);
    if (wlMin !== null && w < wlMin - eps) return false;
    if (wlMax !== null && w > wlMax + eps) return false;
    return true;
  });
}

/** True when the filter leaves out anything at all. */
export const isFiltered = (active, total) => active.length !== total;

/**
 * The next (dir = +1) or previous (dir = -1) image to show, going round: only images in `active` (sorted indices) are visited.
 * `current` need not be active (you may have looked at a switched-off image on purpose): next = the first active image after it.
 * With no active image the current one stays.
 */
export function stepActive(current, active, dir) {
  if (!active.length) return current;
  if (dir >= 0) return active.find((i) => i > current) ?? active[0];
  for (let k = active.length - 1; k >= 0; k--) if (active[k] < current) return active[k];
  return active.at(-1);
}

/** One sentence about one image, for tooltips and screen readers: "Image 7 of 18 · 2026-03-15 02:27 UTC · D2 · 1.50–1.53 µm · no flagged pixels". */
export function describeFrame(f, index, total) {
  const flagged = !f.flags ? "flags not known" : f.flags.anyFlagged ? `${(f.flags.fractionFlagged * 100).toFixed(1)} % of pixels flagged` : "no flagged pixels";
  return `Image ${index + 1} of ${total} · ${String(f.dateISO).slice(0, 16).replace("T", " ")} UTC · ${f.detector} · ${f.wavelengthMinUm.toFixed(2)}–${f.wavelengthMaxUm.toFixed(2)} µm · ${flagged}`;
}

/** The line above the plot: "D2 · 18 images · 4 survey passes · 1.09–1.68 µm · showing 12 of 18". */
export function timelineSummary(frames, active) {
  if (!frames.length) return "";
  const passes = surveyPasses(frames).length, range = wavelengthRange(frames);
  const parts = [frames[0].detector, `${frames.length} image${frames.length === 1 ? "" : "s"}`, `${passes} survey pass${passes === 1 ? "" : "es"}`];
  if (range) parts.push(`${range.min.toFixed(2)}–${range.max.toFixed(2)} µm`);
  if (isFiltered(active, frames.length)) parts.push(`showing ${active.length} of ${frames.length}`);
  return parts.join(" · ");
}
