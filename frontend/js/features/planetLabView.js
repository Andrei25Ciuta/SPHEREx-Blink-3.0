// planetLabView.js – the page part of the Planet X Lab (the maths is in planetLab.js, tested with Node; the worker is ../planetLabWorker.js).
//
//   const lab = setupPlanetLab({ els, getContext, getSelection, download, makeWorker });
//   lab.refresh();     // call it when the images or the selected candidate change: it enables or disables the buttons
//
// getContext()   -> Promise of { arrays, masks, mjds, geo, isFloat, dataText, searchOptions? } for the images on screen (the same ones the searches use), or null
// getSelection() -> { candidate, dots, mjds, geo } for the candidate selected in the list, or null
// download(text, name, mime) saves a file.
//
// Two blocks: "Which motion fits?" (modelComparison on the dots of the selected candidate) and "How likely is a distant body to be found?" (the injection test, run in a
// worker, drawn as a map of cells: tries, how many found, the word for it and the share in the colour). The map says in plain words that the bodies are synthetic.

import {
  VERSION as LAB_VERSION, modelComparison, observationsOf, parseNumberList, cellText, completenessCsv, completenessWord, swingArcsec, wilson,
} from "./planetLab.js";
import { VERSION as SEARCH_VERSION } from "./parallax.js";

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const pct = (v) => `${Math.round(v * 100)} %`;
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "–");

/** The table and the sentences of one model comparison. */
export function renderComparison(out, result, { sigmaPx }) {
  out.textContent = "";
  if (!result.usable) { out.append(el("p", { className: "muted", textContent: `Cannot compare the motions: ${result.reason}.` })); return; }
  const rows = result.models.map((m) => el("tr", { className: m.id === result.preferred ? "is-best" : "" },
    el("th", { scope: "row", textContent: m.label + (m.id === result.preferred ? " ✓" : "") }),
    el("td", { className: "num", textContent: String(m.params) }), el("td", { className: "num", textContent: m.usable ? fmt(m.chi2) : "–" }),
    el("td", { className: "num", textContent: m.usable ? fmt(m.reducedChi2, 2) : "no dof" }), el("td", { className: "num", textContent: fmt(m.bic) }),
    el("td", { className: "num", textContent: m.usable ? (m.deltaBic === 0 ? "0 (best)" : `+${fmt(m.deltaBic)}`) : "–" })));
  const table = el("table", { className: "lab-models" }, el("caption", { className: "sr-only", textContent: "The three motions compared: parameters, chi-square, chi-square per degree of freedom, BIC and its difference from the best." }),
    el("thead", {}, el("tr", {}, ...["Motion", "Parameters", "χ²", "χ² / dof", "BIC", "ΔBIC"].map((t, i) => el("th", { scope: "col", className: i ? "num" : "", textContent: t })))), el("tbody", {}, ...rows));
  const best = result.models.find((m) => m.id === result.preferred);
  out.append(el("div", { className: "table-scroll" }, table),
    el("p", { textContent: `Preferred: ${best.label} (${result.strength}).`, className: "lab-verdict" }),
    el("p", { className: `lab-distance lab-${result.distance.status}`, textContent: result.distance.text }),
    ...result.notes.map((t) => el("p", { className: "muted small", textContent: t })),
    el("p", { className: "muted small", textContent: `${result.N} numbers (2 per position). Each position is given an error of ${sigmaPx} px per axis (the floor the parallax search uses, not calibrated: VALIDATION 15.6). ΔBIC above 10 is “very strong” (Kass & Raftery, from memory); the distance is only quoted when the swing beats a straight line by that much and its 95 % range is closed.` }));
}

export function setupPlanetLab({ els, getContext, getSelection, download, canRun = () => true, makeWorker = () => new Worker(new URL("../planetLabWorker.js", import.meta.url), { type: "module" }) }) {
  let worker = null, lastRun = null, lastComparison = null;
  const SIGMA_PX = 0.15;

  function refresh() {
    const sel = getSelection();
    els.compareBtn.disabled = !(sel && sel.dots?.length >= 3);
    els.modelsHint.textContent = sel ? (sel.dots.length >= 3 ? `Candidate ${sel.candidate.label ?? ""} has ${sel.dots.length} dots.` : "The selected candidate has fewer than 3 dots.") : "Select a candidate in the list (Find movers, or Look for a distant body), then compare.";
    els.runBtn.disabled = Boolean(worker) || !canRun();
  }

  els.compareBtn.addEventListener("click", () => {
    const sel = getSelection();
    if (!sel || !sel.dots?.length) return;
    const obs = observationsOf(sel.dots, sel.mjds, sel.geo.scaleArcsec, { sigmaPx: SIGMA_PX });
    const result = modelComparison(obs, { ra: sel.geo.ra, dec: sel.geo.dec });
    lastComparison = { label: sel.candidate.label, result };
    renderComparison(els.modelsOut, result, { sigmaPx: SIGMA_PX });
  });

  function drawMap(cells, distancesAU, fluxes, geo, { partial = false, note = "" } = {}) {
    els.mapWrap.hidden = false;
    const fieldArcsec = geo.n * geo.scaleArcsec;
    const head = el("tr", {}, el("th", { scope: "col", textContent: "mJy ↓  /  AU →" }), ...distancesAU.map((d, i) => {
      const swing = swingArcsec(geo.ra, geo.dec, lastRun.mjds, d);
      const leaves = swing > fieldArcsec / 2;
      return el("th", { scope: "col", className: leaves ? "leaves" : "", title: `The swing of the Earth moves a body at ${d} AU by up to ${Math.round(swing)}″ (${(swing / 60).toFixed(1)}′) between the dates. The field is ${(fieldArcsec / 60).toFixed(1)}′ wide.` },
        `${d} AU`, el("span", { className: "lab-swing", textContent: leaves ? `swing ${(swing / 60).toFixed(0)}′: leaves the field` : `swing ${(swing / 60).toFixed(1)}′` }));
    }));
    const byRow = new Map();
    for (const c of cells) { if (!byRow.has(c.row)) byRow.set(c.row, []); byRow.get(c.row)[c.col] = c; }
    const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => el("tr", {}, el("th", { scope: "row", textContent: `${list[0].fluxMilliJy} mJy` }), ...list.map((c) => {
      const f = c.tries ? c.found / c.tries : null;
      const td = el("td", { className: `lab-cell${c.tries ? "" : " is-empty"}`, title: c.tries ? `${c.found} of ${c.tries} tries found it (${pct(wilson(c.found, c.tries)[0])}–${pct(wilson(c.found, c.tries)[1])}, 95 %); the distance was right in ${c.distanceRight}` : "not run" },
        el("span", { className: "lab-cell-num", textContent: cellText(c) }), el("span", { className: "lab-cell-word", textContent: c.tries ? completenessWord(f) : "not run" }));
      td.style.setProperty("--f", String(f ?? 0));
      return td;
    })));
    els.map.replaceChildren(el("caption", { className: "sr-only", textContent: "Share of synthetic bodies found, by distance (columns) and brightness (rows)." }), el("thead", {}, head), el("tbody", {}, ...rows));
    els.mapNote.textContent = note;
  }

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (worker) return;
    els.inputError.textContent = "";
    const d = parseNumberList(els.distances.value, { min: 50, max: 20000, maxCount: 6, what: "distance (AU)" });
    const f = parseNumberList(els.fluxes.value, { min: 0.01, max: 100000, maxCount: 6, what: "brightness (mJy)" });
    if (d.error || f.error) { els.inputError.textContent = d.error || f.error; return; }
    const trials = Number(els.trials.value);
    els.status.textContent = "Reading the pixels of the images on screen…";
    const ctx = await getContext();
    if (!ctx) { els.status.textContent = "Load images first."; return; }
    if (!ctx.isFloat) { els.status.textContent = "The injection test needs the real (float) pixel values of SPHEREx images; these images have only an 8-bit picture, so a brightness in mJy means nothing here. Nothing was run."; return; }
    if (ctx.mjds.length < 3) { els.status.textContent = "Needs images from at least 3 survey passes."; return; }
    lastRun = { ...ctx, distancesAU: d.values, fluxesMilliJy: f.values, trials, seed: Math.floor(Math.random() * 1e9), startedAt: new Date() };
    const total = d.values.length * f.values.length * trials;
    els.progress.hidden = false; els.progress.max = total; els.progress.value = 0;
    els.runBtn.disabled = true; els.cancelBtn.hidden = false;
    els.status.textContent = `Running ${total} tries (each is a whole search). The page stays usable; this takes a while.`;
    try { worker = makeWorker(); } catch (err) { els.status.textContent = `Cannot start the worker: ${err.message}. Nothing was run.`; els.runBtn.disabled = false; els.cancelBtn.hidden = true; return; }
    const partial = new Map();
    const finish = (message) => { worker?.terminate(); worker = null; els.cancelBtn.hidden = true; els.progress.hidden = true; refresh(); if (message) els.status.textContent = message; };
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "progress") {
        els.progress.value = m.done; els.status.textContent = `${m.done} of ${m.total} tries done…`;
        partial.set(`${m.cell.row}:${m.cell.col}`, m.cell);
        const cells = [];
        [...f.values].sort((a, b) => b - a).forEach((flux, row) => d.values.forEach((dist, col) => { const p = partial.get(`${row}:${col}`); cells.push({ row, col, distanceAU: dist, fluxMilliJy: flux, tries: p?.tries ?? 0, found: p?.found ?? 0, distanceRight: p?.distanceRight ?? 0 }); }));
        drawMap(cells, d.values, f.values, ctx.geo, { partial: true });
      } else if (m.type === "done") {
        lastRun.result = m;
        drawMap(m.cells, d.values, f.values, ctx.geo, { note: "Each cell: tries in which the search found the injected body / tries. “Found” = a candidate within 3 px of the body on at least half of the images. The word and the colour repeat the share; the tooltip gives the 95 % Wilson interval. The bodies are SYNTHETIC; the images are real." });
        els.provenance.textContent = provenanceText(lastRun, m);
        finish(`Done: ${m.done} tries in ${m.seconds.toFixed(0)} s.`);
      } else if (m.type === "error") finish(`The test failed: ${m.message}`);
    };
    worker.onerror = (ev) => finish(`The test failed: ${ev.message || "the worker stopped"}`);
    const copy = (a) => Float32Array.from(a);
    worker.postMessage({ type: "run", arrays: ctx.arrays.map(copy), masks: ctx.masks?.map((x) => (x ? Uint8Array.from(x) : null)) ?? null, mjds: ctx.mjds, geo: ctx.geo, isFloat: ctx.isFloat,
      distancesAU: d.values, fluxesMilliJy: f.values, trials, seed: lastRun.seed, searchOptions: ctx.searchOptions ?? {} });
  });

  els.cancelBtn.addEventListener("click", () => { worker?.terminate(); worker = null; els.cancelBtn.hidden = true; els.progress.hidden = true; els.status.textContent = "Cancelled: the map shows the tries done so far."; refresh(); });
  els.csvBtn.addEventListener("click", () => {
    if (!lastRun?.result) return;
    download(completenessCsv(lastRun.result.cells, provenanceFields(lastRun, lastRun.result)), `planet-x-lab-completeness_${lastRun.startedAt.toISOString().slice(0, 10)}.csv`, "text/csv");
  });

  refresh();
  /** The comparison of motions made for the candidate with this label (the explainer quotes it), or null when none was made. */
  return { refresh, comparisonFor: (label) => (lastComparison?.label === label ? lastComparison.result : null) };
}

/** What a result was made with, as fields (the CSV header and the text under the map). */
export function provenanceFields(run, result) {
  return {
    lab: `${LAB_VERSION} (search ${SEARCH_VERSION})`,
    images: `${run.mjds.length} images, ${run.dataText}`,
    field: `RA ${run.geo.ra.toFixed(4)} Dec ${run.geo.dec.toFixed(4)}, ${run.geo.n} x ${run.geo.n} px of ${run.geo.scaleArcsec.toFixed(2)} arcsec`,
    injected_body: "SYNTHETIC: Gaussian PSF of sigma 0.4 px integrated over the pixels, own drift 0.5-1.0 x the circular orbit speed in a random direction, random place in the middle half of the field",
    distances_au: run.distancesAU.join(" "),
    flux_mjy: run.fluxesMilliJy.join(" "),
    tries_per_cell: run.trials,
    recovered: "a candidate within 3 px of the body on at least half of the images",
    seed: run.seed,
    made: `${run.startedAt.toISOString()}, ${result.finished ? "finished" : "stopped early"}, ${result.done} of ${result.total} tries`,
  };
}
const provenanceText = (run, result) => Object.entries(provenanceFields(run, result)).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}.`).join(" ");
