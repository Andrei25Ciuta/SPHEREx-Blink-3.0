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
// What is NOT remade (still typed from the report of 7 Nov, said so on the page): sections 4-10.
//
// The search is the one of the app (movers.js): the same function, the same options. The numbers differ from those of 7 Nov because the images the backend holds now are more
// (Barnard D2 has 18 images, then 15) and the code has changed since (Phase 4); the old values are printed next to the new ones so that the change can be seen before it is written.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { detectSources, findMovers, findMoversAcrossDetectors, describeMover, matchKnownObject, moverPositionAtMjd, trackSupport, passIndices } from "../frontend/js/features/movers.js";
import { fetchCatalogue, catalogueTracks, totalMotion } from "../frontend/js/features/catalogue.js";
import { loadField, parseArgs } from "./lib_real.mjs";

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
  on: localDate(), sections: [1, 2, 3], command: "node scratch/make_results.mjs --write",
  runs: Object.fromEntries(results.map((r) => [r.id, { imageCount: r.images, passes: r.passes }])),         // (not called "images": the test of the data file forbids that key, it guards against pixel dumps)
  note: "Remade from the real images the backend holds on this date; the numbers of 7 Nov (15 images in Barnard D2) are in docs/VALIDATION.md section 2 as they were.",
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
if (missed.length) console.log(`\nNOT RECOVERED: ${missed.map((r) => r.id).join(", ")}`);

if (args.write) {
  // The prose of results.html says these things; if one stops being true the page must be rewritten by a human before the file is.
  const claims = [
    ["every run recovered its known mover", missed.length === 0],
    ["nothing else was reported in any run (one candidate each)", results.every((r) => r.candidates === 1)],
    ["searching both detectors gave the smallest difference for each star", ["barnard", "eps"].every((f) => { const d = (det) => runs.find((r) => r.id === `${f}-${det}`).difference; return d("all") <= Math.min(d("d2"), d("d6")); })],
    ["the real lines are supported in every image that could be measured", supports.every(([s, m]) => s === m)],
    ["the mask still helps Barnard in D2 (without it the difference is larger)", unmasked.real && unmasked.real.difference > results[0].real.difference],
    ["every kept line has fewer than 1 chance line expected", runs.every((r) => r.chanceLines < 1)],
  ];
  const broken = claims.filter(([, ok]) => !ok);
  if (broken.length) { console.error(`\nNot written: the page says ${broken.map(([t]) => `"${t}"`).join("; ")}, and this is no longer true of the new numbers. Read them, rewrite that sentence of results.html, then write.`); process.exit(1); }
  const base = old.origins ?? typed.origins;
  const next = { generated, summary: fresh.summary, movers: fresh.movers,
    origins: base.filter((o) => generated.sections.includes(o.section)).map((o) => ({ ...o, generated: generated.on, commands: ["node scratch/make_results.mjs --write (the six runs of Find movers, the original rule on Epsilon Indi B in D6, Barnard in D2 without the mask)"] })) };
  writeFileSync(FILE, compact(next) + "\n");
  console.log(`\nwritten: ${FILE.pathname}`);
} else console.log("\nNothing written (use --write).");
