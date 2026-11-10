// textAnalysisView.js – the page part of the text analysis (the tables are made by textAnalysis.js, tested with Node).
//
//   setupTextAnalysis({ els, getContext, getPixels, getCandidates, download })
//
// getContext() -> { isReal, query, detector, frames, geo, scaleArcsec, unit, n } or null when no images are loaded; getPixels(frames) -> Promise of { arrays, masks, isFloat };
// getCandidates() -> the candidates on screen; download(text, name, type) saves a file.
//
// For a screen reader and for the keyboard: real tables (caption, column headers with scope, the first cell of a row as a row header), a live status that says what happened, and the focus
// moved to the heading of the result when it is ready, so that the user lands where the answer is and not at the button. No canvas, no colour that carries meaning.

import { detectSources, passIndices } from "./movers.js";
import { frameRows, sourceRows, candidateRows, provenanceLines, analysisSummary, toCsv, FRAME_COLUMNS, SOURCE_COLUMNS, CANDIDATE_COLUMNS } from "./textAnalysis.js";

const BOM = String.fromCharCode(0xfeff);                  // the mark Excel needs to read a UTF-8 CSV
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

/** A table with a caption, column headers and a row header in the first column. */
export function buildTable(caption, columns, rows, { rowHeader = true } = {}) {
  const head = el("tr", {}, ...columns.map(([, h]) => el("th", { scope: "col", textContent: h })));
  const body = rows.map((r) => el("tr", {}, ...columns.map(([k], i) => {
    const v = r[k] === null || r[k] === undefined || r[k] === "" ? "–" : String(r[k]);
    return i === 0 && rowHeader ? el("th", { scope: "row", textContent: v }) : el("td", { textContent: v });
  })));
  return [el("caption", { textContent: caption }), el("thead", {}, head), el("tbody", {}, ...body)];
}

export function setupTextAnalysis({ els, getContext, getPixels, getCandidates, download }) {
  let built = null, busy = false;

  function showSources(filter) {
    const rows = built.sources.rows.filter((r) => filter === "all" || String(r.frame) === filter);
    els.sources.replaceChildren(...buildTable(`Dots found in ${filter === "all" ? "every image" : `image ${filter}`}, brightest first: ${rows.length} row${rows.length === 1 ? "" : "s"}.`, SOURCE_COLUMNS, rows, { rowHeader: false }));
    els.sourcesNote.textContent = `${rows.length} dot${rows.length === 1 ? "" : "s"} listed.${built.sources.left ? ` The faintest ${built.sources.left} dot${built.sources.left === 1 ? "" : "s"} of crowded images are not in the table (the list is capped at 60 per image).` : ""} `
      + "Flux in physical units is not in this table: click a source in the picture for its aperture spectrum. A warning means the position of that dot is less reliable.";
  }

  function showCandidates() {
    const c = built.ctx, cands = getCandidates();
    const sorted = [...c.frames].sort((a, b) => a.mjd - b.mjd);
    const usable = cands.every((m) => m.nFrames === sorted.length);          // the candidates come from the same images as this table; if not, do not guess which image is which
    const rows = candidateRows(cands, { scaleArcsec: c.geo.scaleArcsec, n: c.n, ...(usable ? { passOf: passIndices(sorted.map((f) => f.mjd)), perFrame: built.perFrame } : {}) });
    built.candidates = rows;
    els.cands.replaceChildren(...buildTable(rows.length ? `${rows.length} candidate${rows.length === 1 ? "" : "s"}, best first.` : "No candidates yet.", CANDIDATE_COLUMNS, rows));
    els.candsNote.textContent = rows.length ? "A candidate is a lead, never a discovery. The status column says what is and is not known. The velocity error is the sum, in quadrature, of the parts shown; tested on real images with injected movers, the true velocity fell inside it for 61 to 82 % of bright fakes (68 % expected) and the tails are heavy, so a large miss is likelier than the error bar says (VALIDATION 20)." : "Run Find movers (or Look for a distant body) in the search panel, then build this analysis again.";
  }

  async function build() {
    if (busy) return;
    const ctx = getContext();
    els.error.textContent = "";
    if (!ctx) { els.status.textContent = "No images are loaded: load a field first, then build the text analysis."; els.out.hidden = true; return; }
    busy = true; els.button.disabled = true;
    els.status.textContent = `Finding the dots in ${ctx.frames.length} image${ctx.frames.length === 1 ? "" : "s"}…`;
    try {
      const { arrays, masks, isFloat } = await getPixels(ctx.frames);
      if (!arrays) throw new Error("the pixels of these images cannot be read in this browser, so the dots cannot be listed");
      const perFrame = ctx.frames.map((frame, k) => ({ frame, image: arrays[k], mask: masks?.[k] ?? null,
        sources: detectSources(arrays[k], ctx.n, { ...(isFloat ? { sigmaFloor: 1e-9 } : {}), mask: masks?.[k] ?? null }) }));
      const sources = sourceRows(perFrame, ctx.n, ctx.geo);
      built = { frames: frameRows(ctx.frames), sources, candidates: [], provenance: provenanceLines({ ...ctx, scaleArcsec: ctx.geo.scaleArcsec }), ctx, perFrame };
      els.prov.replaceChildren(...built.provenance.map((l) => el("li", { textContent: l })));
      els.frames.replaceChildren(...buildTable(`${built.frames.length} image${built.frames.length === 1 ? "" : "s"} in time order.`, FRAME_COLUMNS, built.frames));
      els.filter.replaceChildren(el("option", { value: "all", textContent: "every image" }), ...built.frames.map((f) => el("option", { value: String(f.number), textContent: `image ${f.number}, ${f.date}, ${f.detector}` })));
      showSources("all");
      showCandidates();
      els.out.hidden = false;
      els.status.textContent = analysisSummary({ frames: built.frames.length, sources: sources.rows.length, left: sources.left, candidates: built.candidates.length });
      els.provTitle.focus();                                  // the answer is under this heading: put the keyboard and the screen reader there
    } catch (err) {
      built = null; els.out.hidden = true;
      els.error.textContent = `The text analysis failed: ${err.message}. Nothing is shown in its place.`;
      els.status.textContent = "";
    } finally { busy = false; els.button.disabled = false; }
  }

  const csv = (rows, columns, name) => () => { if (built) download(BOM + toCsv(rows(), columns, built.provenance), name, "text/csv;charset=utf-8"); };
  els.button.addEventListener("click", build);
  els.filter.addEventListener("change", () => { if (built) { showSources(els.filter.value); els.status.textContent = `Showing the dots of ${els.filter.value === "all" ? "every image" : `image ${els.filter.value}`}.`; } });
  els.framesCsv.addEventListener("click", csv(() => built.frames, FRAME_COLUMNS, "spherex-text-images.csv"));
  els.sourcesCsv.addEventListener("click", csv(() => built.sources.rows, SOURCE_COLUMNS, "spherex-text-dots.csv"));
  els.candsCsv.addEventListener("click", csv(() => built.candidates, CANDIDATE_COLUMNS, "spherex-text-candidates.csv"));
  return { build, refreshCandidates: () => { if (built) showCandidates(); }, get built() { return built; } };
}
