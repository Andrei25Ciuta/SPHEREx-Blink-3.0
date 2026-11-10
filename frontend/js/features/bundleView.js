// bundleView.js – the page part of the reproducibility bundle (the manifest is made by bundle.js, tested with Node).
//
//   setupBundle({ els, getContext, getPixels, getCandidates, getRun, versions, download })
//
// getContext() -> { isReal, query, detector, frames, geo, unit, n, href, mode } or null when no images are loaded; getPixels(frames) -> Promise of { arrays, isFloat }; getRun() -> the provenance
// record of the last search, or null; versions: { movers: "movers-2", ... }; download(text, name, type) saves a file.
//
// A bundle that fails its own validation (a pixel, a path, an address of this computer) is NOT saved: the page says why.

import { buildBundle, validateBundle, hashArray } from "./bundle.js";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

export function setupBundle({ els, getContext, getPixels, getCandidates, getRun, versions, download }) {
  let busy = false;

  async function save() {
    if (busy) return;
    els.error.textContent = "";
    els.replay.replaceChildren();
    const ctx = getContext();
    if (!ctx) { els.status.textContent = "No images are loaded: load a field first."; return; }
    if (!globalThis.crypto?.subtle) { els.error.textContent = "The hashes need a secure page (https, or localhost): this browser page cannot compute them, so no bundle was made."; return; }
    busy = true; els.button.disabled = true;
    els.status.textContent = `Hashing the pixels of ${ctx.frames.length} image${ctx.frames.length === 1 ? "" : "s"}…`;
    try {
      const { arrays, isFloat } = await getPixels(ctx.frames);
      if (!arrays) throw new Error("the pixels of these images cannot be read in this browser, so they cannot be hashed");
      const digest = (bytes) => globalThis.crypto.subtle.digest("SHA-256", bytes);
      const hashes = {};
      for (let k = 0; k < ctx.frames.length; k++) hashes[`${ctx.frames[k].detector}@${ctx.frames[k].mjd}`] = await hashArray(arrays[k], digest);
      const bundle = buildBundle({ context: ctx, hashes, pixelKind: isFloat ? "float32 (the file's own unit)" : "8-bit grey (synthetic demo)", versions, run: getRun(), candidates: getCandidates() });
      const problems = validateBundle(bundle);
      if (problems.length) throw new Error(`the bundle failed its own check and was not saved: ${problems.slice(0, 3).join("; ")}`);
      const name = `spherex-bundle-${ctx.query.ra.toFixed(3)}_${ctx.query.dec.toFixed(3)}_${ctx.detector}.json`;
      download(JSON.stringify(bundle, null, 1) + "\n", name, "application/json");
      els.status.textContent = `Bundle saved as ${name}: ${bundle.images.length} image hash${bundle.images.length === 1 ? "" : "es"}, ${bundle.results.candidates.length} candidate${bundle.results.candidates.length === 1 ? "" : "s"}, `
        + `${bundle.searches.length ? "the settings of the last search" : "no search yet (run Find movers first to include its settings)"}. ${bundle.data.kind === "real" ? "Real data" : "SYNTHETIC data"}; no pixel, path or address of this computer is in it.`;
      els.replay.replaceChildren(el("p", {}, "Replay link (restores the field, the detector and the mode): ", el("a", { href: bundle.replay.link, textContent: bundle.replay.link })),
        ...(bundle.replay.command ? [el("p", {}, "Check it against the images and run the same search: ", el("code", { textContent: bundle.replay.command }))] : []));
    } catch (err) {
      els.error.textContent = `The bundle was not made: ${err.message}.`;
      els.status.textContent = "";
    } finally { busy = false; els.button.disabled = false; }
  }

  els.button.addEventListener("click", save);
  return { save };
}
