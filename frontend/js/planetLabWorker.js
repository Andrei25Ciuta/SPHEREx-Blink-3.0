// planetLabWorker.js – runs the Planet X Lab's injection test (features/planetLab.js) in a module worker, so that the page stays usable while it works.
//
// The test is many searches (each one detects the dots in a dozen images and links them); on the main thread it would freeze the page for minutes. The page
// (features/planetLabView.js) copies the pixels of the images on screen to this worker, which injects the synthetic bodies, runs the app's own search on them and
// reports every try. Cancel = the page terminates the worker. No DOM and no network here.
//
// Messages in:  { type: "run", arrays, masks, mjds, geo, isFloat, distancesAU, fluxesMilliJy, trials, seed, searchOptions }
// Messages out: { type: "progress", done, total, cell: { row, col, tries, found, distanceRight } } after every try,
//               { type: "done", cells, finished, done, total, seconds }, or { type: "error", message }.

import { recoveryTrial, runCompleteness, registrationOf, mulberry32 } from "./features/planetLab.js";
import { detectSources } from "./features/movers.js";

self.onmessage = async (event) => {
  const m = event.data;
  if (!m || m.type !== "run") return;
  try {
    const started = Date.now();
    const detectOptions = m.isFloat ? { sigmaFloor: 1e-9 } : {};
    const plain = m.arrays.map((a, k) => ({ mjd: m.mjds[k], sources: detectSources(a, m.geo.n, { ...detectOptions, mask: m.masks?.[k] ?? null }) }));
    const shifts = registrationOf(plain);                                  // where the field stars are on each exposure: a real body moves with them
    const context = { arrays: m.arrays, masks: m.masks, mjds: m.mjds, geo: m.geo, shifts, detectOptions, searchOptions: m.searchOptions ?? {} };
    const result = await runCompleteness({
      distancesAU: m.distancesAU, fluxesMilliJy: m.fluxesMilliJy, trials: m.trials, rng: mulberry32(m.seed),
      run: (spec) => recoveryTrial(context, spec),
      onProgress: (done, total, c) => self.postMessage({ type: "progress", done, total, cell: { row: c.row, col: c.col, tries: c.tries, found: c.found, distanceRight: c.distanceRight } }),
    });
    self.postMessage({ type: "done", ...result, seconds: (Date.now() - started) / 1000 });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err?.message ?? err) });
  }
};
