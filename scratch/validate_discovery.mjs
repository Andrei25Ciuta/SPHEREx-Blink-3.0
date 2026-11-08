// "Find everything" on REAL SPHEREx frames: what does it say, and how far can it be trusted?  Needs a backend that serves only the real files
// (SPHEREX_DATA_DIR=backend/data/real, port 8003 in .claude/launch.json) and internet for the catalogues. No new download.
//
//   node scratch/validate_discovery.mjs --mode real    --field "Barnard D2"
//   node scratch/validate_discovery.mjs --mode control --field "Barnard D2" --scrambles 6 --seed 1
//   node scratch/validate_discovery.mjs --mode inject  --field "Barnard D2" --trials 10 --seed 1
//   (--json file.json also writes the numbers; --skybot 0 skips the asteroid lookup)
//
// real     discover() on the real images with SIMBAD, Gaia DR3, 2MASS, AllWISE (and SkyBoT): how many sources, how many catalogued,
//          which catalogue explains them, and the list of everything that is NOT explained (the leads a person would look at).
// control  EMPTY-SKY CONTROL for the "needs checking" threshold. Every image is rotated/mirrored at random and moved by a random whole
//          number of pixels (independently), which destroys every correspondence between images; the catalogues are passed as "checked and
//          empty", so every candidate that survives is a false one by construction. Reports how many false "unknown" candidates a field
//          gets for each support-score threshold. (Does not cover real variable stars or real clustering.)
// inject   COMPLETENESS. Fake point sources (static, and moving at 4 and 30 arcsec/yr), added to the real images at a known place with a known
//          flux, catalogues "checked and empty": how often does discover() list the source, and how often does it say "unknown: needs checking"
//          (and not "artefact" or "weakly supported")?

import { detectSources, registerShifts } from "../frontend/js/features/movers.js";
import { discover, NEEDS_CHECKING_SCORE, MIN_PERSISTENCE } from "../frontend/js/features/discovery.js";
import { fetchAllCatalogues } from "../frontend/js/features/catalogueRelay.js";
import { fetchSkybotForFrames } from "../frontend/js/features/skybot.js";
import { skyToCanvas } from "../frontend/js/geometry.js";
import { loadField, mulberry32, parseArgs, dihedral, wrapShift, wilson } from "./lib_real.mjs";
import { writeFileSync } from "node:fs";

const FIELDS = {
  "Barnard D2": { ra: 269.4462, dec: 4.769, det: "D2" }, "Barnard D6": { ra: 269.4462, dec: 4.769, det: "D6" },
  "Epsilon Indi B D2": { ra: 331.0965, dec: -56.8006, det: "D2" }, "Epsilon Indi B D6": { ra: 331.0965, dec: -56.8006, det: "D6" },
  "WISE 0855 D2": { ra: 133.7598, dec: -7.2422, det: "D2" }, "WISE 0855 D6": { ra: 133.7598, dec: -7.2422, det: "D6" },
};
const FOV = 5;                                                          // arcmin
const FWHM_ARCSEC = { D2: 5.15, D6: 6.61 };                             // median PSF_FWHM of our files' headers (read 7 Nov 2026)
const EMPTY = { simbad: [], gaia: [], "2mass": [], allwise: [] };       // "checked, and nothing there"
const AMPS = [6, 9, 12, 16, 22, 32, 50];                                // total flux in units of the detector's own noise (as calibrate_real.mjs)
const MARGIN = 6;

const args = parseArgs();
const api = args.api ?? "http://localhost:8003";
const mode = args.mode ?? "real";
const seed = Number(args.seed ?? 1);
const field = FIELDS[args.field];
if (!field) { console.error(`--field must be one of: ${Object.keys(FIELDS).join(", ")}`); process.exit(2); }
const out = { field: args.field, mode, seed, needsCheckingScore: NEEDS_CHECKING_SCORE };

const f = await loadField(api, field.ra, field.dec, FOV, field.det);
const { n, scale, geo } = f;
const N = f.frames.length;
const mjds = f.frames.map((fr) => fr.mjd);
const toFrames = (arrays, masks) => f.frames.map((fr, k) => ({ id: `${field.det}-${k}`, mjd: fr.mjd, detector: field.det, wavelengthUm: (fr.wavelengthMinUm + fr.wavelengthMaxUm) / 2, grey: arrays[k], mask: masks[k] }));
const omega = (scale / 206264.806) ** 2;
const mJyPerSum = omega * 1e9;                                          // a pixel sum in MJy/sr -> mJy
const ms = (t0) => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "–");
const median = (v) => { const s = [...v].filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

console.log(`## ${args.field}: ${N} images, ${n} x ${n} px of ${scale}", mode ${mode}\n`);

// ------------------------------------------------------------------ catalogues
async function getCatalogues() {
  const { catalogues, notes } = await fetchAllCatalogues({ ra: field.ra, dec: field.dec, fovArcmin: FOV, apiBase: api });
  return { cats: catalogues, notes };
}

// ------------------------------------------------------------------ mode real
async function runReal() {
  const t0 = Date.now();
  const { cats, notes } = await getCatalogues();
  let skybot = null;
  if (args.skybot !== "0") {
    try { skybot = (await fetchSkybotForFrames(f.frames, { ra: field.ra, dec: field.dec, fovArcmin: FOV })).perFrame; } catch (e) { notes.push(`SkyBoT: ${e.message}`); }
  }
  const frames = toFrames(f.arrays, f.masks);
  const res = discover({ frames, n, geo, isFloat: true, catalogues: cats, skybot });
  const { summary, candidates, stats } = res;
  console.log(`- Catalogues loaded: ${Object.entries(cats).map(([k, v]) => `${k} ${v.length}`).join(", ") || "none"}${notes.length ? `; **problems:** ${notes.join("; ")}` : ""}${skybot ? "; SkyBoT yes" : "; SkyBoT no"}`);
  console.log(`- Dots per image ${Math.min(...stats.dotsPerFrame)}-${Math.max(...stats.dotsPerFrame)}, ${stats.passes} passes; candidates: ${summary.total} (static ${stats.staticSources}, movers ${stats.movers}, asteroids ${stats.asteroids}); time ${ms(t0)}`);
  console.log(`- Classes: ${Object.entries(summary.counts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")}\n`);

  const explainedBy = {};
  for (const c of candidates.filter((x) => x.class === "catalogued" || x.class === "catalogued-moving")) {
    for (const cat of new Set(c.catalogue.matches.map((m) => m.cat))) explainedBy[cat] = (explainedBy[cat] ?? 0) + 1;
  }
  const catalogued = candidates.filter((x) => x.class === "catalogued" || x.class === "catalogued-moving");
  const onlyOne = {};
  for (const c of catalogued) { const set = [...new Set(c.catalogue.matches.map((m) => m.cat))]; if (set.length === 1) onlyOne[set[0]] = (onlyOne[set[0]] ?? 0) + 1; }
  console.log(`- Catalogued candidates ${catalogued.length}: matched in ${Object.entries(explainedBy).map(([k, v]) => `${k} ${v}`).join(", ")}; matched in ONLY that catalogue: ${Object.entries(onlyOne).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}\n`);

  const leads = candidates.filter((c) => !["catalogued", "catalogued-moving", "solar-system"].includes(c.class));
  if (leads.length) {
    console.log(`| id | kind | class | images | passes | S/N | support | flags | colour | median flux (mJy) |`);
    console.log(`|---|---|---|---|---|---|---|---|---|---|`);
    for (const c of leads) {
      const flux = median(c.photometry.filter((p) => p.measured && !p.flagged).map((p) => p.fluxMilliJy));
      console.log(`| ${c.id} | ${c.kind} | ${c.class} | ${c.nDet}/${c.nFrames} | ${c.passes}/${c.nPasses} | ${fmt(c.medianSnr)} | ${c.support} | ${c.flags.map((x) => x.code).join(", ") || "–"} | ${c.colour?.kind ?? "–"} | ${fmt(flux, 2)} |`);
    }
    console.log("");
  } else console.log("Nothing is left unexplained.\n");

  out.real = { catalogues: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, v.length])), notes, counts: summary.counts, total: summary.total, stats: { static: stats.staticSources, movers: stats.movers, asteroids: stats.asteroids, dots: stats.dotsPerFrame }, explainedBy, onlyOne,
    leads: leads.map((c) => ({ id: c.id, kind: c.kind, class: c.class, nDet: c.nDet, nFrames: c.nFrames, passes: c.passes, snr: c.medianSnr, support: c.support, flags: c.flags.map((x) => x.code), colour: c.colour?.kind ?? null, ra: c.ra, dec: c.dec })) };
}

// ------------------------------------------------------------------ mode control
function scramble(rng) {
  const arrays = [], masks = [];
  f.arrays.forEach((a, k) => {
    const d = Math.floor(rng() * 8), sx = Math.floor(rng() * n), sy = Math.floor(rng() * n);
    arrays.push(wrapShift(dihedral(a, n, d), n, sx, sy));
    masks.push(f.masks[k] ? wrapShift(dihedral(f.masks[k], n, d), n, sx, sy) : null);
  });
  return { arrays, masks };
}
const THRESHOLDS = [30, 40, 50, 60, 70, 80, 90];

function runControl() {
  const rng = mulberry32(seed);
  const rounds = Number(args.scrambles ?? 6);
  const perThreshold = THRESHOLDS.map(() => 0);
  const rows = [];
  let all = 0;
  for (let r = 0; r < rounds; r++) {
    const t0 = Date.now();
    const s = scramble(rng);
    const res = discover({ frames: toFrames(s.arrays, s.masks), n, geo, isFloat: true, catalogues: EMPTY });
    const live = res.candidates.filter((c) => c.class === "unknown" || c.class === "unknown-weak");   // artefacts never reach "needs checking"
    all += res.candidates.length;
    THRESHOLDS.forEach((T, i) => { perThreshold[i] += live.filter((c) => c.support >= T && c.persistence.fraction >= MIN_PERSISTENCE).length; });
    rows.push({ round: r + 1, candidates: res.candidates.length, artefacts: res.candidates.filter((c) => c.class === "artefact").length, live: live.map((c) => ({ kind: c.kind, support: c.support, nDet: c.nDet, passes: c.passes, snr: c.medianSnr, persistence: c.persistence.fraction })) });
    console.log(`- scramble ${r + 1}/${rounds}: ${res.candidates.length} candidates (${rows.at(-1).artefacts} artefact), eligible ${live.length}: ${live.map((c) => `${c.kind} ${c.support} (${c.nDet} imgs, S/N ${fmt(c.medianSnr)})`).join("; ") || "none"}; ${ms(t0)}`);
  }
  console.log(`\n| support threshold | false "unknown" in ${rounds} empty fields | per field |`);
  console.log(`|---|---|---|`);
  THRESHOLDS.forEach((T, i) => console.log(`| ${T} | ${perThreshold[i]} | ${(perThreshold[i] / rounds).toFixed(2)} |`));
  out.control = { rounds, thresholds: THRESHOLDS, falseUnknown: perThreshold, totalCandidates: all, rows };
}

// ------------------------------------------------------------------ mode inject
const SIGMA_PSF = FWHM_ARCSEC[field.det] / 2.3548 / 6.14;
const erf = (x) => { const a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a); return x < 0 ? -y : y; };
const boxShare = (lo, hi, mu) => 0.5 * (erf((hi - mu) / (SIGMA_PSF * Math.SQRT2)) - erf((lo - mu) / (SIGMA_PSF * Math.SQRT2)));
const pixelShare = (i, j, x, y) => boxShare(i, i + 1, x) * boxShare(j, j + 1, y);

function detectorNoise(img) {                                           // the noise detectSources compares with (84th percentile - median of the smoothed image)
  const g = Float32Array.from(img, (v) => (Number.isFinite(v) ? v : 0)), tmp = new Float32Array(n * n), sm = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) tmp[y * n + x] = (g[y * n + Math.max(0, x - 1)] + 2 * g[y * n + x] + g[y * n + Math.min(n - 1, x + 1)]) / 4;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) sm[y * n + x] = (tmp[Math.max(0, y - 1) * n + x] + 2 * tmp[y * n + x] + tmp[Math.min(n - 1, y + 1) * n + x]) / 4;
  const s = Array.from(sm).sort((a, b) => a - b);
  return s[Math.floor(0.8413 * s.length)] - s[Math.floor(0.5 * s.length)];
}

function runInject() {
  const rng = mulberry32(seed);
  const trials = Number(args.trials ?? 10);
  const noise = f.arrays.map(detectorNoise);
  const baseDots = f.arrays.map((a, k) => detectSources(a, n, { sigmaFloor: 1e-9, mask: f.masks[k] }));
  const shifts = registerShifts(baseDots.map((s, k) => ({ mjd: mjds[k], sources: s }))).map((s) => (Math.abs(s.dx) > 0.05 || Math.abs(s.dy) > 0.05 ? s : { dx: 0, dy: 0 }));
  const midMjd = (mjds[0] + mjds[N - 1]) / 2;
  const t = mjds.map((m) => (m - midMjd) / 365.25);
  const KINDS = [["static", 0], ["mover 4 arcsec/yr", 4], ["mover 30 arcsec/yr", 30]].filter(([label]) => (args.kinds ?? "all") === "all" || label.startsWith(args.kinds));
  const amps = args.amps ? args.amps.split(",").map(Number) : AMPS;
  const table = [];
  for (const [label, speed] of KINDS) {
    for (const amp of amps) {
      const cell = { label, amp, trials: 0, listed: 0, unknown: 0, weak: 0, artefact: 0, other: 0, mjy: [], supports: [] };
      for (let trial = 0; trial < trials; trial++) {
        let truth = null;
        for (let tries = 0; tries < 400 && !truth; tries++) {
          const th = rng() * 2 * Math.PI, v = speed / scale;
          const x0 = MARGIN + rng() * (n - 2 * MARGIN), y0 = MARGIN + rng() * (n - 2 * MARGIN);
          const path = t.map((tk, k) => ({ x: x0 + v * Math.cos(th) * tk, y: y0 + v * Math.sin(th) * tk, sx: shifts[k].dx, sy: shifts[k].dy }));
          const clear = path.every((p, k) => p.x + p.sx >= MARGIN && p.x + p.sx <= n - MARGIN && p.y + p.sy >= MARGIN && p.y + p.sy <= n - MARGIN
            && !baseDots[k].some((d) => Math.hypot(d.x - p.x - p.sx, d.y - p.y - p.sy) < 6));        // not on top of a real source: that case is a blend, tested elsewhere
          if (clear) truth = path;
        }
        if (!truth) continue;
        const arrays = f.arrays.map((a, k) => {
          const img = Float32Array.from(a), flux = amp * noise[k], px = truth[k].x + truth[k].sx, py = truth[k].y + truth[k].sy;
          for (let j = Math.max(0, Math.floor(py - 4)); j <= Math.min(n - 1, Math.ceil(py + 4)); j++) for (let i = Math.max(0, Math.floor(px - 4)); i <= Math.min(n - 1, Math.ceil(px + 4)); i++) img[j * n + i] += flux * pixelShare(i, j, px, py);
          truth[k].flux = flux;
          return img;
        });
        cell.mjy.push(median(truth.map((p) => p.flux * mJyPerSum)));
        const res = discover({ frames: toFrames(arrays, f.masks), n, geo, isFloat: true, catalogues: EMPTY, options: speed === 0 ? { skipMovers: true } : {} });   // a fixed source needs no mover search (the slow part)
        // the candidate that sits on the fake: median distance between its per-image positions and the truth (registered positions included)
        const mine = res.candidates.filter((c) => {
          const d = truth.map((p, k) => (c.rawPositions[k] ? Math.hypot(c.rawPositions[k].x - (p.x + p.sx), c.rawPositions[k].y - (p.y + p.sy)) : null)).filter((v) => v !== null);
          return d.length >= 3 && median(d) <= 1.5;
        }).sort((a, b) => b.nDet - a.nDet)[0];
        cell.trials++;
        if (!mine) continue;
        cell.listed++;
        if (mine.class === "unknown" || mine.class === "unknown-weak") cell.supports.push(mine.support);
        if (mine.class === "unknown") cell.unknown++; else if (mine.class === "unknown-weak") cell.weak++; else if (mine.class === "artefact") cell.artefact++; else cell.other++;
      }
      table.push(cell);
      console.error(`  ${label}, flux ${amp}: ${cell.listed}/${cell.trials} listed, ${cell.unknown} unknown`);
    }
  }
  console.log(`| kind | flux (x detector noise) | median mJy | trials | listed | artefact | unknown at support >= 60 | >= 70 | >= 80 |`);
  console.log(`|---|---|---|---|---|---|---|---|---|`);
  for (const c of table) {
    const atLeast = (T) => c.supports.filter((v) => v >= T).length;
    console.log(`| ${c.label} | ${c.amp} | ${fmt(median(c.mjy), 2)} | ${c.trials} | ${c.listed} | ${c.artefact} | ${atLeast(60)} | ${atLeast(70)} | ${atLeast(80)} |`);
  }
  out.inject = { trials, amps, table };
}

const t0 = Date.now();
if (mode === "real") await runReal();
else if (mode === "control") runControl();
else if (mode === "inject") runInject();
else { console.error("--mode must be real, control or inject"); process.exit(2); }
console.log(`\n(total ${ms(t0)})`);
if (args.json && args.json !== "1") writeFileSync(args.json, JSON.stringify(out, null, 1));
