// make_results.mjs – remake the numbers of sections 1-3 of the results page (frontend/data/real_results.json) from the REAL images, instead of typing them from a report.
//
//   node scratch/make_results.mjs [--api http://localhost:8003]            compare what the images give NOW with the file (writes nothing)
//   node scratch/make_results.mjs --write [--api ...]                       write them into frontend/data/real_results_generated.json (the typed file, sections 4-10, is not touched)
//
// Needs the backend started on the real files only (SPHEREX_DATA_DIR=backend/data/real, port 8003: "backend-real" in .claude/launch.json) and the network (SIMBAD, for the catalogue
// motion). Nothing is downloaded from IRSA here; the real pixels never leave this computer: only derived numbers are written.
//
// Section 1 and 2   the blind search of Find movers on the six real runs (Barnard's Star and Epsilon Indi B, D2, D6 and both), and the ORIGINAL rule on Epsilon Indi B in D6
// Section 3         Barnard's Star in D2 with and without the bad-pixel mask (mask: null is the code before the mask: the core of a saturated star is centred on all its pixels)
// Section 4         the Jansky scale: aperture fluxes of isolated stars against their 2MASS / AllWISE magnitudes (scratch/validate_photometry.py, its report is parsed; IRSA TAP for the magnitudes)
// Section 5         the asteroid Arosa in two images 19.5 hours apart: SkyBoT gives where it is at each time, the backend measures the flux there (the cutouts are the three Arosa files)
// Section 6         WISE 0855: the stack along its predicted path against 16 control places (scratch/stack_wise0855.py, its report is parsed)
// What is NOT remade (still typed from the report of 7 Nov, said so on the page): sections 7-10.
//
// The search is the one of the app (movers.js): the same function, the same options. Barnard's numbers are those of 7 Nov (the backend skips the three exposures it held twice: VALIDATION 2.1); the old
// values are printed next to the new ones so that a change can be seen before it is written.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { detectSources, findMovers, findMoversAcrossDetectors, describeMover, matchKnownObject, moverPositionAtMjd, trackSupport, passIndices } from "../frontend/js/features/movers.js";
import { fetchCatalogue, catalogueTracks, totalMotion } from "../frontend/js/features/catalogue.js";
import { fetchSkybotForFrames } from "../frontend/js/features/skybot.js";
import { loadField, parseArgs } from "./lib_real.mjs";

// a transient network error (connection reset) is retried: the scripts of this project talk to services that are sometimes slow
const plainFetch = globalThis.fetch;
globalThis.fetch = async (...a) => { let last; for (let i = 0; i < 3; i++) { try { return await plainFetch(...a); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } } throw last; };

const args = parseArgs();
const api = args.api ?? "http://localhost:8003";
const TYPED = new URL("../frontend/data/real_results.json", import.meta.url);               // numbers typed from the reports of 7 Nov (sections 4-10)
const FILE = new URL("../frontend/data/real_results_generated.json", import.meta.url);      // numbers made by this script (sections 1-3), laid over the typed file by the page
const FIELDS = {
  barnard: { name: "Barnard's Star", ra: 269.4462, dec: 4.769, fov: 5 },
  eps: { name: "Epsilon Indi B", ra: 331.0634, dec: -56.7893, fov: 5 },
};
const r2 = (v) => Math.round(v * 100) / 100;
/** JSON with one key per line and short lists of numbers on one line (the file stays small and a change shows as a few lines in a diff). */
function compact(v, pad = "") {
  const inner = pad + " ";
  if (Array.isArray(v)) return v.every((x) => x === null || typeof x !== "object" || (Array.isArray(x) && x.every((y) => typeof y !== "object"))) && JSON.stringify(v).length < 110 ? JSON.stringify(v) : `[\n${v.map((x) => inner + compact(x, inner)).join(",\n")}\n${pad}]`;
  if (v && typeof v === "object") return `{\n${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${compact(x, inner)}`).join(",\n")}\n${pad}}`;
  return JSON.stringify(v);
}
const localDate = () => new Date().toLocaleDateString("sv-SE");               // the author's calendar date (yyyy-mm-dd), not UTC

/** Frames of one detector, or of D2 and D6 together ("all"), in time order, each with its pixels and mask. */
async function load(field, det) {
  const parts = [];
  for (const d of det === "all" ? ["D2", "D6"] : [det]) {
    const f = await loadField(api, field.ra, field.dec, field.fov, d);
    f.frames.forEach((fr, k) => parts.push({ ...fr, detector: d, grey: f.arrays[k], mask: f.masks[k] }));
    var n = f.n, scale = f.scale;                                                // eslint-disable-line no-var
  }
  parts.sort((a, b) => a.mjd - b.mjd);
  return { frames: parts, n, scale, geo: { ra: field.ra, dec: field.dec, n, scaleArcsec: scale } };
}

const catalogueCache = new Map();
async function catalogue(field) {
  const key = field.name;
  if (!catalogueCache.has(key)) catalogueCache.set(key, await fetchCatalogue(field.ra, field.dec, field.fov));
  return catalogueCache.get(key);
}

/** Path support of a candidate: in how many of the images where the position can be measured is there a signal at the predicted place (as in the app, addSupport). */
function support(c, frames, n) {
  const idx = c.frameIds ? c.frameIds.map((id) => frames.findIndex((f) => `${f.detector}@${f.mjd}` === id)) : frames.map((_, k) => k);
  const positions = idx.map((fi, j) => { const q = moverPositionAtMjd(c, frames[fi].mjd), sh = c.shifts?.[j]; return { x: q.x + (sh?.dx ?? 0), y: q.y + (sh?.dy ?? 0) }; });
  const s = trackSupport(idx.map((fi) => frames[fi].grey), n, positions);
  return [s.supported, s.measurable];
}

/** One blind run: the candidates of Find movers, compared with the catalogued fast mover of the field. */
async function blind(fieldKey, det, { relaxed = false, noMask = false } = {}) {
  const field = FIELDS[fieldKey], { frames, n, scale, geo } = await load(field, det);
  if (!frames.length) throw new Error(`no images for ${field.name} ${det}: is the backend started on the real files?`);
  const used = noMask ? frames.map((f) => ({ ...f, mask: null })) : frames;
  let result;
  if (det === "all") result = findMoversAcrossDetectors(used.map((f) => ({ mjd: f.mjd, detector: f.detector, id: `${f.detector}@${f.mjd}`, grey: f.grey, mask: f.mask })), n, { sigmaFloor: 1e-9 });
  else {
    const detected = used.map((f) => ({ mjd: f.mjd, sources: detectSources(f.grey, n, { sigmaFloor: 1e-9, mask: f.mask }) }));
    result = findMovers(detected, { area: n * n, ...(relaxed ? { minDetectionFraction: 0.5, maxFalseAlarm: Infinity } : {}) });
  }
  if (result.reason) throw new Error(`the search did not run for ${field.name} ${det}: ${result.reason}`);
  const objects = await catalogue(field);
  const tracks = catalogueTracks(objects, frames, geo);                         // where each catalogued object is on the dates of the images (as validate_real.mjs does)
  const expected = objects.filter((o) => totalMotion(o) >= 1 && tracks.some((t) => t.label === o.label));
  if (expected.length !== 1) throw new Error(`${field.name}: expected exactly one catalogued fast mover in the field, SIMBAD lists ${expected.length}`);
  const target = expected[0], cat = [(target.pmra ?? 0) / 1000, (target.pmdec ?? 0) / 1000];
  const described = result.candidates.map((c) => ({ c, d: describeMover(c, geo), hit: Boolean(matchKnownObject(c, geo, [target], { maxDistPx: 3 })) }));
  const real = described.find((x) => x.hit);
  return {
    field: field.name, det, images: frames.length, passes: passIndices(frames.map((f) => f.mjd)).at(-1) + 1, pixelArcsec: scale, candidates: described.length, target: target.label,
    real: real && {
      catalogue: cat.map(r2), measured: [r2(real.d.pmEastArcsecPerYear), r2(real.d.pmNorthArcsecPerYear)],
      difference: r2(Math.hypot(real.d.pmEastArcsecPerYear - cat[0], real.d.pmNorthArcsecPerYear - cat[1])),
      seen: [real.c.nDet, real.c.nFrames], sigma: Math.round(real.c.significance), chanceLines: Number(real.c.falseAlarm.toPrecision(1)), support: support(real.c, frames, n),
    },
    others: described.filter((x) => !x.hit).map((x) => ({ chanceLines: Number(x.c.falseAlarm.toPrecision(2)), support: support(x.c, frames, n), speed: r2(x.d.speedArcsecPerYear) })),
  };
}

// ------------------------------------------------------------------ the six runs, the original rule, the mask
const old = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : JSON.parse(readFileSync(TYPED, "utf8"));      // compared with the previous run (or, the first time, with the typed numbers)
const typed = JSON.parse(readFileSync(TYPED, "utf8"));
const RUNS = [["barnard-d2", "barnard", "D2"], ["barnard-d6", "barnard", "D6"], ["barnard-all", "barnard", "all"], ["eps-d2", "eps", "D2"], ["eps-d6", "eps", "D6"], ["eps-all", "eps", "all"]];
const results = [];
for (const [id, fieldKey, det] of RUNS) {
  const r = await blind(fieldKey, det);
  results.push({ id, ...r });
  console.error(`  ${id}: ${r.images} images, ${r.candidates} candidate(s)${r.real ? "" : ", THE KNOWN MOVER WAS NOT RECOVERED"}`);
}
const original = await blind("eps", "D6", { relaxed: true });
const unmasked = await blind("barnard", "D2", { noMask: true });
console.error(`  original rule on Epsilon Indi B D6: ${original.candidates} candidate(s); Barnard D2 without the mask: ${unmasked.real ? unmasked.real.difference : "not recovered"}`);

const missed = results.filter((r) => !r.real);
const runs = results.filter((r) => r.real).map((r) => ({ id: r.id, label: `${r.field} · ${r.det === "all" ? "D2 + D6" : r.det}`, ...r.real, support: undefined, images: undefined }));
for (const r of runs) { delete r.support; delete r.images; }
const diffs = runs.map((r) => r.difference);
const supports = results.filter((r) => r.real).map((r) => r.real.support);
const generated = {
  on: localDate(), sections: [1, 2, 3, 4, 5, 6], command: "node scratch/make_results.mjs --write",
  runs: Object.fromEntries(results.map((r) => [r.id, { imageCount: r.images, passes: r.passes }])),         // (not called "images": the test of the data file forbids that key, it guards against pixel dumps)
  note: "Remade from the real images the backend holds on this date; the table of 7 Nov is in docs/VALIDATION.md section 2 as it was; section 2.1 compares them.",
};
const fresh = {
  summary: { recovered: [results.filter((r) => r.real).length, results.length], minDifference: Math.min(...diffs), maxDifference: Math.max(...diffs) },
  movers: {
    runs,
    differencePixels: [r2(Math.min(...diffs) / results[0].pixelArcsec), r2(Math.max(...diffs) / results[0].pixelArcsec)],     // the same, in pixels per year (the page says so)
    maxChanceLines: Math.max(...runs.map((r) => r.chanceLines)),
    realSupport: supports,                                                     // [supported, measurable] of each real line: the page says "in all of them" only if it is true
    // The failure of the ORIGINAL rule is a record of 7 Nov: it cannot be remade by the code of today (checked below), so the old numbers stay, and what the rule gives now is added.
    originalRule: {
      ...old.movers.originalRule,
      reproducedNow: { on: generated.on, candidates: original.candidates, falseLines: original.others.length, dotsNote: "fewer dots per image now (4-8 on Epsilon Indi B in D6), so no chance line has dots to join" },
    },
    barnardD2Mask: { before: unmasked.real?.difference ?? null, after: results[0].real?.difference ?? null },
  },
};

// ------------------------------------------------------------------ sections 4-6
const winPath = (u) => u.pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PYTHON = existsSync(new URL("../backend/.venv/Scripts/python.exe", import.meta.url)) ? winPath(new URL("../backend/.venv/Scripts/python.exe", import.meta.url))
  : existsSync(new URL("../backend/.venv/bin/python", import.meta.url)) ? winPath(new URL("../backend/.venv/bin/python", import.meta.url)) : "python3";
const py = (script, ...a) => execFileSync(PYTHON, ["-I", winPath(new URL("./" + script, import.meta.url)), ...a], { encoding: "utf8", timeout: 300000, maxBuffer: 1 << 24 });
const num = (t) => Number(String(t).replace("\u2212", "-"));

// 4. the Jansky scale
const JANSKY = [["Barnard field \u00b7 D2", FIELDS.barnard, "D2"], ["Barnard field \u00b7 D6", FIELDS.barnard, "D6"], ["Epsilon Indi B field \u00b7 D2", FIELDS.eps, "D2"], ["Epsilon Indi B field \u00b7 D6", FIELDS.eps, "D6"]];
const jansky = JANSKY.map(([label, f, det]) => {
  const out = py("validate_photometry.py", "--ra", String(f.ra), "--dec", String(f.dec), "--det", det);
  const all = /ALL: (\d+) measurements of (\d+) stars: median ratio ([\d.]+), robust scatter ([\d.]+) \(16th-84th percentile ([\d.]+)-([\d.]+)\)/.exec(out);
  if (!all) throw new Error("no usable photometry for " + label + ": " + out.slice(-200));
  const stars = out.split("\n").filter((l) => /^\(\d/.test(l)).length;
  return { label, stars, measurements: Number(all[1]), median: Number(all[3]), scatter: Number(all[4]), p16: Number(all[5]), p84: Number(all[6]) };
});
console.error("  Jansky: " + jansky.map((j) => j.median).join(", "));

// 5. Arosa
const AROSA_ANCHORS = { early: { ra: 296.24573, dec: -24.00048 }, late: { ra: 296.40882, dec: -24.04831 } };      // where the two cutouts are centred; SkyBoT is asked for the real positions
const hav = (a, b) => { const r = Math.PI / 180, dd = (b.dec - a.dec) * r, dr = (b.ra - a.ra) * r, h = Math.sin(dd / 2) ** 2 + Math.cos(a.dec * r) * Math.cos(b.dec * r) * Math.sin(dr / 2) ** 2; return 2 * Math.asin(Math.sqrt(h)) * 3600 / r; };
async function arosa() {
  const where = {};
  for (const [k, a] of Object.entries(AROSA_ANCHORS)) {
    const { frames } = await loadField(api, a.ra, a.dec, 5, "D2");
    if (!frames.length) throw new Error("no Arosa cutout: is the backend started on the real files (the three asteroid_Arosa files)?");
    const fr = frames.filter((f) => Math.abs(f.mjd - 61150.0) < 1.5);                           // the images of 2026-04-20
    const sky = await fetchSkybotForFrames(fr, { ra: a.ra, dec: a.dec, fovArcmin: 5 });
    const hits = fr.map((f, i) => ({ f, body: (sky.perFrame[i] ?? []).find((o) => /arosa/i.test(o.name)) })).filter((x) => x.body);
    if (!hits.length) throw new Error("SkyBoT does not list Arosa near the " + k + " position" + (sky.failures ? " (" + sky.failures + " requests failed: " + sky.firstError + ")" : ""));
    const want = k === "early" ? 61150.007 : 61150.821;
    where[k] = hits.sort((p, q) => Math.abs(p.f.mjd - want) - Math.abs(q.f.mjd - want))[0];
  }
  const flux = async (pos, f) => {
    const p = (await (await fetch(api + "/api/photometry?ra=" + pos.ra + "&dec=" + pos.dec + "&det=D2&radius=2")).json()).points.find((x) => Math.abs(x.mjd - f.mjd) < 2e-4);
    return p && p.fluxJy !== null ? { mj: Math.round(p.fluxJy * 1e5) / 100, err: Math.round(p.fluxErr * 100) / 100,           // fluxErr is already in mJy
       um: p.wavelengthUm } : null;
  };
  const E = where.early, L = where.late, ep = { ra: E.body.ra, dec: E.body.dec }, lp = { ra: L.body.ra, dec: L.body.dec };
  const hh = (L.f.mjd - E.f.mjd) * 24, moved = hav(ep, lp), t = (f) => f.dateISO.slice(11, 16);
  const rows = [];
  for (const [f] of [[E.f], [L.f]]) {
    for (const [pos, pf] of (f === E.f ? [[ep, E.f], [lp, L.f]] : [[lp, L.f], [ep, E.f]])) {          // the order of the page: early image at the early and the late place, late image at the late and the early place
      const m = await flux(pos, f);
      rows.push({ label: "Image of " + t(f) + " UTC (" + (m?.um ?? (f.wavelengthMinUm + f.wavelengthMaxUm) / 2).toFixed(2) + " \u00b5m), at the " + t(pf) + " position", fluxMilliJy: m?.mj ?? null, err: m?.err ?? null, ...(m ? {} : { note: "not in this cutout" }) });
    }
  }
  return { hours: Math.round(hh * 10) / 10, movedArcsec: Math.round(moved), arcsecPerHour: Math.round(moved / hh * 10) / 10, skybotArcsecPerHour: Math.round(((E.body.rateArcsecPerDay + L.body.rateArcsecPerDay) / 2 / 24) * 10) / 10, rows };
}
const arosaNow = await arosa();
console.error("  Arosa: moved " + arosaNow.movedArcsec + '" in ' + arosaNow.hours + " h; rows " + arosaNow.rows.map((r) => r.fluxMilliJy).join(", "));

// 6. WISE 0855
function wise(det) {
  const out = py("stack_wise0855.py", "--api", api, "--det", det);
  const rows = [...out.matchAll(/^(\d{4}-\d{2}-\d{2})\s+([\d.]+)\s+([-+\d.]+)\s+([\d.]+)\s+[-+\d.]+\s+(True|False)/gm)].map((m) => ({ date: m[1], um: num(m[2]), fluxMilliJy: num(m[3]), err: num(m[4]), flagged: m[5] === "True" }));
  const st = /STACK of (\d+) unflagged images: ([-+\d.]+) \+- ([\d.]+) mJy\s+\(nominal ([\d.]+) sigma\)/.exec(out), ctl = /control stacks \(mJy\), sorted: (.+)/.exec(out);
  const sc = /mean ([-+\d.]+) mJy, scatter ([\d.]+) mJy; median ([-+\d.]+) mJy, robust scatter \(1\.4826 x MAD\) ([\d.]+)/.exec(out), cmp = /= ([\d.]+) x the control scatter, ([\d.]+) x the robust scatter; brighter than (\d+) of (\d+) controls/.exec(out);
  if (!st || !ctl || !sc || !cmp || !rows.length) throw new Error("cannot read the report of stack_wise0855.py for " + det + ": " + out.slice(-300));
  return { rows, unflagged: [Number(st[1]), rows.length], stack: num(st[2]), err: Number(st[3]), nominalSigma: Number(st[4]), controlMedian: num(sc[3]), controlRobustScatter: Number(sc[4]), controlPlainScatter: Number(sc[2]), timesRobust: Number(cmp[2]), brighterThan: [Number(cmp[3]), Number(cmp[4])], controls: ctl[1].trim().split(/\s+/).map(num) };
}
const w6 = wise("D6"), w2 = wise("D2");
console.error("  WISE 0855: D6 stack " + w6.stack + " (" + w6.unflagged.join(" of ") + "), D2 stack " + w2.stack);
const oldW = old.wise0855 ?? typed.wise0855;
const strip = ({ rows, ...rest }) => rest;
const wise0855 = {
  D6: { label: oldW.D6.label, ...strip(w6) },
  D2: { label: oldW.D2.label, ...strip(w2), blame: oldW.D2.blame },     // the explanation of the D2 excess is typed text (a 2MASS star inside the aperture), not measured here
  d6Images: w6.rows,
};
const freshB = { jansky, arosa: { ...arosaNow, offsetArcsec: (old.arosa ?? typed.arosa).offsetArcsec }, wise0855 };      // offsetArcsec (the centre of the dot against the predicted place) is still the typed value

Object.assign(fresh, freshB);

// ------------------------------------------------------------------ compare
const line = (label, a, b) => `${label.padEnd(34)} ${String(a).padEnd(34)} ${b}`;
console.log(line("", "file (7 Nov)", "images now"));
for (const r of fresh.movers.runs) {
  const o = old.movers.runs.find((x) => x.id === r.id);
  console.log(line(`${r.label} difference "/yr`, o?.difference, r.difference), "|", `seen ${o?.seen?.join(" of ")} -> ${r.seen.join(" of ")}, ${o?.sigma} -> ${r.sigma} sigma, chance ${o?.chanceLines} -> ${r.chanceLines}`);
}
console.log(line("range of differences", `${old.summary.minDifference}-${old.summary.maxDifference}`, `${fresh.summary.minDifference}-${fresh.summary.maxDifference}`));
console.log(line("original rule: real / false chance", `${old.movers.originalRule.realChanceLines} / ${old.movers.originalRule.falseChanceLines.join(",")}`, `${fresh.movers.originalRule.realChanceLines} / ${fresh.movers.originalRule.falseChanceLines.join(",")}`));
console.log(line("original rule: false supported", JSON.stringify(old.movers.originalRule.falseSupportedImages), JSON.stringify(fresh.movers.originalRule.falseSupportedImages)));
console.log(line("Barnard D2 mask before / after", `${old.movers.barnardD2Mask.before} / ${old.movers.barnardD2Mask.after}`, `${fresh.movers.barnardD2Mask.before} / ${fresh.movers.barnardD2Mask.after}`));
console.log(line("real lines supported in all", "yes (13/13 ...)", supports.every(([s, m]) => s === m) ? "yes" : `NO: ${JSON.stringify(supports)}`));
const oj = old.jansky ?? typed.jansky, oa = old.arosa ?? typed.arosa;
console.log(line("Jansky median (4 fields)", oj.map((j) => j.median).join(" "), jansky.map((j) => j.median).join(" ")));
console.log(line("Jansky stars / measurements", oj.map((j) => j.stars + "/" + j.measurements).join(" "), jansky.map((j) => j.stars + "/" + j.measurements).join(" ")));
console.log(line('Arosa moved "/hours/rate', oa.movedArcsec + " / " + oa.hours + " / " + oa.arcsecPerHour + " (SkyBoT " + oa.skybotArcsecPerHour + ")", arosaNow.movedArcsec + " / " + arosaNow.hours + " / " + arosaNow.arcsecPerHour + " (SkyBoT " + arosaNow.skybotArcsecPerHour + ")"));
console.log(line("Arosa fluxes mJy", oa.rows.map((r) => r.fluxMilliJy + "+-" + r.err).join(" "), arosaNow.rows.map((r) => r.fluxMilliJy + "+-" + r.err).join(" ")));
console.log(line("WISE 0855 D6 stack / controls", oldW.D6.stack + " +- " + oldW.D6.err + ", " + oldW.D6.brighterThan.join("/"), w6.stack + " +- " + w6.err + ", " + w6.brighterThan.join("/")));
console.log(line("WISE 0855 D2 stack / controls", oldW.D2.stack + " +- " + oldW.D2.err + ", " + oldW.D2.brighterThan.join("/"), w2.stack + " +- " + w2.err + ", " + w2.brighterThan.join("/")));
if (missed.length) console.log("\nNOT RECOVERED: " + missed.map((r) => r.id).join(", "));

if (args.write) {
  // The prose of results.html says these things; if one stops being true the page must be rewritten by a human before the file is.
  const claims = [
    ["every run recovered its known mover", missed.length === 0],
    ["nothing else was reported in any run (one candidate each)", results.every((r) => r.candidates === 1)],
    ["searching both detectors gave the smallest difference for each star", ["barnard", "eps"].every((f) => { const d = (det) => runs.find((r) => r.id === `${f}-${det}`).difference; return d("all") <= Math.min(d("d2"), d("d6")); })],
    ["the real lines are supported in every image that could be measured", supports.every(([s, m]) => s === m)],
    ["the mask still helps Barnard in D2 (without it the difference is larger)", unmasked.real && unmasked.real.difference > results[0].real.difference],
    ["every kept line has fewer than 1 chance line expected", runs.every((r) => r.chanceLines < 1)],
    ["D6 sits lower than D2 in both fields (Jansky scale)", jansky[1].median < jansky[0].median && jansky[3].median < jansky[2].median],
    ["every Jansky median lies inside its 16th-84th percentile, and the scale is right to about 10 %", jansky.every((j) => j.p16 <= j.median && j.median <= j.p84 && j.median > 0.85 && j.median < 1.1)],
    ["Arosa is at the predicted place in each image and absent from the other, with the same flux at the two wavelengths", (() => { const [a, b, c, d] = arosaNow.rows; return a.fluxMilliJy > 5 * a.err && Math.abs(b.fluxMilliJy) < 3 * b.err && c.fluxMilliJy > 5 * c.err && Math.abs(a.fluxMilliJy - c.fluxMilliJy) < 3 * Math.hypot(a.err, c.err) && d.fluxMilliJy === null; })()],
    ["Arosa moved about as fast as SkyBoT says (within 3 percent)", Math.abs(arosaNow.arcsecPerHour - arosaNow.skybotArcsecPerHour) < 0.03 * arosaNow.skybotArcsecPerHour],
    ["WISE 0855 in D6: two of six images flagged and left out, the stack is suggestive (3-6 times the robust scatter), and one control sits on a field star", w6.unflagged[0] === 4 && w6.unflagged[1] === 6 && w6.timesRobust > 3 && w6.timesRobust < 6 && Math.max(...w6.controls) > 3],
    ["WISE 0855 in D2: the stack is brighter than every control (the excess the page blames on a 2MASS star)", w2.brighterThan[0] === w2.brighterThan[1] && w2.controls.length === 16],
  ];
  const broken = claims.filter(([, ok]) => !ok);
  if (broken.length) { console.error(`\nNot written: the page says ${broken.map(([t]) => `"${t}"`).join("; ")}, and this is no longer true of the new numbers. Read them, rewrite that sentence of results.html, then write.`); process.exit(1); }
  const bySection = new Map([...typed.origins, ...(old.origins ?? [])].map((o) => [o.section, o]));
  const cmd = { 1: "the six runs of Find movers", 2: "the six runs and the original rule on Epsilon Indi B in D6", 3: "Barnard in D2 without and with the bad-pixel mask", 4: "validate_photometry.py on four fields, IRSA TAP for the magnitudes", 5: "Arosa: SkyBoT positions and the backend's photometry", 6: "stack_wise0855.py, D6 and D2" };
  const next = { generated, summary: fresh.summary, movers: fresh.movers, jansky: fresh.jansky, arosa: fresh.arosa, wise0855: fresh.wise0855,
    origins: generated.sections.map((n) => ({ ...bySection.get(n), generated: generated.on, commands: ["node scratch/make_results.mjs --write (" + cmd[n] + ")"] })) };
  writeFileSync(FILE, compact(next) + "\n");
  console.log(`\nwritten: ${FILE.pathname}`);
} else console.log("\nNothing written (use --write).");
