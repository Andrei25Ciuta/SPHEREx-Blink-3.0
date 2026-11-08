// Tests for frontend/js/features/movers.js ("Find movers").  Run: node scratch/test_movers.mjs
import { detectSources, findMovers, findMoversInImages, findMoversAcrossDetectors, describeMover, matchKnownObject, binomialTail, apertureSnr, trackSupport, blendWarning } from "../frontend/js/features/movers.js";
import { mulberry32, renderPixels, stretchAsinh, observe } from "../frontend/js/data/mockSource.js";
import { TARGETS, positionAtEpoch } from "../frontend/js/targets.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const emptyField = () => ({
  stars: [],
  variable: { x: 0, y: 0, flux: 0, periodDays: 100 },
  mover: { x0: 0, y0: 0, vx: 0, vy: 0, flux: 0 },
});

// ---------------------------------------------------------------- 1) detection
{
  const field = emptyField();
  field.stars.push({ x: 30.3, y: 40.7, flux: 200 });
  const grey = stretchAsinh(renderPixels(field, 64, 60800, 0, 3, mulberry32(1)));
  const dots = detectSources(grey, 64);
  const off = dots.length ? Math.hypot(dots[0].x - 30.3, dots[0].y - 40.7) : NaN;
  check("detects exactly one injected star", dots.length === 1, `${dots.length} dot(s)`);
  check("its centre is within 0.25 px", off < 0.25, `off by ${off.toFixed(2)} px`);

  // A very bright star saturates the 8-bit picture into a flat-topped blob (seen on real Barnard's Star
  // cutouts): its centre must still be found, or its position jumps from date to date.
  const bright = emptyField();
  bright.stars.push({ x: 30.3, y: 40.7, flux: 20000 });
  const blob = detectSources(stretchAsinh(renderPixels(bright, 64, 60800, 0, 3, mulberry32(1))), 64);
  const blobOff = blob.length ? Math.hypot(blob[0].x - 30.3, blob[0].y - 40.7) : NaN;
  check("a saturated (flat-topped) star is centred within 0.5 px", blob.length === 1 && blobOff < 0.5, `${blob.length} dot(s), off by ${blobOff.toFixed(2)} px`);

  let falseDots = 0;
  for (let seed = 1; seed <= 10; seed++) {
    falseDots += detectSources(stretchAsinh(renderPixels(emptyField(), 200, 60800, 0, 3, mulberry32(seed))), 200).length;
  }
  check("pure noise gives (almost) no dots", falseDots <= 2, `${falseDots} dots in 10 noise-only 200x200 images`);
}

// ---------------------------------------------------------------- 2) synthetic scenes
// Three survey passes about half a year apart, a few visits each (like the mock schedule).
const MJDS = [60800, 60801.7, 60803.4, 60983, 60984.7, 60986.4, 61165, 61166.7];
function scene(seed, speed, angle, asFloat = false) {
  const rng = mulberry32(seed);
  const size = 120, field = emptyField();
  for (let i = 0; i < 90; i++) {
    field.stars.push({ x: rng() * size, y: rng() * size, flux: Math.min(400, 8 * Math.pow(rng(), -1.2)) });
  }
  const mid = (MJDS[0] + MJDS.at(-1)) / 2;
  // Keep the mover's track at least 5 px from every star: a mover that sits on top of a bright
  // star blends with it (a documented limit, checked separately below).
  for (let tries = 0; tries < 200; tries++) {
    field.mover = { x0: 40 + rng() * 40, y0: 40 + rng() * 40, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, flux: 60 };
    const clear = MJDS.every((mjd) => {
      const yrs = (mjd - mid) / 365.25;
      const px = field.mover.x0 + field.mover.vx * yrs, py = field.mover.y0 + field.mover.vy * yrs;
      return field.stars.every((s) => Math.hypot(s.x - px, s.y - py) >= 5);
    });
    if (clear) break;
  }
  const frames = MJDS.map((mjd, i) => ({
    mjd,
    grey: asFloat ? renderPixels(field, size, mjd, (mjd - mid) / 365.25, 3.5, mulberry32(seed * 100 + i))
                  : stretchAsinh(renderPixels(field, size, mjd, (mjd - mid) / 365.25, 3.5, mulberry32(seed * 100 + i))),
  }));
  return { size, field, frames, mid };
}
/** Does a candidate match the true mover (position at its reference date, and speed)? */
function isTrueMover(c, field, mid) {
  const years = (c.mjdRef - mid) / 365.25;
  const dist = Math.hypot(c.x - (field.mover.x0 + field.mover.vx * years), c.y - (field.mover.y0 + field.mover.vy * years));
  const truthSpeed = Math.hypot(field.mover.vx, field.mover.vy);
  return dist < 1.0 && Math.abs(c.speedPx / truthSpeed - 1) < 0.2;
}

// Real pixel values (floats, as the backend now serves them): same scenes, no 8-bit stretch, some pixels with no data (NaN).
for (const speed of [3, 1.3, 0.9]) {
  let ok = 0, extra = 0;
  const seeds = [41, 42, 43, 44];
  for (const seed of seeds) {
    const s = scene(seed, speed, mulberry32(seed)() * 2 * Math.PI, true);
    for (const f of s.frames) for (let k = 0; k < 40; k++) f.grey[(k * 977) % f.grey.length] = NaN;
    const { candidates } = findMoversInImages(s.frames, s.size, { sigmaFloor: 1e-9 });
    if (candidates.some((c) => isTrueMover(c, s.field, s.mid))) ok++;
    extra += candidates.filter((c) => !isTrueMover(c, s.field, s.mid)).length;
  }
  check(`float pixels (with NaN): finds a ${speed} px/yr mover (${(speed * 6.2).toFixed(1)}"/yr)`, ok === seeds.length && extra === 0, `${ok}/${seeds.length} found, ${extra} false`);
}

for (const speed of [12, 3, 1.7, 1.3]) {
  let ok = 0, extra = 0;
  const seeds = [11, 12, 13, 14];
  for (const seed of seeds) {
    const s = scene(seed, speed, mulberry32(seed)() * 2 * Math.PI);
    const { candidates } = findMoversInImages(s.frames, s.size);
    if (candidates.some((c) => isTrueMover(c, s.field, s.mid))) ok++;
    extra += candidates.filter((c) => !isTrueMover(c, s.field, s.mid)).length;
  }
  check(`finds a ${speed} px/yr mover (${(speed * 6.2).toFixed(1)}"/yr)`, ok === seeds.length && extra === 0,
    `${ok}/${seeds.length} found, ${extra} false candidate(s)`);
}
{
  // Motion far below one pixel over the whole period must NOT be reported (it looks like a still star).
  let reported = 0;
  for (const seed of [21, 22, 23]) {
    const s = scene(seed, 0.2, 1.0);
    reported += findMoversInImages(s.frames, s.size).candidates.length;
  }
  check("a 0.2 px/yr 'mover' is treated as a still star", reported === 0, `${reported} candidate(s)`);
  let falseAlarms = 0;
  for (const seed of [31, 32, 33, 34, 35, 36]) {
    const s = scene(seed, 0, 0);
    falseAlarms += findMoversInImages(s.frames, s.size).candidates.length;
  }
  check("a field with nothing moving gives no candidates", falseAlarms === 0, `${falseAlarms} candidate(s) in 6 fields`);
}

// ---------------------------------------------------------------- 2b) pointing errors between passes (seen on real data)
{
  // Every exposure has its own small pointing error: here whole images are shifted by up to ~0.8 px between passes.
  const rng = mulberry32(77);
  const stars = Array.from({ length: 25 }, () => ({ x: 10 + rng() * 80, y: 10 + rng() * 80 }));
  const mover = { x0: 50.3, y0: 47.1, vx: 1.6, vy: -0.9 };                  // px/yr (1.84 px/yr)
  const mjds = [60800, 60801.5, 60803, 60983, 60984.5, 60986, 61165, 61166.5, 61168];
  const passShift = [[0, 0], [0.8, -0.5], [-0.6, 0.7]];
  const build = (register) => {
    const jitter = () => (rng() - 0.5) * 0.1;
    const frames = mjds.map((mjd, k) => {
      const [sx, sy] = passShift[Math.floor(k / 3)];
      const years = (mjd - 60983) / 365.25;
      const sources = stars.map((s) => ({ x: s.x + sx + jitter(), y: s.y + sy + jitter(), snr: 30 }));
      sources.push({ x: mover.x0 + mover.vx * years + sx + jitter(), y: mover.y0 + mover.vy * years + sy + jitter(), snr: 30 });
      return { mjd, sources };
    });
    return findMovers(frames, { register });
  };
  const withReg = build(true), without = build(false);
  const speed = Math.hypot(mover.vx, mover.vy);
  check("without registration, whole-image shifts hide the mover", without.candidates.length === 0, `${without.candidates.length} candidate(s)`);
  check("with registration only the real mover remains", withReg.candidates.length === 1, `${withReg.candidates.length} candidate(s)`);
  check("... with about the right speed", withReg.candidates.length === 1 && Math.abs(withReg.candidates[0].speedPx / speed - 1) < 0.15,
    withReg.candidates[0] ? `${withReg.candidates[0].speedPx.toFixed(2)} px/yr, true ${speed.toFixed(2)}` : "none");
  const shifts = withReg.stats.shifts;
  check("the measured image shifts match the pointing errors (relative to the first pass)",
    shifts && Math.abs((shifts[3].dx - shifts[0].dx) - 0.8) < 0.1 && Math.abs((shifts[3].dy - shifts[0].dy) + 0.5) < 0.1, shifts ? JSON.stringify(shifts.slice(0, 4).map((s) => [+s.dx.toFixed(2), +s.dy.toFixed(2)])) : "none");
}

// ---------------------------------------------------------------- 3) the real mock, end to end
/**
 * The detector a user would blink: one with images from >= 3 survey passes. The mock mover is
 * a cold brown dwarf – invisible near 1 um, bright near 4 um – so we take the reddest such
 * detector (a dot that is not there cannot be tracked).
 */
function pickDetector(run) {
  const byDet = new Map();
  for (const o of run.obs) byDet.set(o.detector, [...(byDet.get(o.detector) || []), o]);
  const passes = (list) => 1 + list.slice(1).filter((o, i) => o.mjd - list[i].mjd >= 30).length;
  const usable = [...byDet.values()].filter((l) => l.length >= 3 && passes(l) >= 3);
  return usable.sort((a, b) => b[0].wlMin - a[0].wlMin)[0] ?? null;
}
{
  const rng = mulberry32(2026);
  let tested = 0, found = 0, extra = 0;
  for (let k = 0; k < 40; k++) {
    const ra = rng() * 360, dec = -60 + rng() * 120;
    const run = observe(ra, dec, 10);
    const best = pickDetector(run);
    if (!best) continue;
    tested++;
    const mid = (run.obs[0].mjd + run.obs.at(-1).mjd) / 2;
    const frames = best.map((o) => ({ mjd: o.mjd, grey: stretchAsinh(o.pixels) }));
    const { candidates } = findMoversInImages(frames, run.size);
    if (candidates.some((c) => isTrueMover(c, run.field, mid))) found++;
    extra += candidates.filter((c) => !isTrueMover(c, run.field, mid)).length;
  }
  // The misses are movers that blend with a bright star (see the limits at the top of movers.js).
  check("mock sky: the planted mover is found in >= 85 % of fields", found / tested >= 0.85, `${found}/${tested}`);
  check("mock sky: at most 2 false candidates in all those fields", extra <= 2, `${extra} false`);
}

// ---------------------------------------------------------------- 4) known catalogue objects
for (const id of ["barnard", "wise0855", "epsindb"]) {
  const t = TARGETS.find((x) => x.id === id);
  const p = positionAtEpoch(t, 2025.6);
  const run = observe(p.ra, p.dec, 10);
  const geo = { ra: p.ra, dec: p.dec, n: run.size, scaleArcsec: run.scale };
  const pm = Math.hypot(t.pmra, t.pmdec) / 1000;
  // Like a user, try every detector that has images from >= 3 survey passes; one match is enough.
  const byDet = new Map();
  for (const o of run.obs) byDet.set(o.detector, [...(byDet.get(o.detector) || []), o]);
  const passes = (list) => 1 + list.slice(1).filter((o, i) => o.mjd - list[i].mjd >= 30).length;
  const tried = [];
  let hit = null;
  for (const [det, list] of byDet) {
    if (list.length < 3 || passes(list) < 3) continue;
    const frames = list.map((o) => ({ mjd: o.mjd, grey: stretchAsinh(o.pixels) }));
    const { candidates } = findMoversInImages(frames, run.size);
    const m = candidates.map((c) => matchKnownObject(c, geo, TARGETS)).find(Boolean);
    tried.push(`${det}${m ? " found" : ""}(${list.length} img)`);
    if (m && !hit) hit = m;
  }
  const motion = (pm / run.scale) * 1.0;                       // about one year of observations
  const detail = `${pm.toFixed(1)}"/yr = ${motion.toFixed(2)} px/yr; tried ${tried.join(", ")}` +
    (hit ? `; matched ${hit.target.label} (${hit.distPx.toFixed(2)} px off)` : "; no match");
  if (motion >= 1.2) check(`re-discovers ${t.label}`, !!hit && hit.target.id === id, detail);
  else console.log(`INFO  ${t.label}: ${detail}  (moves less than ~1 px over the survey: too slow for this method, expected)`);
}

// ---------------------------------------------------------------- 5) describing a candidate, edge cases
{
  const geo = { ra: 100, dec: 20, n: 100, scaleArcsec: 6 };
  const right = describeMover({ x: 50, y: 50, vx: 2, vy: 0 }, geo);
  const up = describeMover({ x: 50, y: 50, vx: 0, vy: -2 }, geo);
  check("moving right on the image = moving west", right.compass === "W" && Math.abs(right.positionAngleDeg - 270) < 1e-6, `${right.compass} ${right.positionAngleDeg.toFixed(0)} deg`);
  check("moving up on the image = moving north", up.compass === "N" && Math.abs(up.positionAngleDeg) < 1e-6, `${up.compass} ${up.positionAngleDeg.toFixed(0)} deg`);
  check("speed in arcsec/yr = pixels/yr x scale", Math.abs(right.speedArcsecPerYear - 12) < 1e-9, `${right.speedArcsecPerYear} "/yr`);
  check("a candidate at the image centre sits at the field centre",
    Math.abs(right.ra - 100) < 1e-6 && Math.abs(right.dec - 20) < 1e-6, `RA ${right.ra.toFixed(5)} Dec ${right.dec.toFixed(5)}`);

  check("fewer than 3 images -> no candidates and a reason",
    findMovers([{ mjd: 1, sources: [] }, { mjd: 100, sources: [] }]).reason === "needs at least 3 images");
  check("images from only 2 survey passes -> a reason (two passes cannot prove a line)",
    findMovers([{ mjd: 0, sources: [] }, { mjd: 1, sources: [] }, { mjd: 200, sources: [] }]).reason?.includes("3 survey passes"));
  let threw = false;
  try { findMovers([{ mjd: 5, sources: [] }, { mjd: 1, sources: [] }, { mjd: 9, sources: [] }]); } catch { threw = true; }
  check("images out of time order are rejected", threw);
}

// ---------------------------------------------------------------- 6) few images: a line seen in only half of them is not enough
{
  // Real data (7 Nov 2026, Epsilon Indi B, detector D6): 6 images with ~9 dots each gave 3 FALSE candidates, each a line through
  // dots of just 3 of the 6 images (60-85 arcsec/yr). The default now asks for 60 % of the images (4 of 6).
  const mjds = [60800, 60802, 60983, 60985, 61168, 61170];
  const stars = [[10, 12], [40, 20], [22, 44], [35, 8], [5, 30], [45, 40], [28, 26], [15, 5]];
  const make = (visibleIn) => mjds.map((mjd, k) => {
    const years = (mjd - 60985) / 365.25;
    const sources = stars.map(([x, y]) => ({ x, y, snr: 20 }));
    if (visibleIn.includes(k)) sources.push({ x: 25 + 1.7 * years, y: 20 - 0.9 * years, snr: 20 });
    return { mjd, sources };
  });
  const three = make([0, 2, 4]), all = make([0, 1, 2, 3, 4, 5]), four = make([0, 1, 2, 4]);
  check("a line through dots of only 3 of 6 images is not reported by default", findMovers(three).candidates.length === 0);
  const relaxed = findMovers(three, { minDetectionFraction: 0.5, maxFalseAlarm: Infinity });
  check("... but it is when both rules are relaxed (half of the images, no false-alarm limit)", relaxed.candidates.length === 1);
  check("a real mover seen in all 6 images, or in 4 of 6, is reported", findMovers(all).candidates.length === 1 && findMovers(four).candidates.length === 1,
    `${findMovers(all).candidates.length} / ${findMovers(four).candidates.length}`);
  // the false-alarm number: expected chance lines like this one in the whole field
  const fa6 = findMovers(all).candidates[0].falseAlarm, fa4 = findMovers(four).candidates[0].falseAlarm, fa3 = relaxed.candidates[0].falseAlarm;
  check("false alarm: a line in all 6 images is far less likely by chance than one in 4, and 4 less than 3", fa6 < fa4 && fa4 < fa3 && fa6 < 1e-3, `${fa6.toExponential(1)} < ${fa4.toExponential(1)} < ${fa3.toExponential(1)}`);
  check("false alarm: the candidates are listed most-certain first", (() => {
    const two = findMovers([...all.map((f, k) => ({ mjd: f.mjd, sources: [...f.sources, { x: 5 + k * 6, y: 40 - k * 3, snr: 20 }] }))], { maxFalseAlarm: Infinity }).candidates;
    return two.length >= 1 && two.every((c, i) => i === 0 || two[i - 1].falseAlarm <= c.falseAlarm);
  })());
  check("false alarm: a limit of 1e-30 rejects everything and says how many it rejected", (() => {
    const r = findMovers(all, { maxFalseAlarm: 1e-30 });
    return r.candidates.length === 0 && r.stats.rejectedByFalseAlarm === 1;
  })());
}

// ---------------------------------------------------------------- 6a) several detectors: linked together AND each alone
{
  const stars = [[10, 12], [40, 20], [22, 44], [35, 8], [5, 30], [45, 40], [28, 26], [15, 5]];
  const pass = [60800, 60983, 61168];
  // frames of two detectors, interleaved by date; the mover (1.7, -0.9 px/yr) is seen only where `sees(detector, passIndex)` says so
  const build = (sees) => {
    const frames = [];
    pass.forEach((mjd0, p) => {
      for (const [d, off] of [["A", 0], ["B", 1.5]]) {
        const mjd = mjd0 + off, years = (mjd - 60985) / 365.25;
        const sources = stars.map(([x, y]) => ({ x, y, snr: 20 }));
        if (sees(d, p)) sources.push({ x: 25 + 1.7 * years, y: 20 - 0.9 * years, snr: 20 });
        frames.push({ mjd, detector: d, id: `${d}@${mjd}`, sources });
      }
    });
    return frames;
  };
  const run = (frames, opts = {}) => {
    // findMoversAcrossDetectors works from grey images; here we feed the dot lists through the same linking code instead
    const out = [];
    const sets = [{ name: "all detectors", list: frames }, ...["A", "B"].map((d) => ({ name: d, list: frames.filter((f) => f.detector === d) }))];
    for (const s of sets) { const r = findMovers(s.list.map(({ mjd, sources }) => ({ mjd, sources })), opts); out.push({ name: s.name, reason: r.reason, n: r.candidates.length }); }
    return out;
  };
  // the mover is seen by A in passes 0 and 1 and by B in passes 1 and 2: each detector has only 2 passes with it; together 4 of 6 images
  const gain = run(build((d, p) => (d === "A" ? p <= 1 : p >= 1)));
  check("two detectors that each see the mover in 2 passes: alone they find nothing, together they find it",
    gain.find((g) => g.name === "all detectors").n === 1 && gain.filter((g) => g.name !== "all detectors").every((g) => g.n === 0), JSON.stringify(gain));
  // a mover only A sees (e.g. a brown dwarf in the short bands): together it is in 3 of 6 images (too few); A alone finds it
  const only = run(build((d) => d === "A"));
  check("a mover that only one detector sees: all together is too few images, that detector alone finds it",
    only.find((g) => g.name === "all detectors").n === 0 && only.find((g) => g.name === "A").n === 1 && only.find((g) => g.name === "B").n === 0, JSON.stringify(only));
}

// ---------------------------------------------------------------- 6a2) findMoversAcrossDetectors itself (grey images in, merged list out)
{
  const n = 50, mjds = [[60800, "A"], [60801.5, "B"], [60983, "A"], [60984.5, "B"], [61168, "A"], [61169.5, "B"]];
  const stars = [[10, 12], [40, 20], [22, 44], [35, 8], [5, 30], [45, 40], [28, 26], [15, 5]];
  const image = (mjd, withMover) => {
    const img = new Float32Array(n * n);
    const rng = mulberry32(Math.round(mjd * 10));
    for (let i = 0; i < img.length; i++) img[i] = (rng() - 0.5) * 0.5;
    const star = (x, y, a) => { for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) { const dx = xx + 0.5 - x, dy = yy + 0.5 - y; img[yy * n + xx] += a * Math.exp(-(dx * dx + dy * dy) / (2 * 1.1 * 1.1)); } };
    for (const [x, y] of stars) star(x, y, 40);
    if (withMover) { const years = (mjd - 60985) / 365.25; star(25 + 1.7 * years, 20 - 0.9 * years, 40); }
    return img;
  };
  const frames = mjds.map(([mjd, detector]) => ({ mjd, detector, id: `${detector}@${mjd}`, grey: image(mjd, true), mask: null }));
  const r = findMoversAcrossDetectors(frames, n, { sigmaFloor: 1e-9 });
  check("across detectors: one candidate, found once although 'all detectors' and 'A alone' ... may both see it (deduplicated)", r.candidates.length === 1, `${r.candidates.length} candidate(s)`);
  check("across detectors: the candidate knows its images and where it was found", r.candidates[0].frameIds.length >= 3 && r.candidates[0].frameIds.every((id) => /^[AB]@/.test(id)) && typeof r.candidates[0].foundIn === "string", `${r.candidates[0].foundIn}, ${r.candidates[0].frameIds.length} images`);
  check("across detectors: it lists which sets were searched", JSON.stringify(r.stats.searchedSets) === JSON.stringify(["all detectors", "A", "B"]));
  const one = findMoversAcrossDetectors(frames.filter((f) => f.detector === "A"), n, { sigmaFloor: 1e-9 });
  check("a single detector: just that search (no 'all detectors' set)", JSON.stringify(one.stats.searchedSets) === JSON.stringify(["A"]) && one.candidates.length === 1);
  const few = findMoversAcrossDetectors(frames.slice(0, 2), n, { sigmaFloor: 1e-9 });
  check("too few images: no candidates and a reason", few.candidates.length === 0 && /3 images|survey passes/.test(few.reason ?? ""), few.reason);
}

// ---------------------------------------------------------------- 6a3) does the path hold up in every image? (apertureSnr, trackSupport)
{
  const n = 60;
  const image = (seed, stars) => {
    const rng = mulberry32(seed), img = new Float32Array(n * n);
    for (let i = 0; i < img.length; i++) img[i] = (rng() - 0.5) * 0.6;
    for (const [x, y, a] of stars) for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) { const dx = xx + 0.5 - x, dy = yy + 0.5 - y; img[yy * n + xx] += a * Math.exp(-(dx * dx + dy * dy) / (2 * 1.1 * 1.1)); }
    return img;
  };
  const one = apertureSnr(image(1, [[30, 30, 20]]), n, 30, 30);
  check("aperture: a star of height 20 over noise 0.17 is a huge S/N at its position, and about nothing 15 px away", one.snr > 100 && Math.abs(apertureSnr(image(1, [[30, 30, 20]]), n, 45, 30).snr) < 5, `${one.snr.toFixed(0)}`);
  check("aperture: near the edge or in a hole it gives null, not a made-up number", apertureSnr(image(1, []), n, 1, 1) === null && apertureSnr(new Float32Array(n * n).fill(NaN), n, 30, 30) === null);
  const bright = [[30.4, 20, 30]];                                         // a bright neighbour 8 px away must not inflate the noise (robust ring scatter)
  check("aperture: a bright neighbour in the ring does not hide the target", apertureSnr(image(2, [[30, 30, 8], [30, 37, 60]]), n, 30, 30).snr > 20);
  // a real mover (in every image) vs a chance line that only has dots in 3 of 6 images
  const path = (k) => ({ x: 20 + 4 * k, y: 30 });
  const real = Array.from({ length: 6 }, (_, k) => image(10 + k, [[path(k).x, path(k).y, 12]]));
  const chance = Array.from({ length: 6 }, (_, k) => image(20 + k, k % 2 ? [[path(k).x, path(k).y, 12]] : []));
  const sReal = trackSupport(real, n, real.map((_, k) => path(k))), sChance = trackSupport(chance, n, chance.map((_, k) => path(k)));
  check("support: a real mover is on its path in all 6 images", sReal.supported === 6 && sReal.measurable === 6 && sReal.fraction === 1, `${sReal.supported}/${sReal.measurable}`);
  check("support: a chance line with dots in 3 of 6 images is on its path in only 3", sChance.supported === 3 && sChance.fraction === 0.5, `${sChance.supported}/${sChance.measurable}`);
  const bad = trackSupport(real, n, real.map((_, k) => ({ x: path(k).x, y: 50 })));
  check("support: the same images measured at the wrong path give none", bad.supported === 0, `${bad.supported}`);
  const outside = trackSupport(real, n, real.map(() => ({ x: 1, y: 1 })));
  check("support: positions off the image are not counted as measured", outside.measurable === 0 && outside.fraction === 0);
  // faint in one image (a colour effect) but the others are strong: the faint one (still above S/N 5 and 10 % of the best) counts
  const faintOne = real.map((img, k) => (k === 2 ? image(30, [[path(2).x, path(2).y, 2.4]]) : img));
  check("support: one faint image (a colour effect) still counts as support when above both limits", trackSupport(faintOne, n, faintOne.map((_, k) => path(k))).supported === 6);
}

// ---------------------------------------------------------------- 6a4) a neighbour inside the measuring circle (blend warning)
{
  const path = (k) => ({ x: 20 + 4 * k, y: 30 });
  const own = (k) => ({ x: path(k).x + 0.2, y: path(k).y - 0.1 });                 // the candidate's own dot, 0.2 px from the prediction
  const none = blendWarning([0, 1, 2, 3].map(path), [0, 1, 2, 3].map((k) => [own(k), { x: 5, y: 5 }]));
  check("blend: the candidate's own dot is not a neighbour; a far star is not in range", none.blended === 0 && none.nearestPx === null && none.distances.every((d) => d > 2.5));
  const star = (k) => ({ x: path(k).x + 1.2, y: path(k).y });                      // a star 1.2 px (7") from the path, in every image
  const blended = blendWarning([0, 1, 2, 3].map(path), [0, 1, 2, 3].map((k) => [own(k), star(k)]));
  check("blend: a star 1.2 px (7 arcsec) from the path in every image is reported", blended.blended === 4 && Math.abs(blended.nearestPx - 1.2) < 0.05, JSON.stringify(blended));
  const some = blendWarning([0, 1, 2, 3].map(path), [0, 1, 2, 3].map((k) => (k >= 2 ? [own(k), star(k)] : [own(k)])));
  check("blend: counts only the images where the neighbour is there", some.blended === 2 && some.distances[0] === null);
  check("blend: a star 4 px away (24 arcsec) is outside the measuring circle", blendWarning([path(0)], [[{ x: path(0).x + 4, y: path(0).y }]]).blended === 0);
  check("blend: an image with no dots does not crash", blendWarning([path(0), path(1)], [[], undefined]).blended === 0);
}

// ---------------------------------------------------------------- 6b) binomial tail (the false-alarm arithmetic)
{
  check("binomial tail: P(X >= 1) for 4 trials at p = 0.1 is 1 - 0.9^4", Math.abs(binomialTail(4, 0.1, 1) - (1 - 0.9 ** 4)) < 1e-12);
  check("binomial tail: P(X >= 4) for 4 trials is p^4, with no rounding loss for tiny values", Math.abs(binomialTail(4, 0.02, 4) / 0.02 ** 4 - 1) < 1e-9);
  check("binomial tail: k <= 0 is certain, k > trials is impossible, p = 0 is impossible", binomialTail(5, 0.3, 0) === 1 && binomialTail(5, 0.3, 6) === 0 && binomialTail(5, 0, 1) === 0);
  check("binomial tail: P(X >= 2) for 10 trials at 0.5 is 1013/1024", Math.abs(binomialTail(10, 0.5, 2) - 1013 / 1024) < 1e-12);
}

// ---------------------------------------------------------------- 6c) a saturated star: fit on the good pixels (real Barnard's Star, detector D2)
{
  // A star of width 1.3 px whose core is flagged: those pixels hold garbage that differs from date to date (overflow). The plain
  // centroid follows the garbage; the fit on the unflagged pixels does not. Real data: 3.7 -> 0.3 arcsec/yr off the catalogue.
  const n = 60, trueX = 30.3, trueY = 25.7;
  const make = (seed, flagCore) => {
    const rng = mulberry32(seed);
    const img = new Float32Array(n * n), mask = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const ex = x + 0.5 - trueX, ey = y + 0.5 - trueY;
      img[y * n + x] = 1000 * Math.exp(-(ex * ex + ey * ey) / (2 * 1.3 * 1.3)) + (rng() - 0.5) * 0.4;
      if (flagCore && ex * ex + ey * ey <= 2.6 * 2.6) { mask[y * n + x] = 1; img[y * n + x] = rng() * 700; }       // overflow: garbage
    }
    return { img, mask };
  };
  let plainErr = 0, maskedErr = 0, uncompromisedDiff = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { img, mask } = make(seed, true);
    const plain = detectSources(img, n, { sigmaFloor: 1e-9 }).find((s) => Math.hypot(s.x - trueX, s.y - trueY) < 4);
    const fitted = detectSources(img, n, { sigmaFloor: 1e-9, mask }).find((s) => Math.hypot(s.x - trueX, s.y - trueY) < 4);
    plainErr += Math.hypot(plain.x - trueX, plain.y - trueY) / 6;
    maskedErr += Math.hypot(fitted.x - trueX, fitted.y - trueY) / 6;
    const clean = make(seed, false);
    clean.mask[(25) * n + 30] = 1;                                                   // ONE flagged pixel in the core: not compromised
    const a = detectSources(clean.img, n, { sigmaFloor: 1e-9 }).find((s) => Math.hypot(s.x - trueX, s.y - trueY) < 4);
    const b = detectSources(clean.img, n, { sigmaFloor: 1e-9, mask: clean.mask }).find((s) => Math.hypot(s.x - trueX, s.y - trueY) < 4);
    uncompromisedDiff = Math.max(uncompromisedDiff, Math.hypot(a.x - b.x, a.y - b.y));
  }
  check("saturated star with garbage in the flagged core: the plain centroid is off by more than 0.2 px", plainErr > 0.2, `${plainErr.toFixed(2)} px`);
  check("... the fit on the good pixels is within 0.05 px of the truth", maskedErr < 0.05, `${maskedErr.toFixed(3)} px`);
  check("a star with a single flagged core pixel keeps the plain centroid (a fixed-width Gaussian is not the real PSF)", uncompromisedDiff === 0, `${uncompromisedDiff}`);
  check("no mask given: nothing changes (same positions as before)", (() => {
    const { img } = make(9, false);
    const a = detectSources(img, n, { sigmaFloor: 1e-9 }), b = detectSources(img, n, { sigmaFloor: 1e-9, mask: null });
    return JSON.stringify(a) === JSON.stringify(b);
  })());
}

// ---------------------------------------------------------------- 6a4) the aperture is not rejected for a pixelisation accident (7 Nov 2026, found by the discovery tests)
{
  const N = 64, img = new Float32Array(N * N);
  for (let i = 0; i < img.length; i++) img[i] = 0.1 * Math.sin(i * 12.9898);            // a little structure, no holes
  // for some positions on the pixel grid only 10 pixel centres fall inside a circle of radius 2 (it is 9 to 13 in general), which is
  // below the old limit of 0.8 pi r^2 = 10.05: a complete aperture was rejected as 'holes' (1.2 % of random positions)
  const centres = (x, y) => { let c = 0; for (let j = 20; j < 40; j++) for (let i = 20; i < 40; i++) if (Math.hypot(i + 0.5 - x, j + 0.5 - y) <= 2) c++; return c; };
  const tenCentres = [];
  for (let fx = 0; fx < 1; fx += 0.02) for (let fy = 0; fy < 1; fy += 0.02) if (centres(30 + fx, 30 + fy) === 10) tenCentres.push([30 + fx, 30 + fy]);
  check("positions with only 10 pixel centres in the circle (the case that was rejected) exist and are all measurable",
    tenCentres.length > 10 && tenCentres.every(([x, y]) => apertureSnr(img, N, x, y, 2) !== null), `${tenCentres.length} of 2500 phases`);
  const holey = Float32Array.from(img);
  for (let j = 29; j <= 31; j++) for (let i = 29; i <= 32; i++) holey[j * N + i] = NaN;
  check("an aperture with real holes (a third of its pixels without data) is still not measurable", apertureSnr(holey, N, 30.5, 30.5, 2) === null);
  const few = Float32Array.from(img); few[30 * N + 30] = NaN;
  check("one missing pixel in the aperture does not stop the measurement", apertureSnr(few, N, 30.5, 30.5, 2) !== null);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
