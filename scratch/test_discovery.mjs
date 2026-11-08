// Tests for the "see everything" pipeline: crossmatch.js, vetting.js, discovery.js, dossier.js.  Run: node scratch/test_discovery.mjs
// A synthetic field with a known answer: catalogued stars, a catalogued fast star, an uncatalogued static star and mover, a halo
// ghost, an edge artefact, a one-pass transient and a known asteroid.

import { separationArcsec, movePosition, normaliseCatalogue, matchCandidate, matchBodies, MIN_USEFUL_PM } from "../frontend/js/features/crossmatch.js";
import { edgeDistance, coreFlaggedCount, vetCandidate, looksLikeArtefact, supportScore } from "../frontend/js/features/vetting.js";
import { linkStaticSources, fitTrack, discover, stampFor, isShadowOf, NEEDS_CHECKING_SCORE, CLASSES, SETTINGS, VERSION } from "../frontend/js/features/discovery.js";
import { buildProvenance, missingProvenance, PROVENANCE_CSV_COLUMNS } from "../frontend/js/features/provenance.js";
import { degToHms, degToDms, mjdToIso, whatToCheck, candidateDossier, dossierMarkdown, candidatesToCsv, candidatesToJson, trackletCsv, CSV_COLUMNS } from "../frontend/js/features/dossier.js";
import { canvasToSky } from "../frontend/js/geometry.js";
import { mulberry32 } from "./lib_real.mjs";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ================================================================= crossmatch
check("separation: 1 arcsec in Dec, and RA scaled by cos(dec), and across RA = 0",
  near(separationArcsec(10, 20, 10, 20 + 1 / 3600), 1, 1e-6) && near(separationArcsec(10, 60, 10 + 1 / 3600, 60), 0.5, 1e-4) && near(separationArcsec(359.9999, 0, 0.0001, 0), 0.72, 1e-3));
{
  const p = movePosition(100, 0, 3.6, 7.2, 10);
  check("moving a position by a proper motion (east 3.6, north 7.2 arcsec/yr for 10 yr at Dec 0)", near(p.ra, 100 + 36 / 3600, 1e-9) && near(p.dec, 72 / 3600, 1e-9));
}
{
  const rows = normaliseCatalogue("simbad", [{ id: "A", ra: 10, dec: 20, pmra: 500, pmdec: -250 }, { id: "bad", ra: "x", dec: 1 }]);
  const tm = normaliseCatalogue("2mass", [{ id: "B", ra: 10, dec: 20, pmra: 999, mags: { J: 12.34, K: null } }]);
  check("SIMBAD rows keep their proper motion in arcsec/yr, rows without a position are dropped; 2MASS ignores one (it has none)",
    rows.length === 1 && rows[0].pmEast === 0.5 && rows[0].pmNorth === -0.25 && tm[0].pmEast === null && tm[0].mag === "J 12.3" && tm[0].epochMjd === 51400);
}
{
  // a star at (ra 100, dec 10) in 2026 that moves 2 arcsec/yr east: it was far to the west in 2000 (SIMBAD) and in 2010 (AllWISE has no motion)
  const cand = { ra: 100.0, dec: 10.0, epochMjd: 61000, pmEast: 2.0, pmNorth: 0, pmErr: 0.05, posErrArcsec: 1 };
  const dtSimbad = (61000 - 51544.5) / 365.25;
  const simbadPos = movePosition(cand.ra, cand.dec, -2, 0, dtSimbad);
  const dtWise = (61000 - 55380) / 365.25;
  const wisePos = movePosition(cand.ra, cand.dec, -2, 0, dtWise);
  const cats = {
    simbad: normaliseCatalogue("simbad", [{ id: "S", ra: simbadPos.ra, dec: simbadPos.dec, pmra: 2000, pmdec: 0 }]),
    allwise: normaliseCatalogue("allwise", [{ id: "W", ra: wisePos.ra, dec: wisePos.dec }]),
    "2mass": [],
  };
  const r = matchCandidate(cand, cats);
  check("a moving star matches SIMBAD (object moved to the image date) and AllWISE (candidate moved back to 2010) ", r.matches.some((m) => m.cat === "simbad") && r.matches.some((m) => m.cat === "allwise"), JSON.stringify(r.matches.map((m) => [m.cat, m.sepArcsec.toFixed(2)])));
  const still = matchCandidate({ ...cand, pmEast: 0.05, pmNorth: 0, pmErr: 0.05 }, { allwise: cats.allwise });
  check("a motion that is not significant is not used: the same star described as static does not match AllWISE's 2010 position (about 31 arcsec away)", still.matches.length === 0 && MIN_USEFUL_PM === 0.15);
  check("the report says which catalogues were checked and which were not", r.checked.join(", ") === "SIMBAD, 2MASS, AllWISE" && r.notChecked.join(", ") === "Gaia DR3", `${r.checked} / ${r.notChecked}`);
  const tight = matchCandidate({ ra: 100, dec: 10, epochMjd: 61000, pmEast: null, pmNorth: null, posErrArcsec: 1 }, { "2mass": normaliseCatalogue("2mass", [{ id: "n", ra: 100, dec: 10 + 20 / 3600 }]) });
  check("a source 20 arcsec away does not match (radius 8 arcsec)", tight.matches.length === 0);
}
{
  const body = matchBodies([{ ra: 10, dec: 10 }, null, { ra: 10, dec: 10 + 5 / 3600 }], [[{ name: "Ceres", ra: 10, dec: 10 + 2 / 3600, vmag: 9, cls: "MB", errArcsec: 1 }, { name: "Far", ra: 11, dec: 10 }], [], [{ name: "Ceres", ra: 10, dec: 10, vmag: 9, cls: "MB", errArcsec: 1 }]]);
  check("SkyBoT: the body at the candidate's place is found, counted in 2 images, the far one and one with a huge position error are ignored",
    body?.name === "Ceres" && body.hits === 2 && matchBodies([{ ra: 10, dec: 10 }], [[{ name: "Vague", ra: 10, dec: 10, errArcsec: 100 }]]) === null);
}

// ================================================================= vetting
const maskBlock = (x0, x1, y0, y1) => { const m = new Uint8Array(64 * 64); for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) m[j * 64 + i] = 1; return m; };
check("edge distance and flagged core pixels", edgeDistance(3, 30, 64) === 3 && edgeDistance(30, 40, 64) === 24 && coreFlaggedCount(maskBlock(28, 33, 28, 33), 64, 30.5, 30.5) === 25);
{
  const dets = (x, y, snr, fr) => fr.map((frame) => ({ frame, x, y, snr }));
  const f = vetCandidate({ detections: dets(30, 30, 50, [0, 1, 2, 3]), dotsPerFrame: [[], [], [], []], masks: [], n: 64, nPasses: 3, passes: 3 });
  check("a clean source has no flags", f.length === 0);
  const bright = Array(3).fill([{ x: 30, y: 30, snr: 5000 }]);
  check("a dot 10 px from a star 100 times brighter is in its halo; the same dot 20 px away is not",
    vetCandidate({ detections: dets(40, 30, 50, [0, 1, 2]), dotsPerFrame: bright, masks: [], n: 64, nPasses: 3, passes: 3 }).some((x) => x.code === "halo")
    && !vetCandidate({ detections: dets(50, 30, 50, [0, 1, 2]), dotsPerFrame: bright, masks: [], n: 64, nPasses: 3, passes: 3 }).some((x) => x.code === "halo"));
  const edge = vetCandidate({ detections: dets(3, 30, 50, [0, 1, 2]), dotsPerFrame: [[], [], []], masks: Array(3).fill(maskBlock(1, 6, 28, 33)), n: 64, nPasses: 3, passes: 3 });
  check("an edge dot with flagged pixels has two warnings and looks like an artefact; a bright flagged core is only information",
    edge.map((x) => x.code).sort().join() === "edge,flagged-core" && looksLikeArtefact(edge)
    && vetCandidate({ detections: dets(30, 30, 500, [0, 1, 2]), dotsPerFrame: [[], [], []], masks: Array(3).fill(maskBlock(28, 33, 28, 33)), n: 64, nPasses: 3, passes: 3 })[0].severity === "info");
  check("two detections are severe, one pass of three is information, a scatter above 0.8 px is a warning",
    vetCandidate({ detections: dets(30, 30, 50, [0, 1]), dotsPerFrame: [[], []], masks: [], n: 64 })[0].severity === "severe"
    && vetCandidate({ detections: dets(30, 30, 50, [0, 1, 2]), dotsPerFrame: [[], [], []], masks: [], n: 64, nPasses: 3, passes: 1 })[0].code === "single-pass"
    && vetCandidate({ detections: dets(30, 30, 50, [0, 1, 2]), dotsPerFrame: [[], [], []], masks: [], n: 64, rmsPx: 1 })[0].code === "scattered");
  const good = supportScore({ nDet: 9, passes: 3, medianSnr: 40, rmsPx: 0.1, kind: "static" }, []);
  const bad = supportScore({ nDet: 3, passes: 1, medianSnr: 6, rmsPx: 0.7, kind: "static" }, [{ code: "halo", severity: "warn" }, { code: "edge", severity: "warn" }]);
  check("support score: a source seen 9 times in 3 passes scores above 85, a halo-edge dot seen 3 times in one pass below 40; two detections cap at 20",
    good.score > 85 && bad.score < 40 && supportScore({ nDet: 2, passes: 2, medianSnr: 100, rmsPx: 0, kind: "static" }, [{ code: "few-detections", severity: "severe" }]).score <= 20, `${good.score}, ${bad.score}`);
  const alike = { nDet: 3, passes: 3, medianSnr: 40, rmsPx: 0.2, kind: "static" };
  check("persistence: three bright dots that line up in 3 of 18 images score at least 20 points less than the same dots present in all of them",
    supportScore({ ...alike, persistence: { fraction: 1 } }, []).score - supportScore({ ...alike, persistence: { fraction: 3 / 18 } }, []).score >= 20,
    `${supportScore({ ...alike, persistence: { fraction: 1 } }, []).score} vs ${supportScore({ ...alike, persistence: { fraction: 3 / 18 } }, []).score}`);
  check("persistence: a caller that does not know it (older code) is not punished", supportScore(alike, []).score === supportScore({ ...alike, persistence: { fraction: 1 } }, []).score);
  check("a mover's score grows with how unlikely a chance line is", supportScore({ nDet: 6, passes: 3, medianSnr: 30, rmsPx: 0.2, kind: "mover", falseAlarm: 1e-8 }, []).score > supportScore({ nDet: 6, passes: 3, medianSnr: 30, rmsPx: 0.2, kind: "mover", falseAlarm: 0.5 }, []).score + 15);
}

// ================================================================= the synthetic field
const N = 64, SCALE = 6.14;
const geo = { ra: 200, dec: 20, n: N, scaleArcsec: SCALE };
const MJDS = [60800, 60801, 60802, 60980, 60981, 60982, 61160, 61161, 61162];
const rng = mulberry32(42);
const gauss = () => { const u = Math.max(rng(), 1e-12), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const shifts = MJDS.map((_, k) => (k === 0 ? { x: 0, y: 0 } : { x: (rng() - 0.5) * 0.8, y: (rng() - 0.5) * 0.8 }));
const skyOf = (x, y) => canvasToSky(x / N, y / N, geo);
const years = (mjd) => (mjd - MJDS[4]) / 365.25;

const STARS = Array.from({ length: 12 }, (_, i) => ({ x: 8 + (i % 4) * 14 + rng() * 4, y: 10 + Math.floor(i / 4) * 16 + rng() * 4, amp: 60 + rng() * 240 }));
const BRIGHT = { x: 32.3, y: 32.6, amp: 4000 };
const FAINT = { x: 50.4, y: 50.7, amp: 22 };                                      // not in any catalogue, in every image
const HPM = { x0: 18.2, y0: 52.4, vx: 4.5, vy: -3.0, amp: 120 };                  // fast star in SIMBAD (px/yr)
const MOVER = { x0: 10.5, y0: 58.1, vx: 3.2, vy: -1.4, amp: 60 };                // fast, not in any catalogue
const GHOST = { x: BRIGHT.x + 9.2, y: BRIGHT.y + 0.4, amp: 45 };                  // a dot 9 px from the bright star
const EDGE = { x: 3.4, y: 22.2, amp: 70 };                                        // at the edge, flagged pixels
const TRANSIENT = { x: 55.8, y: 21.0, amp: 80, frames: [0, 1, 2] };               // only in the first pass
const ASTEROID = { x: 40.6, y: 8.7, amp: 90, frame: 4 };                          // one image only, SkyBoT knows it

function render(k) {
  const img = new Float32Array(N * N), mask = new Uint8Array(N * N);
  for (let i = 0; i < img.length; i++) img[i] = 0.5 + gauss();
  const put = (x, y, amp) => {
    for (let j = Math.max(0, Math.floor(y - 5)); j <= Math.min(N - 1, Math.ceil(y + 5)); j++) for (let i = Math.max(0, Math.floor(x - 5)); i <= Math.min(N - 1, Math.ceil(x + 5)); i++) {
      img[j * N + i] += amp * Math.exp(-((i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2) / (2 * 0.8 ** 2));
    }
  };
  const s = shifts[k], t = years(MJDS[k]);
  for (const st of STARS) put(st.x + s.x, st.y + s.y, st.amp);
  put(BRIGHT.x + s.x, BRIGHT.y + s.y, BRIGHT.amp); put(FAINT.x + s.x, FAINT.y + s.y, FAINT.amp); put(GHOST.x + s.x, GHOST.y + s.y, GHOST.amp);
  put(HPM.x0 + HPM.vx * t + s.x, HPM.y0 + HPM.vy * t + s.y, HPM.amp); put(MOVER.x0 + MOVER.vx * t + s.x, MOVER.y0 + MOVER.vy * t + s.y, MOVER.amp);
  put(EDGE.x + s.x, EDGE.y + s.y, EDGE.amp);
  for (let j = 19; j < 26; j++) for (let i = 0; i < 7; i++) mask[j * N + i] = 1;     // flagged pixels around the edge artefact
  if (TRANSIENT.frames.includes(k)) put(TRANSIENT.x + s.x, TRANSIENT.y + s.y, TRANSIENT.amp);
  if (k === ASTEROID.frame) put(ASTEROID.x + s.x, ASTEROID.y + s.y, ASTEROID.amp);
  return { id: `f${k}`, mjd: MJDS[k], detector: "D2", wavelengthUm: 1.1 + 0.05 * k, grey: img, mask };
}
const frames = MJDS.map((_, k) => render(k));

// catalogues: the 12 stars and the bright star in SIMBAD (a few only in AllWISE); the fast star in SIMBAD with its proper motion at J2000
const cat = { simbad: [], allwise: [] };
STARS.forEach((st, i) => { const p = skyOf(st.x, st.y); (i % 3 === 0 ? cat.allwise : cat.simbad).push({ id: `star ${i}`, ra: p.ra, dec: p.dec, pmra: 0, pmdec: 0, epochMjd: i % 3 === 0 ? 55380 : undefined }); });
{ const p = skyOf(BRIGHT.x, BRIGHT.y); cat.simbad.push({ id: "bright star", ra: p.ra, dec: p.dec, pmra: 0, pmdec: 0 }); }
{
  const tm = MJDS[4], p = skyOf(HPM.x0, HPM.y0);                                  // position at the middle date
  const pmE = -HPM.vx * SCALE, pmN = -HPM.vy * SCALE;                              // arcsec/yr (image right = west, down = south)
  const j2000 = movePosition(p.ra, p.dec, -pmE, -pmN, (tm - 51544.5) / 365.25);
  cat.simbad.push({ id: "fast star", ra: j2000.ra, dec: j2000.dec, pmra: pmE * 1000, pmdec: pmN * 1000 });
}
const catalogues = { simbad: normaliseCatalogue("simbad", cat.simbad), gaia: [], "2mass": [], allwise: normaliseCatalogue("allwise", cat.allwise) };
const asteroidSky = skyOf(ASTEROID.x + shifts[4].x, ASTEROID.y + shifts[4].y);
const skybot = MJDS.map((_, k) => (k === 4 ? [{ name: "(9999) Test", ra: asteroidSky.ra, dec: asteroidSky.dec, vmag: 17.2, cls: "MB>Inner", errArcsec: 1 }, { name: "(1) Far away", ra: asteroidSky.ra + 0.5, dec: asteroidSky.dec, vmag: 9, cls: "MB", errArcsec: 1 }] : []));

const result = discover({ frames, n: N, geo, isFloat: true, catalogues, skybot });
const at = (x, y, tol = 3) => result.candidates.filter((c) => { const s = skyOf(x, y); return separationArcsec(c.ra, c.dec, s.ra, s.dec) <= tol * SCALE; });
const one = (x, y, kind) => at(x, y).find((c) => !kind || c.kind === kind);
const ok = (c, cls) => c?.class === cls;

check("stages: 9 images in 3 passes, dots found in every image", result.stats.frames === 9 && result.stats.passes === 3 && result.stats.dotsPerFrame.every((d) => d >= 15), JSON.stringify(result.stats.dotsPerFrame));
{
  const known = STARS.map((st) => one(st.x, st.y, "static"));
  check("the 12 catalogued stars (some only in AllWISE) are all 'In a catalogue', each seen in all 9 images", known.every((c) => ok(c, "catalogued") && c.nDet >= 8), known.map((c) => c?.class ?? "MISSING").join(","));
}
check("the bright star is catalogued", ok(one(BRIGHT.x, BRIGHT.y, "static"), "catalogued"));
{
  const c = result.candidates.find((x) => x.kind === "mover" && ok(x, "catalogued-moving"));
  check("the fast star is found as a mover and matched to SIMBAD through its proper motion: 'In a catalogue, and moving'", Boolean(c) && c.catalogue.matches[0]?.cat === "simbad" && c.motionIsReal && near(Math.hypot(c.pmEast, c.pmNorth), Math.hypot(HPM.vx, HPM.vy) * SCALE, 2.5), c ? `${Math.hypot(c.pmEast, c.pmNorth).toFixed(1)}"/yr` : "none");
}
{
  const c = result.candidates.find((x) => x.kind === "mover" && x.class === "unknown");
  check("the mover that no catalogue has is 'Unknown: needs checking', tagged moving, with 6+ detections and a chance-line number below 1e-3", Boolean(c) && c.tags.includes("moving") && c.nDet >= 6 && c.falseAlarm < 1e-3 && c.support >= NEEDS_CHECKING_SCORE, c ? `${c.class} support ${c.support}` : "none");
}
{
  const c = one(FAINT.x, FAINT.y, "static");
  check("the faint static star that no catalogue has is 'Unknown: needs checking' (support at least the threshold), seen in all passes", ok(c, "unknown") && c.passes === 3 && c.support >= NEEDS_CHECKING_SCORE, c ? `${c.class} support ${c.support}` : "MISSING");
}
{
  const c = one(GHOST.x, GHOST.y, "static");
  check("the dot 9 px from a star 90 times brighter is a 'Possible artefact' with the halo flag", ok(c, "artefact") && c.flags.some((f) => f.code === "halo"), c ? `${c.class}: ${c.flags.map((f) => f.code)}` : "MISSING");
}
{
  const c = one(EDGE.x, EDGE.y, "static");
  check("the edge dot with flagged pixels is a 'Possible artefact' (edge + flagged core)", ok(c, "artefact") && c.flags.map((f) => f.code).includes("edge"), c ? `${c.class}: ${c.flags.map((f) => f.code)}` : "MISSING");
}
{
  const c = one(TRANSIENT.x, TRANSIENT.y, "static");
  check("the source seen only in the first pass is 'Unknown', tagged transient (absent in the other 6 images), with the one-pass flag text", ok(c, "unknown") && c.tags.includes("transient") && c.passes === 1 && c.flags.some((f) => f.code === "appears-in-one-pass"), c ? `${c.class} ${c.tags} support ${c.support}` : "MISSING");
}
{
  const c = result.candidates.find((x) => x.kind === "asteroid");
  check("the dot where SkyBoT puts a body, in one image, is a 'Known Solar System body'; the body far away is ignored", ok(c, "solar-system") && c.body?.name === "(9999) Test" && result.candidates.filter((x) => x.kind === "asteroid").length === 1);
}
{
  const unknown = result.candidates.filter((c) => c.class === "unknown");
  check("exactly three candidates need checking (the faint star, the mover, the transient) and nothing else", unknown.length === 3, unknown.map((c) => `${c.kind}@${c.ra.toFixed(4)}`).join(" "));
  check("the summary counts add up", result.summary.total === result.candidates.length && Object.values(result.summary.counts).reduce((a, b) => a + b, 0) === result.summary.total && result.summary.needsChecking === 3 && result.summary.catalogues.join() === "simbad,gaia,2mass,allwise");
  check("candidates are ordered: unknown first, then artefacts, then known ones", result.candidates[0].class === "unknown" && result.candidates.at(-1).class === "catalogued");
}
{
  const bare = discover({ frames, n: N, geo, isFloat: true, catalogues: {}, skybot: null, options: { dots: result.dots } });
  check("with no catalogue checked at all, nothing is called unknown: every source is 'Not checked against catalogues'", bare.candidates.length > 0 && bare.candidates.every((c) => c.class === "unchecked"), [...new Set(bare.candidates.map((c) => c.class))].join());
  check("fewer than 3 images: a reason, no candidates", discover({ frames: frames.slice(0, 2), n: N, geo, catalogues }).reason === "needs at least 3 images");
}
{
  // the catalogue star at the mover's place does not move like the mover: a chance line through a fixed star, not "known and moving"
  const mid = skyOf(HPM.x0, HPM.y0);
  const staticTwin = cat.simbad.map((o) => (o.id === "fast star" ? { id: o.id, ra: mid.ra, dec: mid.dec, pmra: 0, pmdec: 0 } : o));
  const wrong = discover({ frames, n: N, geo, isFloat: true, catalogues: { ...catalogues, simbad: normaliseCatalogue("simbad", staticTwin) }, skybot: null, options: { dots: result.dots } });
  const c = wrong.candidates.find((x) => x.kind === "mover" && separationArcsec(x.ra, x.dec, mid.ra, mid.dec) < 6 * SCALE);
  check("a mover on a catalogue star whose own motion is ~0 is a 'Possible artefact' with the motion-disagrees flag, not 'In a catalogue, and moving'",
    c?.class === "artefact" && c.flags.some((f) => f.code === "motion-disagrees") && c.catalogue.matches.every((m) => m.pmConsistent === false), c ? `${c.class}: ${c.flags.map((f) => f.code)}` : "MISSING");
  check("...while the same star with its true proper motion stays 'In a catalogue, and moving' (consistent motions)", result.candidates.find((x) => x.kind === "mover" && ok(x, "catalogued-moving"))?.catalogue.matches[0].pmConsistent === true);
}
{
  const cand = { ra: 10, dec: 20, epochMjd: 60800, pmEast: 10, pmNorth: 0, pmErr: 0.5, posErrArcsec: 1 };
  const star = (pmra) => normaliseCatalogue("simbad", [{ id: "S", ra: 10 + (10 * ((60800 - 51544.5) / 365.25)) / 3600 / Math.cos(20 * Math.PI / 180) * -1 + 0, dec: 20, pmra, pmdec: 0 }]);
  const same = matchCandidate({ ...cand }, { simbad: normaliseCatalogue("simbad", [{ id: "S", ra: movePosition(10, 20, -10, 0, (60800 - 51544.5) / 365.25).ra, dec: 20, pmra: 10000, pmdec: 0 }]) });
  check("motion check: a catalogue star with the same motion agrees", same.matches.length === 1 && same.matches[0].pmConsistent === true, JSON.stringify(same.matches.map((m) => m.pmConsistent)));
  const fixedStar = matchCandidate({ ...cand }, { simbad: normaliseCatalogue("simbad", [{ id: "S", ra: 10, dec: 20, pmra: 15, pmdec: 0 }]) });
  check("motion check: a star at the same place that hardly moves disagrees with a 10 arcsec/yr candidate", fixedStar.matches[0]?.pmConsistent === false, JSON.stringify(fixedStar.matches.map((m) => m.pmConsistent)));
  const still = matchCandidate({ ...cand, pmEast: null, pmNorth: null }, { simbad: normaliseCatalogue("simbad", [{ id: "S", ra: 10, dec: 20, pmra: 15, pmdec: 0 }]) });
  check("motion check: a candidate with no measured motion is not judged (null)", still.matches[0]?.pmConsistent === null);
  const twoMASS = matchCandidate({ ...cand }, { "2mass": normaliseCatalogue("2mass", [{ id: "T", ra: 10, dec: 20, epochMjd: 60800 }]) });
  check("motion check: 2MASS lists no motion, so there is nothing to compare (null)", twoMASS.matches[0]?.pmConsistent === null);
}
{
  const fixed = { nDet: 12, rawPositions: Array.from({ length: 12 }, (_, g) => ({ x: 40 + 0.05 * g, y: 10 })) };
  const lineThrough = { nDet: 4, detections: [0, 3, 6, 9].map((g) => ({ frame: g, x: 40 + 0.4 * (g / 3), y: 10.2 })) };
  const realMover = { nDet: 4, detections: [0, 3, 6, 9].map((g) => ({ frame: g, x: 40 + 3 * g, y: 10 })) };
  check("shadow mover: four dots within 1.5 px of a fixed source seen in 12 images are part of it", isShadowOf(lineThrough, fixed) === true);
  check("shadow mover: a real mover that only starts at the fixed source is not", isShadowOf(realMover, fixed) === false);
  check("shadow mover: a fixed source with fewer detections than the mover is never its owner", isShadowOf(lineThrough, { ...fixed, nDet: 3 }) === false);
}
{
  // SIMBAD alone is too shallow to call anything new: only a deep catalogue (Gaia, 2MASS, AllWISE) that checked the source completely can
  const simbadOnly = discover({ frames, n: N, geo, isFloat: true, catalogues: { simbad: catalogues.simbad }, skybot: null, options: { dots: result.dots } });
  check("only SIMBAD checked: nothing unmatched is called unknown (it is 'Not checked against catalogues')", simbadOnly.candidates.every((c) => c.class !== "unknown" && c.class !== "unknown-weak"), [...new Set(simbadOnly.candidates.map((c) => c.class))].join());
  check("...but a source SIMBAD does list is still 'In a catalogue'", simbadOnly.candidates.some((c) => c.class === "catalogued" || c.class === "catalogued-moving"));
  // a list the server cut short cannot prove absence: the unmatched sources become 'not checked', the matched ones stay matched
  const cut = Object.assign([...catalogues["2mass"]], { truncated: true });
  const onlyCut = discover({ frames, n: N, geo, isFloat: true, catalogues: { "2mass": cut }, skybot: null, options: { dots: result.dots } });
  check("a truncated 2MASS list alone: no source is called unknown", onlyCut.candidates.every((c) => c.class !== "unknown" && c.class !== "unknown-weak"), [...new Set(onlyCut.candidates.map((c) => c.class))].join());
  const mixed = discover({ frames, n: N, geo, isFloat: true, catalogues: { ...catalogues, "2mass": cut }, skybot: null, options: { dots: result.dots } });
  const faint = mixed.candidates.find((c) => c.kind === "static" && separationArcsec(c.ra, c.dec, skyOf(FAINT.x, FAINT.y).ra, skyOf(FAINT.x, FAINT.y).dec) < 4);
  check("a truncated list next to complete ones: still unknown (the complete ones checked it), and the dossier names the incomplete one",
    faint?.class === "unknown" && faint.catalogue.notChecked.some((t) => t.includes("2MASS") && t.includes("incomplete")) && !faint.catalogue.checked.includes("2MASS"), faint ? faint.catalogue.notChecked.join(" / ") : "no faint star");
}
{
  const c = one(FAINT.x, FAINT.y, "static");
  const ph = c.photometry;
  check("the spectrum has one point per image, with the wavelength of the image, a flux in mJy and a good S/N where it was detected", ph.length === 9 && near(ph[3].wavelengthUm, 1.25, 1e-9) && ph.every((p) => p.measured && p.fluxMilliJy > 0 && p.snr > 5), JSON.stringify(ph[0]).slice(0, 160));
  const err = separationArcsec(c.ra, c.dec, skyOf(FAINT.x, FAINT.y).ra, skyOf(FAINT.x, FAINT.y).dec);
  check("persistence: the faint star is present (3 sigma) in all 9 images", c.persistence.images === 9 && c.persistence.present >= 8, JSON.stringify(c.persistence));
  const tr = result.candidates.find((x) => x.tags.includes("transient"));
  check("persistence: the one-pass transient is judged within its own pass only, where it is present in every image", tr && tr.persistence.images >= 2 && tr.persistence.fraction >= 0.8, tr ? JSON.stringify(tr.persistence) : "no transient");
  check("the position is right to within about half a pixel (the faint star's true place)", err < 3.5, `${err.toFixed(2)}"`);
  const stamp = stampFor(frames[0], N, 50.4, 50.7);
  check("a stamp is 24 x 24 pixels around the source, with the star near its middle", stamp.size === 24 && stamp.values.length === 576 && stamp.values[(50 - stamp.y0) * 24 + (50 - stamp.x0)] > 5);
}

// ================================================================= static linking and the straight-line fit
{
  const dots = [[{ x: 10, y: 10, snr: 50 }, { x: 40, y: 40, snr: 9 }], [{ x: 10.4, y: 10.2, snr: 40 }], [{ x: 9.8, y: 9.9, snr: 45 }, { x: 10.5, y: 10.4, snr: 20 }], [{ x: 20, y: 20, snr: 8 }]];
  const c = linkStaticSources(dots, { minDetections: 3 });
  check("linking: three dots within 1.2 px form one source (one member per image, the second dot of image 3 stays out), the lone ones are dropped", c.length === 1 && c[0].members.length === 3 && near(c[0].x, 10.07, 0.1));
  const fit = fitTrack([{ frame: 0, x: 10, y: 5 }, { frame: 1, x: 12, y: 5 }, { frame: 2, x: 14, y: 5 }], [0, 365.25, 730.5]);
  const still = fitTrack([{ frame: 0, x: 10, y: 5 }, { frame: 1, x: 10.05, y: 5 }, { frame: 2, x: 9.95, y: 5 }], [0, 1, 2]);
  check("the straight-line fit gives the speed (2 px/yr) and says nothing about motion when the dots span only 2 days", near(fit.vx, 2, 1e-9) && near(fit.vy, 0, 1e-9) && Number.isFinite(fit.vErr) && still.vx === 0 && still.vErr === Infinity);
}

// ================================================================= dossier and exports
check("sexagesimal text", degToHms(269.4462) === "17h57m47.09s" && degToDms(4.769) === "+04d46m08.4s" && degToDms(-56.8006) === "-56d48m02.2s" && mjdToIso(51544.5) === "2000-01-01T12:00:00Z");
{
  const ctx = { isReal: false, detector: "D2", query: { ra: 200, dec: 20, fov: 5 }, permalink: "http://x/?ra=200", frames: MJDS.map((m) => ({ dateISO: mjdToIso(m) })), generated: "2026-11-08T00:00:00Z" };
  const c = result.candidates.find((x) => x.class === "unknown" && x.kind === "mover");
  const d = candidateDossier(c, ctx), md = dossierMarkdown(d);
  check("dossier: position, motion, spectrum of 9 images, flags, catalogue statement ('No match'), what to check, and a data label that says SYNTHETIC",
    d.spectrum.length === 9 && d.motion.significant && d.catalogue.matches.length === 0 && d.whatToCheck.length >= 3 && /SYNTHETIC/.test(d.provenance.data) && /\*\*No match\*\* in SIMBAD, Gaia DR3, 2MASS, AllWISE/.test(md)
    && /Needs checking/.test(md) && /not a discovery/.test(md) && !/ADES/.test(md));
  check("the dossier survives JSON and the Markdown has every section", JSON.parse(JSON.stringify(d)).id === c.id && ["## Catalogues", "## Flags", "## Spectrum, image by image", "## What to check next", "## Provenance"].every((h) => md.includes(h)));
  const csv = candidatesToCsv(result.candidates, ctx), lines = csv.trim().split("\r\n");
  check("CSV: one header and one line per candidate, and every line says the data is synthetic", lines.length === result.candidates.length + 1 && lines[0] === CSV_COLUMNS.join(",") && lines.slice(1).every((l) => /SYNTHETIC demo data/.test(l)));
  const evil = candidatesToCsv([{ ...result.candidates[0], id: "=HYPERLINK(\"x\")", classLabel: "+cmd" }], ctx);
  const evilLine = evil.split("\r\n")[1];
  check("text that would run as a spreadsheet formula is neutralised with an apostrophe (inside the quotes the cell needs)", evilLine.startsWith("\"'=HYPERLINK") && evilLine.includes("'+cmd") && !evilLine.startsWith("="));
  const json = JSON.parse(candidatesToJson(result.candidates, ctx));
  check("JSON: the same candidates as full dossiers, with the field and the note that they are not discoveries", json.candidates.length === result.candidates.length && json.field.ra_deg === 200 && /not discoveries/.test(json.note));
  const tr = trackletCsv(c, ctx).trim().split("\r\n");
  check("tracklet CSV: one line per image where the mover was seen, UTC time, RA, Dec, uncertainty (and it is not called ADES)", tr.length === c.frames.length + 1 && /obs_time_utc/.test(tr[0]) && /2025-|2026-/.test(tr[1]) && !/ADES/i.test(tr.join()));
  check("every class has a label and a 'what to check' text exists for each candidate", Object.keys(CLASSES).length === 7 && result.candidates.every((x) => whatToCheck(x).length >= 1));

  // ---- provenance: the run, not the export, is described
  const frames = MJDS.map((m, k) => ({ mjd: m, dateISO: mjdToIso(m), detector: "D2", wavelengthUm: 1.1 + 0.05 * k }));
  const provenance = buildProvenance({ analysis: "find-everything", algorithm: { version: VERSION }, ctx, frames, settings: { ...SETTINGS }, ranAt: "2026-11-08T10:00:00Z", durationMs: 4200,
    catalogues: { used: ["simbad"], problems: [] }, pixels: "8-bit pictures" });
  check("provenance (Find everything): complete, with the algorithm version and the numbers the search ran with", missingProvenance(provenance).length === 0 && provenance.algorithm.version === VERSION
    && provenance.settings.needsCheckingScore === NEEDS_CHECKING_SCORE && provenance.input.images.count === 9);
  const pctx = { ...ctx, provenance };
  const pcsv = candidatesToCsv(result.candidates, pctx).trim().split("\r\n");
  const header = pcsv[0].split(",");
  check("provenance in the CSV: every candidate's line carries the analysis, the version, the run time, the images used and the settings", PROVENANCE_CSV_COLUMNS.every((k) => header.includes(k))
    && pcsv.slice(1).every((l) => l.includes(`,${VERSION},2026-11-08T10:00:00Z,9,`) && l.includes("needsCheckingScore=65")));
  const withoutRun = candidatesToCsv(result.candidates, ctx).trim().split("\r\n");
  check("without a recorded run the provenance cells are empty, never invented", withoutRun[1].endsWith(",,,,,,") && !withoutRun[1].includes("movers-"));
  const pjson = JSON.parse(candidatesToJson(result.candidates, pctx));
  check("provenance in the JSON: at the top and inside every dossier", pjson.provenance.ranAt === "2026-11-08T10:00:00Z" && pjson.candidates.every((x) => x.provenance.run.algorithm.version === VERSION));
  const pmd = dossierMarkdown(candidateDossier(c, pctx));
  check("provenance in the Markdown dossier: the paragraph that says how the search was run", pmd.includes("### How the search was run") && pmd.includes("2026-11-08T10:00:00Z") && pmd.includes(`discovery-2`) && pmd.includes("needsCheckingScore=65") && pmd.includes("SYNTHETIC"));
  check("a dossier made without a recorded run says nothing about one", !dossierMarkdown(candidateDossier(c, ctx)).includes("How the search was run") && candidateDossier(c, ctx).provenance.run === null);
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
