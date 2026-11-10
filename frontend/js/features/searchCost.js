// searchCost.js – how big is a search, said before it starts (pure: no DOM, no network).
//
// Find movers on synthetic images took 0.2-1.1 microseconds per pixel (images x side x side) on the machine that measured it (scratch/measure_search_cost.mjs, docs/BENCHMARKS.md section 4);
// a real field with many stars, a slower computer or the Planet X search (which scales with the number of dots, not pixels) can take several times longer. So the page shows the SIZE of the
// search (images, pixels) and a rough range with its provenance, and warns above a size; it never refuses, because Cancel is the safety net.

export const NS_PER_PIXEL = { low: 200, high: 1100 };        // measured range on one machine, synthetic images (scratch/measure_search_cost.mjs)
export const WARN_PIXELS = 5_000_000;                         // above this the range is several seconds on the measuring machine: say so

export function estimateSearch(images, side) {
  const pixels = Math.max(0, images) * Math.max(0, side) * Math.max(0, side);
  const lowS = (pixels * NS_PER_PIXEL.low) / 1e9, highS = (pixels * NS_PER_PIXEL.high) / 1e9;
  return { images, side, pixels, lowSeconds: lowS, highSeconds: highS, large: pixels > WARN_PIXELS };
}

const seconds = (s) => (s < 1 ? "under a second" : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const millions = (p) => (p >= 1e6 ? `${(p / 1e6).toFixed(1)} million` : `${Math.round(p / 1000)} thousand`);

/** One sentence for the status line. `cancellable`: a worker will run it, so Cancel works. */
export function describeEstimate(e, { cancellable = true } = {}) {
  const range = e.highSeconds < 1 ? "under a second" : `roughly ${seconds(e.lowSeconds)} to ${seconds(e.highSeconds)}`;
  return `${e.images} images of ${e.side} × ${e.side} pixels (${millions(e.pixels)} pixels): ${range} on the computer this was measured on; yours may differ`
    + `${e.large ? ", and a large search can take much longer" : ""}. ${cancellable ? "You can cancel it." : "It cannot be cancelled here (no background worker)."}`;
}
