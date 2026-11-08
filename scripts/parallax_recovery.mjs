// Inject hypothetical sources into real, registered backend cutouts; run the production blind search.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { detectSources, registerShifts, apertureSnr } from "../frontend/js/features/movers.js";
import { parallaxOffsetArcsec, findDistantMovers } from "../frontend/js/features/parallax.js";
import { loadField, mulberry32, parseArgs, dihedral, wrapShift, wilson } from "../scratch/lib_real.mjs";

const args = parseArgs();
const numeric = (name, fallback) => {
  const v = Number(args[name] ?? fallback);
  if (!Number.isFinite(v)) throw new Error(`Invalid --${name}`);
  return v;
};
const grid = (name, fallback) => {
  const list = (args[name] ?? fallback).split(",").map(Number);
  if (!list.every(v => v > 0 && Number.isFinite(v))) throw new Error(`Expected positive --${name} values`);
  return list;
};
const fluxes = grid("flux-mjy", "0.3,1,4");
const distances = grid("distance-au", "800,1600,3200");
const trials = numeric("trials", 4), seed = numeric("seed", 7301);
const nulls = numeric("nulls", 4), sigma = numeric("psf-sigma-px", 0.6);
const ra = numeric("ra", 269.4462), dec = numeric("dec", 4.769), det = args.det ?? "D2";
const fov = numeric("fov", 12), muEast = numeric("mu-east", 8), muNorth = numeric("mu-north", -3);
if (![trials, nulls].every(v => Number.isInteger(v) && v >= 1) || sigma <= 0 || !Number.isInteger(seed)) {
  throw new Error("Expected positive trial counts, positive PSF width, and integer seed");
}
if (!args.provenance) throw new Error("Supply --provenance describing the actual input archive and release");
const { frames, arrays, masks, n, scale, geo } = await loadField(args.api ?? "http://127.0.0.1:8001", ra, dec, fov, det);
if (frames.length < 3 || frames.some((f, i) => f.detector !== det || f.pixelScaleArcsec !== scale ||
    arrays[i].length !== n * n || masks[i]?.length !== n * n)) {
  throw new Error("Expected co-registered float cutouts with masks for one detector");
}
const detect = (images, flags) => images.map((image, k) => ({
  mjd: frames[k].mjd, sources: detectSources(image, n, { sigmaFloor: 1e-9, mask: flags[k] }),
}));
const search = (detected) => {
  const result = findDistantMovers(detected, geo);
  if (result.reason || result.stats.truncated) throw new Error(result.reason || "Search truncated; no rates reported");
  return result.candidates;
};
const base = detect(arrays, masks);
const originalCandidates = search(base).length;
const shifts = registerShifts(base);
const rng = mulberry32(seed);
const origins = Array.from({ length: trials }, () => ({ x: n * (0.25 + rng() / 2), y: n * (0.25 + rng() / 2) }));
const ref = (frames[0].mjd + frames.at(-1).mjd) / 2;
const mjyPerPixelSum = 1e9 * (scale / 206264.806) ** 2;
const median = list => {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};

// Integrate a Gaussian over each square pixel using its normal CDF (Abramowitz & Stegun 7.1.26).
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return Math.sign(x) * (1 - poly * Math.exp(-x * x));
}
function inject(image, x, y, total) {
  const copy = image.slice();
  const share = (i, c) => (erf((i + 1 - c) / (Math.SQRT2 * sigma)) - erf((i - c) / (Math.SQRT2 * sigma))) / 2;
  const radius = Math.ceil(6 * sigma);
  for (let j = Math.max(0, Math.floor(y) - radius); j <= Math.min(n - 1, Math.floor(y) + radius); j++) {
    for (let i = Math.max(0, Math.floor(x) - radius); i <= Math.min(n - 1, Math.floor(x) + radius); i++) {
      copy[j * n + i] += total * share(i, x) * share(j, y);
    }
  }
  return copy;
}

const cells = [];
for (const distanceAU of distances) {
  for (const fluxMjy of fluxes) {
    let recovered = 0, unmatched = 0;
    const snrs = [];
    const outcomes = [];
    for (const origin of origins) {
      const truth = frames.map((f, i) => {
        const p = parallaxOffsetArcsec(ra, dec, f.mjd, ref, distanceAU), years = (f.mjd - ref) / 365.25;
        return { x: origin.x - (p.east + muEast * years) / scale + shifts[i].dx,
          y: origin.y - (p.north + muNorth * years) / scale + shifts[i].dy };
      });
      const images = arrays.map((a, i) => {
        const { x, y } = truth[i];
        const image = inject(a, x, y, fluxMjy / mjyPerPixelSum);
        const before = apertureSnr(a, n, x, y), after = apertureSnr(image, n, x, y);
        if (before && after) snrs.push((after.flux - before.flux) / before.err);
        return image;
      });
      const candidates = search(detect(images, masks));
      // Match associated detections to the injection after undoing the search's registration.
      const matches = candidates.filter(c => c.points.every(p => {
        const i = p.frame;
        return Math.hypot(p.x + c.registration[i].dx - truth[i].x, p.y + c.registration[i].dy - truth[i].y) <= 2;
      }));
      if (matches.length) recovered++;
      unmatched += candidates.length - matches.length;
      outcomes.push({ origin, fittedAU: matches.map(c => c.distanceAU), candidates: candidates.length });
    }
    cells.push({ distanceAU, fluxMjy, trials, recovered, fraction: recovered / trials,
      interval95: wilson(recovered, trials), medianInjectedApertureSnr: median(snrs), unmatched, outcomes });
    console.error(`${distanceAU} AU, ${fluxMjy} mJy: ${recovered}/${trials}`);
  }
}
const controlCounts = [];
for (let j = 0; j < nulls; j++) {
  const transforms = frames.map(() => [Math.floor(rng() * 8), Math.floor(rng() * n), Math.floor(rng() * n)]);
  const scramble = (image, k) => {
    const [sym, dx, dy] = transforms[k];
    return wrapShift(dihedral(image, n, sym), n, dx, dy);
  };
  controlCounts.push(search(detect(arrays.map(scramble), masks.map(scramble))).length);
}
const digest = array => createHash("sha256").update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest("hex");
const report = {
  experiment: "Synthetic parallax source injections into observed backgrounds",
  generated: new Date().toISOString(), provenance: args.provenance, ra, dec, det, fov, scale, n,
  seed, trials, nulls, psfSigmaPx: sigma, muEast, muNorth, refMjd: ref, originalCandidates,
  frames: frames.map((f, k) => ({ mjd: f.mjd, dateISO: f.dateISO, detector: f.detector,
    pixelsSha256: digest(arrays[k]), maskSha256: digest(masks[k]) })),
  cells, controlCounts, controlFalsePositiveFieldFraction: controlCounts.filter(c => c > 0).length / nulls,
};
const json = JSON.stringify(report, null, 2) + "\n";
if (args.out) await writeFile(args.out, json);
else process.stdout.write(json);
