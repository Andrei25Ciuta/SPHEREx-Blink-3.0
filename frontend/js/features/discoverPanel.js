// discoverPanel.js – the "Find everything" panel: runs discover() on the images on screen, lists every source (known ones too),
// and shows the dossier of the one you click. Nothing is hidden: the filter only chooses what to look at.
//
// Pure helpers are exported for the Node tests (headline, leadSentence, FILTERS, SORTS, pointsFor, stampPixels, pickStamps);
// setupDiscoverPanel() is the only part that touches the page.

import { discover, NEEDS_CHECKING_SCORE, stampFor, SETTINGS, VERSION } from "./discovery.js";
import { buildProvenance, provenanceText } from "./provenance.js";
import { FILTERS } from "./candidateExplorer.js";
import { createExplorer } from "./candidateExplorerView.js";
import { fetchAllCatalogues } from "./catalogueRelay.js";
import { fetchSkybotForFrames } from "./skybot.js";
import { candidateDossier, dossierMarkdown, candidatesToCsv, candidatesToJson, trackletCsv, dossierFileName, listFileName, degToHms, degToDms } from "./dossier.js";

const MAX_LISTED = 300;
const STAMP_COUNT = 8;

const median = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
export const medianFlux = (c) => median(c.photometry.filter((p) => c.frames.includes(p.frame) && !p.flagged).map((p) => p.fluxMilliJy));

export { FILTERS };                                           // they live in candidateExplorer.js now: the table and the results page use them too
export const SORTS = {
  best: ["Most interesting first", null],                       // the order discover() returns
  support: ["Support score", (a, b) => b.support - a.support],
  flux: ["Brightest", (a, b) => (Number.isFinite(medianFlux(b)) ? medianFlux(b) : -Infinity) - (Number.isFinite(medianFlux(a)) ? medianFlux(a) : -Infinity)],
  ra: ["Position (RA)", (a, b) => a.ra - b.ra],
};

/** One line that says what the source is. */
export function headline(c) {
  const speed = c.motionIsReal ? Math.hypot(c.pmEast, c.pmNorth) : null;
  const moving = speed === null ? "" : ` · moving ${speed.toFixed(speed < 10 ? 1 : 0)}″/yr`;
  if (c.body) return `${c.body.name}${c.body.vmag !== null && c.body.vmag !== undefined ? ` (V ${c.body.vmag})` : ""} · known ${c.body.cls || "Solar System body"}`;
  const m = c.catalogue?.matches?.[0];
  if (m) return `${m.label}: ${m.id.length > 34 ? m.id.slice(0, 33) + "…" : m.id}${moving}`;
  const what = c.kind === "distant" ? "possible distant body" : c.tags.includes("transient") ? "appears in one pass only" : c.kind === "mover" ? "moving source" : "fixed source";
  return `${what}${moving}`;
}

/** A candidate as one flat row for the table (candidateExplorer.js describes the row). A flux that cannot be measured is null, never 0. */
export function explorerRow(c) {
  const m = c.catalogue?.matches?.[0], flux = medianFlux(c), speed = c.motionIsReal ? Math.hypot(c.pmEast, c.pmNorth) : null;
  return {
    id: c.id, class: c.class, classLabel: c.classLabel ?? c.class, headline: headline(c), ra: c.ra, dec: c.dec, motion: speed,
    nDet: c.nDet, nFrames: c.nFrames, passes: c.passes, snr: Number.isFinite(c.medianSnr) ? c.medianSnr : null, support: c.support,
    fluxMilliJy: Number.isFinite(flux) ? flux : null, tags: [...c.tags], match: m ? `${m.label} ${m.id}` : c.body ? c.body.name : "",
  };
}

/**
 * The points of the spectrum sketch in the table: wavelength (µm) against flux (mJy), over the images where the source was measured and not flagged.
 * undefined when there are fewer than 3 (a shape needs three points). Only the live app has them: the published results page has no spectra.
 */
export function spectrumPoints(c) {
  const pts = (c.photometry ?? []).filter((p) => p.measured && !p.flagged && Number.isFinite(p.wavelengthUm) && Number.isFinite(p.fluxMilliJy)).map((p) => ({ x: p.wavelengthUm, y: p.fluxMilliJy }));
  return pts.length >= 3 ? pts : undefined;
}

/** The second line of a list item. */
export function subline(c) {
  const parts = [`RA ${degToHms(c.ra)}  Dec ${degToDms(c.dec)}`, `seen in ${c.nDet} of ${c.nFrames} images`, `S/N ${Number.isFinite(c.medianSnr) ? c.medianSnr.toFixed(0) : "–"}`, `support ${c.support}/100`];
  const extra = c.tags.filter((t) => t !== "moving").map((t) => ({ "very-red": "very red", red: "red", transient: "one pass only", distant: "parallax" }[t] ?? t));
  return parts.concat(extra).join(" · ");
}

/** What the result means, in a sentence a visitor can read. */
export function leadSentence(c) {
  const tried = c.catalogue?.checked ?? [], skipped = c.catalogue?.notChecked ?? [];
  const list = tried.length ? tried.join(", ") : "any catalogue";
  const skipNote = skipped.length ? ` (not checked: ${skipped.join(", ")})` : "";
  if (c.body) return `This is ${c.body.name}, a known ${c.body.cls || "Solar System body"}: SkyBoT puts it at this spot in ${c.body.hits} image${c.body.hits === 1 ? "" : "s"}.`;
  const m = c.catalogue?.matches?.[0];
  if (m) return `It matches ${m.label} ${m.id}, ${m.sepArcsec.toFixed(1)}″ away${m.mag ? ` (${m.mag})` : ""}${m.pm !== null && m.pm !== undefined ? `, proper motion ${m.pm.toFixed(2)}″/yr` : ""}. It is a known source.`;
  if (c.class === "unchecked") return `It was not compared with a deep catalogue (${skipped.length ? skipped.join(", ") + " did not answer or were not asked" : "synthetic data, or no catalogue server answered"}), so nothing can be said about whether it is new.`;
  if (c.class === "artefact") return `Nothing in ${list} sits there${skipNote}, but its flags look like an artefact (${c.flags.filter((f) => f.severity !== "info").map((f) => f.code).join(", ")}): check the images before anything else.`;
  if (c.class === "unknown-weak") return `Nothing in ${list} sits there${skipNote}, and it is not a known asteroid, but the images support it weakly (score ${c.support}, below ${NEEDS_CHECKING_SCORE}): it may be noise. Listed so that nothing is hidden.`;
  return `Nothing in ${list} sits there${skipNote}, and it is not a known asteroid. It needs a person to look at it. It is a lead, not a discovery.`;
}

/** Where a candidate is on each image of the player, as image fractions (what player.setCandidates draws). */
export function pointsFor(c, run, playerFrames, frameId) {
  const index = new Map(run.frames.map((f, g) => [f.id, g]));
  const known = c.rawPositions.map((p, g) => (p ? { g, mjd: run.frames[g].mjd, x: p.x, y: p.y } : null)).filter(Boolean);
  return playerFrames.map((pf) => {
    const g = index.get(frameId(pf));
    let p = g !== undefined ? c.rawPositions[g] : null;
    if (!p && known.length) p = known.reduce((best, k) => (Math.abs(k.mjd - pf.mjd) < Math.abs(best.mjd - pf.mjd) ? k : best), known[0]);     // seen in one image only: the nearest in time
    return { fx: (p?.x ?? 0) / run.n, fy: (p?.y ?? 0) / run.n };
  });
}

/** Which images to show as stamps: where it was detected first (by wavelength), then a few where it was not, so that absence is visible too. */
export function pickStamps(c, frames, count = STAMP_COUNT) {
  const byWave = (a, b) => (frames[a].wavelengthUm ?? 0) - (frames[b].wavelengthUm ?? 0);
  const seen = [...c.frames].sort(byWave);
  const missing = frames.map((_, g) => g).filter((g) => !c.frames.includes(g) && c.rawPositions[g]).sort(byWave);
  const nSeen = Math.min(seen.length, missing.length ? Math.max(count - 2, count >> 1) : count);
  const pick = (list, k) => (k >= list.length ? list : Array.from({ length: k }, (_, i) => list[Math.round((i * (list.length - 1)) / Math.max(1, k - 1))]));
  const a = pick(seen, nSeen), b = pick(missing, Math.min(missing.length, count - a.length));
  return [...new Set([...a, ...b])].sort(byWave).map((g) => ({ g, detected: c.frames.includes(g) }));
}

/** Grey values (0-255, RGBA) for one stamp: a stretch from the stamp's own background and noise, so that noise stays noise. */
export function stampPixels(stamp) {
  const { size, values } = stamp;
  const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  const out = new Uint8ClampedArray(size * size * 4);
  const bg = finite.length ? finite[finite.length >> 1] : 0;
  const dev = finite.map((v) => Math.abs(v - bg)).sort((a, b) => a - b);
  const sigma = Math.max(1.4826 * (dev[dev.length >> 1] ?? 0), 1e-12);
  const lo = bg - 1.5 * sigma, hi = Math.max(finite.length ? finite[finite.length - 1] : bg, bg + 6 * sigma);
  for (let i = 0; i < size * size; i++) {
    const v = values[i];
    const g = Number.isFinite(v) ? Math.sqrt(Math.min(1, Math.max(0, (v - lo) / (hi - lo)))) * 255 : 0;
    out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = g;
    out[4 * i + 3] = Number.isFinite(v) ? 255 : 90;
  }
  return out;
}

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k !== null && k !== undefined));
  return e;
};
const wavelengthOf = (f) => (Number.isFinite(f.wavelengthMinUm) && Number.isFinite(f.wavelengthMaxUm) ? (f.wavelengthMinUm + f.wavelengthMaxUm) / 2 : f.wavelengthUm ?? null);

/**
 * Wire the panel. deps:
 *   $ (getElementById), player, isReal, apiBase, skybotCache (Map), prefersReducedMotion,
 *   getField() -> { token, query: { ra, dec, fov }, geo, detector, frames, n, playerFrames } | null   (frames: the images to search, time-ordered)
 *   isCurrent(token), loadPixels(frames) -> { arrays, masks, isFloat }, frameId(frame),
 *   plotSpectrum(c), openMap(c), download(text, name, type), exportContext()
 */
export function setupDiscoverPanel(deps) {
  const { $, player, isReal } = deps;
  const els = {
    btn: $("discover-btn"), status: $("discover-status"), notes: $("discover-notes"), chips: $("discover-chips"), controls: $("discover-controls"),
    filter: $("discover-filter"), sort: $("discover-sort"), list: $("discover-list"), exports: $("discover-export"), detail: $("discover-detail"),
    provenance: $("discover-provenance"), provenanceText: $("discover-provenance-text"),
    views: $("discover-views"), viewCards: $("discover-view-cards"), viewTable: $("discover-view-table"), explorer: $("discover-explorer"),
  };
  let view = "cards";                                          // "cards": the list with the dossier inside the open item; "table": the explorer (table + plot)
  const explorer = createExplorer({
    root: els.explorer, threshold: NEEDS_CHECKING_SCORE,
    onSelect: (id) => { const c = run?.result.candidates.find((x) => x.id === id); if (c) select(c); },
  });
  els.filter.replaceChildren(...Object.entries(FILTERS).map(([k, [label]]) => el("option", { value: k, textContent: label })));
  els.sort.replaceChildren(...Object.entries(SORTS).map(([k, [label]]) => el("option", { value: k, textContent: label })));

  let run = null;               // { result, frames, n, field, ctx }
  let selected = null;          // the candidate whose dossier is open
  let highlighted = false;

  const setStatus = (t) => { els.status.textContent = t; };

  function clear() {
    if (highlighted) { player.setCandidates([]); highlighted = false; }
    run = null; selected = null;
    for (const k of ["notes", "chips", "controls", "list", "exports", "detail", "provenance", "views", "explorer"]) { els[k].hidden = true; }
    explorer.setRows([]);
    setView("cards");
    els.list.replaceChildren(); els.chips.replaceChildren(); els.notes.replaceChildren(); els.detail.replaceChildren();
    setStatus("Lists every source in these images, checks each against catalogues and known asteroids, and ranks what nothing explains.");
  }

  function refresh() {
    const f = deps.getField();
    els.btn.disabled = !f || f.frames.length < 3;
  }

  // ------------------------------------------------------------ the run
  els.btn.addEventListener("click", async () => {
    const field = deps.getField();
    if (!field) return;
    clear();
    els.btn.disabled = true;
    const startedAt = performance.now();
    const stale = () => !deps.isCurrent(field.token);
    try {
      const frames = [...field.frames].sort((a, b) => a.mjd - b.mjd);
      setStatus(`Reading the pixels of ${frames.length} images…`);
      await new Promise((r) => setTimeout(r, 30));
      const { arrays, masks, isFloat } = await deps.loadPixels(frames);
      if (stale()) return;
      if (!arrays) { setStatus("Cannot read the image pixels in this browser (images from another site), so the search cannot run."); return; }

      let catalogues = {}, notes = [], skybot = null;
      if (isReal) {
        const got = await fetchAllCatalogues({ ra: field.query.ra, dec: field.query.dec, fovArcmin: field.query.fov, apiBase: deps.apiBase, onProgress: (name) => { if (!stale()) setStatus(`Asking ${name}…`); }, shouldStop: stale });
        if (stale()) return;
        catalogues = got.catalogues; notes = got.notes;
        setStatus("Asking SkyBoT for known asteroids at each image date…");
        try {
          skybot = (await fetchSkybotForFrames(frames, { ra: field.query.ra, dec: field.query.dec, fovArcmin: field.query.fov }, { cache: deps.skybotCache, shouldStop: stale })).perFrame;
        } catch (err) { notes.push(`SkyBoT: ${err.message}`); }
        if (stale()) return;
      } else {
        notes.push("Synthetic demo data: there is no real sky to check against, so every source stays \"not checked\". This shows how the tool works; it finds nothing real.");
      }

      setStatus("Finding, vetting and classifying the sources…");
      await new Promise((r) => setTimeout(r, 30));
      const dframes = frames.map((f, i) => ({ id: deps.frameId(f), mjd: f.mjd, detector: f.detector, wavelengthUm: wavelengthOf(f), grey: arrays[i], mask: masks?.[i] ?? null, dateISO: f.dateISO }));
      const result = discover({ frames: dframes, n: field.n, geo: field.geo, isFloat, catalogues, skybot });
      if (stale()) return;
      const exportBase = deps.exportContext();
      // How this result was made, written NOW (the moment the search finished), so that every file saved later says when and with what it was run
      const provenance = buildProvenance({
        analysis: "find-everything", algorithm: { version: VERSION }, ctx: { ...exportBase, detector: field.detector, query: field.query }, frames: dframes,
        settings: { ...SETTINGS }, ranAt: new Date(), durationMs: performance.now() - startedAt,
        catalogues: isReal ? { used: result.summary?.catalogues ?? [], problems: notes } : { used: [], problems: notes },
        pixels: isFloat ? "float32 pixels in the file's own unit (backend)" : "8-bit pictures (no float pixels: synthetic data)",
      });
      run = { result, frames: dframes, n: field.n, field, notes, provenance,
        ctx: { ...exportBase, detector: field.detector, query: field.query, frames: dframes.map((f) => ({ id: f.id, dateISO: f.dateISO })), provenance } };
      show();
    } catch (err) {
      console.error(err);
      setStatus(`The search failed: ${err.message}`);
    } finally {
      refresh();
    }
  });

  // ------------------------------------------------------------ the list
  function chip(label, value, title) {
    return el("li", { title }, el("strong", { textContent: String(value) }), ` ${label}`);
  }

  function show() {
    const { result } = run;
    if (result.reason) { setStatus(`Cannot search: ${result.reason}.`); return; }
    const s = result.summary;
    const c = s.counts;
    els.chips.replaceChildren(
      chip("sources", s.total, "Every source the images show, known ones included"),
      chip("need checking", c.unknown, `Unknown to every catalogue checked, not a known asteroid, and support score of at least ${NEEDS_CHECKING_SCORE}`),
      chip("weakly supported", c["unknown-weak"], "Not explained, but the images support them weakly: possibly noise"),
      chip("known", s.known, "In a catalogue or a known Solar System body"),
      chip("possible artefacts", c.artefact, "Flags suggest a halo, edge effect or similar"),
      ...(c.unchecked ? [chip("not checked", c.unchecked, "No deep catalogue checked them")] : []),
    );
    els.chips.hidden = false;
    els.provenanceText.textContent = provenanceText(run.provenance);
    els.provenance.hidden = false;
    els.views.hidden = false;
    explorer.reset();
    explorer.setRows(result.candidates.map((c) => ({ ...explorerRow(c), spec: spectrumPoints(c) })));
    els.exports.hidden = false;
    setView(view);
    els.notes.replaceChildren(...run.notes.map((t) => el("li", { textContent: t })));
    els.notes.hidden = run.notes.length === 0;
    const sources = s.catalogues.length ? s.catalogues.join(", ") : "none";
    setStatus(`${s.total} source${s.total === 1 ? "" : "s"} in ${result.stats.frames} images (${result.stats.passes} survey passes). Catalogues used: ${sources}. ` +
      (c.unknown ? `${c.unknown} need${c.unknown === 1 ? "s" : ""} checking: click one for its evidence.` : s.total ? "Nothing is left unexplained by the catalogues." : "Nothing detected."));
    renderList();
  }

  function visible() {
    const keep = FILTERS[els.filter.value][1];
    const cmp = SORTS[els.sort.value][1];
    const list = run.result.candidates.filter(keep);
    return cmp ? [...list].sort(cmp) : list;
  }

  function renderList() {
    if (!run) return;
    const all = visible();
    const shown = all.slice(0, MAX_LISTED);
    els.list.replaceChildren(...shown.map((c) => {
      const li = el("li", { className: `discover-li cls-${c.class}` });
      const open = c === selected;
      const btn = el("button", { type: "button", className: "discover-item" },
        el("span", { className: "discover-badge", textContent: c.classLabel }),
        el("span", { className: "discover-main", textContent: headline(c) }),
        el("span", { className: "discover-sub", textContent: subline(c) }));
      btn.setAttribute("aria-expanded", String(open));
      btn.addEventListener("click", () => select(selected === c ? null : c));
      li.append(btn);
      if (open && view === "cards") li.append(els.detail);
      return li;
    }));
    if (all.length > MAX_LISTED) els.list.append(el("li", { className: "discover-more", textContent: `${all.length - MAX_LISTED} more are not listed here: use the filter, or save the table.` }));
    if (!all.length) els.list.append(el("li", { className: "discover-more", textContent: "Nothing matches this filter." }));
    els.list.hidden = view !== "cards";
    if (view === "cards" && selected && !shown.includes(selected)) select(null);
  }
  els.filter.addEventListener("change", renderList);
  els.sort.addEventListener("change", renderList);

  // ------------------------------------------------------------ cards or table
  /** "cards" = the list, one card per source, the dossier opens inside the card; "table" = the explorer, the dossier opens under the table. */
  function setView(v) {
    view = v;
    const table = v === "table";
    els.viewCards.setAttribute("aria-pressed", String(!table));
    els.viewTable.setAttribute("aria-pressed", String(table));
    const has = Boolean(run) && !run.result.reason;
    els.controls.hidden = !has || table;
    els.list.hidden = !has || table;
    els.explorer.hidden = !has || !table;
    if (table) els.exports.after(els.detail);                                       // the dossier under the table and the save buttons
    renderList();
    explorer.setSelected(selected?.id ?? null);
  }
  els.viewCards.addEventListener("click", () => setView("cards"));
  els.viewTable.addEventListener("click", () => setView("table"));

  // ------------------------------------------------------------ one source
  function select(c) {
    selected = c;
    explorer.setSelected(c?.id ?? null);
    if (!c) {
      els.detail.hidden = true;
      if (highlighted) { player.setCandidates([]); highlighted = false; }
      renderList();
      return;
    }
    player.setCandidates([{ label: c.id, points: pointsFor(c, run, deps.getField()?.playerFrames ?? player.frames, deps.frameId) }], 0);
    highlighted = true;
    buildDetail(c);
    renderList();
    els.detail.hidden = false;
    els.detail.scrollIntoView({ block: "nearest", behavior: deps.prefersReducedMotion ? "auto" : "smooth" });
  }

  function fact(term, value) {
    return el("div", {}, el("dt", { textContent: term }), el("dd", { textContent: value }));
  }

  function buildDetail(c) {
    const d = candidateDossier(c, run.ctx);
    els.detail.replaceChildren();
    const title = el("h3", { id: "discover-detail-title", textContent: `${c.id} · ${c.classLabel}` });
    els.detail.setAttribute("aria-labelledby", "discover-detail-title");
    const facts = el("dl", { className: "discover-facts" },
      fact("Position", `RA ${d.position.ra}  Dec ${d.position.dec} (${d.position.raDeg}°, ${d.position.decDeg}°), ± ${d.position.errArcsec}″, for ${d.position.epoch.slice(0, 10)}`),
      fact("Motion", d.motion ? `${d.motion.speedArcsecPerYr}″/yr (± ${d.motion.errArcsecPerYr}) toward ${compass(d.motion.pmEastArcsecPerYr, d.motion.pmNorthArcsecPerYr)}${d.motion.significant ? "" : " – not significant, treated as fixed"}` : "none measured"),
      fact("Seen in", `${d.detections.n} of ${d.detections.images} images, ${d.detections.survey_passes} of ${d.detections.passes_in_data} survey passes; median S/N ${d.detections.medianDetectorSnr}` +
        (d.detections.persistence ? `; at its place in ${d.detections.persistence.imagesShowingIt} of ${d.detections.persistence.imagesLookedAt} images of those passes` : "")),
      fact("Support", `${d.support.score}/100 (${Object.entries(d.support.parts).map(([k, v]) => `${k} ${v}`).join(", ")}${Object.keys(d.support.penalties).length ? `; minus ${Object.entries(d.support.penalties).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}). A sum of documented terms, not a probability.`),
      ...(d.colour ? [fact("Colour", d.colour.text)] : []),
      fact("Catalogues", d.catalogue.matches.length
        ? d.catalogue.matches.map((m) => `${m.catalogue} ${m.id}${m.magnitudes ? ` [${m.magnitudes}]` : ""}, ${m.separationArcsec}″`).join("; ")
        : `no match in ${d.catalogue.checked.join(", ") || "any"}${d.catalogue.notChecked.length ? `; not checked: ${d.catalogue.notChecked.join(", ")}` : ""}`),
    );

    const stamps = el("div", { className: "discover-stamps", role: "group", "aria-label": "Small pictures of the source in several images, ordered by wavelength" });
    for (const { g, detected } of pickStamps(c, run.frames)) {
      const pos = c.rawPositions[g];
      const stamp = stampFor(run.frames[g], run.n, pos.x, pos.y);
      const canvas = el("canvas", { width: stamp.size, height: stamp.size, role: "img" });
      const wl = run.frames[g].wavelengthUm;
      const ph = c.photometry[g];
      const snrText = ph?.measured && ph.snr !== null ? `S/N ${ph.snr.toFixed(Math.abs(ph.snr) < 10 ? 1 : 0)}` : "not measured";
      canvas.setAttribute("aria-label", `Image ${g + 1}${wl ? `, ${wl.toFixed(2)} micrometres` : ""}: ${detected ? "found there as a dot" : "not found as a dot"}, ${snrText} at its place`);
      canvas.getContext("2d").putImageData(new ImageData(stampPixels(stamp), stamp.size, stamp.size), 0, 0);
      const ring = el("span", { className: "stamp-ring" });
      ring.style.left = `${((pos.x - stamp.x0 + 0.5) / stamp.size) * 100}%`;
      ring.style.top = `${((pos.y - stamp.y0 + 0.5) / stamp.size) * 100}%`;
      stamps.append(el("figure", { className: `stamp${detected ? " seen" : ""}` }, el("div", { className: "stamp-pic" }, canvas, ring),
        el("figcaption", { textContent: `${wl ? wl.toFixed(2) + " µm" : `image ${g + 1}`} · ${snrText}` })));
    }
    const stampNote = el("p", { className: "discover-stampnote", textContent: "Small pictures of the source in several images, by wavelength. Red frame: the detector found it there as a dot. The number is the signal-to-noise of the flux measured at its place in that image (a bright star's flagged core can read low). Dashed ring: where it should be." });

    const spectrum = el("details", { className: "discover-spectrum" }, el("summary", { textContent: "Spectrum, image by image" }),
      el("div", { className: "table-scroll" }, el("table", {},
        el("caption", { className: "sr-only", textContent: "Flux of the source in each image, at its place" }),
        el("thead", {}, el("tr", {}, ...["wavelength µm", "S/N", "flux mJy", "± mJy (1σ)", "detected", "flagged"].map((h) => el("th", { scope: "col", textContent: h })))),
        el("tbody", {}, ...[...d.spectrum].sort((a, b) => (a.wavelengthUm ?? 0) - (b.wavelengthUm ?? 0)).map((p) => el("tr", {},
          ...[p.wavelengthUm ?? "–", p.snr ?? "–", p.fluxMilliJy ?? "–", p.fluxErrMilliJy ?? "–", p.detected ? "yes" : "no", p.flagged ? "yes" : ""].map((t) => el("td", { textContent: String(t) }))))))));

    const flags = d.flags.length ? el("ul", { className: "discover-flags" }, ...d.flags.map((f) => el("li", {}, el("strong", { textContent: f.code }), ` (${f.severity}): ${f.text}`))) : null;
    const todo = el("ul", { className: "discover-todo" }, ...d.whatToCheck.map((t) => el("li", { textContent: t })));

    const buttons = el("div", { className: "discover-actions" },
      action("Centre the picture on it", "Zoom the picture in on this source and put it in the middle (where it is on the image shown; in Stack and Trail, the middle of its path)", () => deps.centre()),
      action("Check in sky map", "Open the sky map on this position, to compare with 2MASS, AllWISE and DSS pictures", () => deps.openMap(c)),
      action("Spectrum chart", "Measure it in every image with the backend and plot flux against wavelength", () => deps.plotSpectrum(c)),
      action("Save dossier (Markdown)", "Everything above as a text file", () => deps.download(dossierMarkdown(d), dossierFileName(c, run.ctx, "md"), "text/markdown;charset=utf-8")),
      action("Save positions (CSV)", "Its position in each image where it was seen: time, RA, Dec, uncertainty, flux. Not an MPC report (ADES) – see docs", () => deps.download("﻿" + trackletCsv(c, run.ctx), dossierFileName(c, run.ctx, "positions.csv"), "text/csv;charset=utf-8")));

    els.detail.append(title, el("p", { className: "discover-lead", textContent: leadSentence(c) }), stamps, stampNote, facts, spectrum,
      ...(flags ? [el("h4", { textContent: "Flags" }), flags] : []), el("h4", { textContent: "What to check next" }), todo, buttons,
      el("p", { className: "discover-honest", textContent: "A candidate is a lead with its evidence, not a discovery. The score says how well the images support it, not how new it is." }));
  }

  function action(label, title, onClick) {
    const b = el("button", { type: "button", className: "btn btn-small", textContent: label, title });
    b.addEventListener("click", async () => { b.disabled = true; try { await onClick(); } catch (err) { console.error(err); } finally { b.disabled = false; } });
    return b;
  }

  // ------------------------------------------------------------ the whole table
  $("discover-csv-btn").addEventListener("click", () => {
    if (!run) return;
    deps.download("﻿" + candidatesToCsv(run.result.candidates, run.ctx), listFileName(run.ctx, "csv"), "text/csv;charset=utf-8");
  });
  $("discover-json-btn").addEventListener("click", () => {
    if (!run) return;
    deps.download(candidatesToJson(run.result.candidates, run.ctx), listFileName(run.ctx, "json"), "application/json");
  });

  clear();
  return { clear, refresh, get running() { return Boolean(run); } };
}

function compass(east, north) {
  const angle = (Math.atan2(east, north) * 180) / Math.PI;                    // from north, through east
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(((angle + 360) % 360) / 45) % 8];
}
