// replay_bundle.mjs – replay a reproducibility bundle (the JSON saved by "Save the bundle" in section 9 of the page): do the same images and the same search give the same candidates?
//
//   node scratch/replay_bundle.mjs bundle.json [--api http://localhost:8003]
//
// 1. the bundle is checked (schema, no pixel, path or local address);
// 2. the images are read again from a backend serving the real files, and the SHA-256 of each is compared with the one in the bundle: the same data, or not (a missing, an extra or a changed image is said);
// 3. the search of the bundle (Find movers) is run with the same code and the same settings, and the candidates are compared with those of the bundle (motion, images seen, significance).
// The answer is one of: REPRODUCED, or what differs. A synthetic bundle has no backend to read: it is replayed by its link in the browser. Exit code 0 = reproduced, 1 = differs, 2 = unusable.
// Nothing is downloaded from IRSA and nothing is written.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { validateBundle } from "../frontend/js/features/bundle.js";
import { detectSources, findMovers, findMoversAcrossDetectors, describeMover, DEFAULTS } from "../frontend/js/features/movers.js";
import { candidateRows } from "../frontend/js/features/textAnalysis.js";
import { loadField, parseArgs } from "./lib_real.mjs";

const args = parseArgs();
const file = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
if (!file) { console.error("usage: node scratch/replay_bundle.mjs bundle.json [--api URL]"); process.exit(2); }
const api = args.api ?? "http://localhost:8003";
const bundle = JSON.parse(readFileSync(file, "utf8"));

const problems = validateBundle(bundle);
if (problems.length) { console.error(`The bundle is not usable:\n - ${problems.join("\n - ")}`); process.exit(2); }
console.log(`Bundle of ${bundle.created}: ${bundle.data.label}; field RA ${bundle.query.ra}, Dec ${bundle.query.dec}, ${bundle.query.fovArcmin}' , detector ${bundle.query.detector}; ${bundle.images.length} images.`);
if (bundle.data.kind !== "real") { console.log(`\nSYNTHETIC bundle: there are no files to read. Open the replay link in a browser:\n${bundle.replay.link}\nthen press Find movers.`); process.exit(0); }

const run = bundle.searches[0];
const detectors = bundle.query.detectors ?? (run?.settings?.allDetectors ? ["D2", "D6"] : [bundle.query.detector]);        // the detectors whose images the bundle lists
const frames = [];
for (const det of detectors) {
  const f = await loadField(api, bundle.query.ra, bundle.query.dec, bundle.query.fovArcmin, det);
  f.frames.forEach((fr, k) => frames.push({ ...fr, detector: det, grey: f.arrays[k], mask: f.masks[k], n: f.n, scale: f.scale }));
}
frames.sort((a, b) => a.mjd - b.mjd);
const idOf = (f) => `${f.detector}@${Number(f.mjd).toFixed(4)}`;
const sha = (a) => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");

// ---- 1. the same images?
const now = new Map(frames.map((f) => [idOf(f), sha(f.grey)]));
const before = new Map(bundle.images.map((i) => [i.id, i.sha256]));
const missing = [...before.keys()].filter((id) => !now.has(id)), extra = [...now.keys()].filter((id) => !before.has(id)), changed = [...before.keys()].filter((id) => now.has(id) && now.get(id) !== before.get(id));
const same = before.size - missing.length - changed.length;
console.log(`\nImages: ${same} of ${before.size} have the same hash${missing.length ? `; ${missing.length} are not on this backend` : ""}${changed.length ? `; ${changed.length} have a DIFFERENT hash` : ""}${extra.length ? `; ${extra.length} more on this backend than in the bundle` : ""}.`);
const dataSame = !missing.length && !changed.length && !extra.length;

// ---- 2. the same search?
let searchSame = null, detail = "";
if (run?.analysis === "find-movers" && frames.length) {
  const n = frames[0].n, geo = { ra: bundle.query.ra, dec: bundle.query.dec, n, scaleArcsec: frames[0].scale };
  const overrides = Object.fromEntries(Object.entries(run.settings).filter(([k, v]) => k in DEFAULTS && typeof v === "number"));
  let result;
  if (run.settings.allDetectors) result = findMoversAcrossDetectors(frames.map((f) => ({ mjd: f.mjd, detector: f.detector, id: `${f.detector}@${f.mjd}`, grey: f.grey, mask: f.mask })), n, { ...overrides, sigmaFloor: 1e-9 });
  else result = findMovers(frames.map((f) => ({ mjd: f.mjd, sources: detectSources(f.grey, n, { sigmaFloor: 1e-9, mask: f.mask }) })), { area: n * n, ...overrides });
  const mine = candidateRows(result.candidates.map((c, k) => ({ ...c, ...describeMover(c, geo), label: `#${k + 1}` })));
  const theirs = bundle.results.candidates;
  const text = (r) => `${r.motion} | seen in ${r.images} | ${r.significance} sigma`;
  searchSame = mine.length === theirs.length && mine.every((r, k) => text(r) === text(theirs[k]));
  detail = `bundle: ${theirs.length} candidate(s) ${theirs.map(text).join("; ") || "-"}\n  now:    ${mine.length} candidate(s) ${mine.map(text).join("; ") || "-"}`;
  console.log(`\nSearch (${run.algorithm?.version}, ${Object.keys(overrides).length} settings from the bundle):\n  ${detail}`);
} else console.log(`\nThe bundle has no Find movers search to replay (searches: ${bundle.searches.length}); only the images were compared.`);

const verdict = dataSame && searchSame !== false;
console.log(`\n${verdict ? "REPRODUCED" : "DIFFERS"}: ${dataSame ? "the same images" : "the images are not the same"}${searchSame === null ? "" : searchSame ? ", the same candidates" : ", other candidates"}.`);
process.exit(verdict ? 0 : 1);
