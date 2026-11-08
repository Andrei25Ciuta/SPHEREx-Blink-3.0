// discovery.js – "see everything in this field": every source the images show, vetted, checked against the catalogues and ranked.
//
//   1. dots          detectSources() in every image (movers.js), the images registered on the field stars
//   2. candidates    static sources (a dot at the same place in 3+ images), movers (movers.js, straight line), distant bodies
//                    (parallax.js, optional) and known asteroids caught in single images (SkyBoT)
//   3. measure       a 2-pixel aperture at the candidate's place in EVERY image, with the wavelength of that image: its spectrum
//   4. vet           vetting.js: edge, halo of a bright star, flagged pixels, blend, scatter, few detections
//   5. cross-match   crossmatch.js: SIMBAD / Gaia (proper motion carried to the image date), 2MASS / AllWISE (the candidate carried
//                    back to their date), SkyBoT (the body's place in each image)
//   6. class + score "known", "known and moving", "Solar System body", "possible artefact", "unknown" (needs checking when its
//                    support score reaches NEEDS_CHECKING_SCORE) and "weak"
// Nothing here is a discovery: an "unknown" candidate is a lead with its evidence, to be checked by a person (the dossier says how).
// Pure functions (no DOM, no network): images, catalogues and SkyBoT lists are passed in. Real-data check: docs/VALIDATION.md §14.

import { detectSources, registerShifts, passIndices, apertureSnr, moverPositionAtMjd, findMoversAcrossDetectors, describeMover } from "./movers.js";
import { canvasToSky, skyToCanvas } from "../geometry.js";
import { colourHint } from "./spectrum.js";
import { vetCandidate, looksLikeArtefact, supportScore, FLAGS as FLAGS_TEXT } from "./vetting.js";
import { matchCandidate, matchBodies, checkedDeep, MIN_USEFUL_PM } from "./crossmatch.js";

export const VERSION = "discovery-2";
export const NEEDS_CHECKING_SCORE = 65;             // support score from which an unknown candidate "needs checking": about 1 false one per 20 empty fields of the real ones tried (VALIDATION.md §14)
const STATIC_RADIUS_PX = 1.2;
const MIN_DETECTIONS = 3;
const APERTURE_PX = 2;
export const MIN_PERSISTENCE = 0.3;                        // an "unknown" source must be at its place (3 sigma) in at least this share of the images of its passes
const PRESENT_SNR = 3;                              // an image "shows" the source when the flux in its aperture is at least this many sigma
const DAYS_PER_YEAR = 365.25;
const ASTROMETRIC_FLOOR_ARCSEC = 1;                 // the Arosa test: 1.0 arcsec between the image and the ephemeris

/** The numbers Find everything runs with, for provenance.js (a result says what it was run with). Each is the constant above, not a copy. */
export const SETTINGS = {
  needsCheckingScore: NEEDS_CHECKING_SCORE, minPersistence: MIN_PERSISTENCE, minDetections: MIN_DETECTIONS, staticRadiusPx: STATIC_RADIUS_PX,
  aperturePx: APERTURE_PX, presentSnr: PRESENT_SNR, astrometricFloorArcsec: ASTROMETRIC_FLOOR_ARCSEC,
};

export const CLASSES = {
  "solar-system": "Known Solar System body",
  "catalogued-moving": "In a catalogue, and moving",
  catalogued: "In a catalogue",
  unchecked: "Not checked against catalogues",
  artefact: "Possible artefact",
  unknown: "Unknown: needs checking",
  "unknown-weak": "Unknown, weakly supported",
};
const CLASS_ORDER = ["unknown", "unchecked", "unknown-weak", "artefact", "catalogued-moving", "solar-system", "catalogued"];

const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };

// ------------------------------------------------------------------ static sources

/**
 * Group dots of different images that lie within radiusPx of each other (positions already registered).
 * dots: [[{ x, y, snr }]] per image. Returns [{ x, y, members: [{ frame, x, y, snr }] }] with at least minDetections members,
 * at most one member per image; the brightest dots are placed first.
 */
export function linkStaticSources(dots, { radiusPx = STATIC_RADIUS_PX, minDetections = MIN_DETECTIONS } = {}) {
  const all = [];
  dots.forEach((list, frame) => list.forEach((d) => all.push({ frame, x: d.x, y: d.y, snr: d.snr ?? 0 })));
  all.sort((a, b) => b.snr - a.snr);
  const CELL = 4, key = (cx, cy) => cx * 100003 + cy;
  const clusters = [], grid = new Map();
  for (const d of all) {
    let best = null, bestDist = radiusPx;
    const cx = Math.floor(d.x / CELL), cy = Math.floor(d.y / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const c of grid.get(key(cx + i, cy + j)) ?? []) {
        const dist = Math.hypot(c.x - d.x, c.y - d.y);
        if (dist <= bestDist && !c.frames.has(d.frame)) { best = c; bestDist = dist; }
      }
    }
    if (best) {
      best.members.push(d); best.frames.add(d.frame);
      best.x = best.members.reduce((s, m) => s + m.x, 0) / best.members.length;
      best.y = best.members.reduce((s, m) => s + m.y, 0) / best.members.length;
    } else {
      const c = { x: d.x, y: d.y, members: [d], frames: new Set([d.frame]) };
      clusters.push(c);
      const k = key(cx, cy);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c);
    }
  }
  return clusters.filter((c) => c.members.length >= minDetections).map(({ x, y, members }) => ({ x, y, members }));
}

/**
 * Straight-line fit of a candidate's dots: position at the mean date, motion (px/yr) and its uncertainty, rms about the fit.
 * With less than 0.3 year between the first and the last dot the motion is not constrained (vx = vy = 0, vErr = Infinity).
 */
export function fitTrack(members, mjds, minBaselineYears = 0.3) {
  const m = members.length;
  const t = members.map((d) => mjds[d.frame] / DAYS_PER_YEAR);
  const tm = t.reduce((s, v) => s + v, 0) / m, xm = members.reduce((s, d) => s + d.x, 0) / m, ym = members.reduce((s, d) => s + d.y, 0) / m;
  let sxx = 0, sxt = 0, syt = 0;
  members.forEach((d, i) => { const dt = t[i] - tm; sxx += dt * dt; sxt += dt * (d.x - xm); syt += dt * (d.y - ym); });
  const baseline = Math.max(...t) - Math.min(...t);
  const constrained = baseline >= minBaselineYears && sxx > 1e-9;
  const vx = constrained ? sxt / sxx : 0, vy = constrained ? syt / sxx : 0;
  let ss = 0;
  members.forEach((d, i) => { const dt = t[i] - tm; ss += (d.x - xm - vx * dt) ** 2 + (d.y - ym - vy * dt) ** 2; });
  const rms = Math.sqrt(ss / (2 * Math.max(1, m - (constrained ? 2 : 1))));
  const sigmaPos = Math.max(rms, 0.15);
  return { x: xm, y: ym, vx, vy, mjd: tm * DAYS_PER_YEAR, rms, baselineYears: baseline, vErr: constrained ? sigmaPos / Math.sqrt(sxx) : Infinity, sigmaPos };
}

// ------------------------------------------------------------------ measuring

/** Aperture flux of one image at (x, y) (pixels of that image): { snr, flux, err, flagged } or null when it cannot be measured there. */
function measureAt(frame, n, x, y) {
  const ap = apertureSnr(frame.grey, n, x, y, APERTURE_PX);
  if (!ap) return null;
  let bad = 0, inside = 0;
  if (frame.mask) {
    for (let j = Math.floor(y - APERTURE_PX); j <= Math.ceil(y + APERTURE_PX); j++) for (let i = Math.floor(x - APERTURE_PX); i <= Math.ceil(x + APERTURE_PX); i++) {
      if (i < 0 || j < 0 || i >= n || j >= n || Math.hypot(i + 0.5 - x, j + 0.5 - y) > APERTURE_PX) continue;
      inside++; if (frame.mask[j * n + i]) bad++;
    }
  }
  return { ...ap, flagged: inside > 0 && bad / inside > 0.2 };
}

/** The spectrum of a candidate: one point per image, at the candidate's place on that image. */
function photometry(frames, n, rawPositions, geo, isFloat) {
  const omega = (geo.scaleArcsec / 206264.806) ** 2;                          // sr per pixel
  return frames.map((f, k) => {
    const p = rawPositions[k];
    const m = p ? measureAt(f, n, p.x, p.y) : null;
    const point = { frameId: f.id, frame: k, mjd: f.mjd, wavelengthUm: f.wavelengthUm ?? null, detector: f.detector ?? null, measured: Boolean(m), x: p?.x ?? null, y: p?.y ?? null };
    if (!m) return { ...point, snr: null, flux: null, fluxErr: null, fluxJy: null, fluxMilliJy: null, flagged: false };
    return {
      ...point, snr: m.snr, flux: m.flux, fluxErr: m.err, flagged: m.flagged,
      // real pixels are in MJy/sr: x solid angle of a pixel x 1e6 gives Jansky (the backend does the same); synthetic pixels have no unit
      fluxJy: isFloat ? m.flux * omega * 1e6 : null, fluxMilliJy: isFloat ? m.flux * omega * 1e9 : null,
    };
  });
}

/** A small piece of an image around (x, y), as numbers, for showing the evidence (the page draws it). */
export function stampFor(frame, n, x, y, half = 12) {
  const size = 2 * half, values = new Float32Array(size * size);
  const x0 = Math.round(x) - half, y0 = Math.round(y) - half;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const xx = x0 + i, yy = y0 + j;
    values[j * size + i] = xx >= 0 && yy >= 0 && xx < n && yy < n ? frame.grey[yy * n + xx] : NaN;
  }
  return { frameId: frame.id, mjd: frame.mjd, wavelengthUm: frame.wavelengthUm ?? null, size, x0, y0, values };
}

/**
 * Is a moving candidate just part of a fixed source? Yes if the fixed source has at least as many detections and, in at least 3/4 of the
 * images where the mover has a dot, that dot lies within radiusPx of where the fixed source is in that image.
 */
export function isShadowOf(mover, fixed, radiusPx = 1.5) {
  if (fixed.nDet < mover.nDet) return false;
  const dots = mover.detections.filter((d) => fixed.rawPositions[d.frame]);
  if (dots.length < mover.detections.length) return false;
  const near = dots.filter((d) => Math.hypot(d.x - fixed.rawPositions[d.frame].x, d.y - fixed.rawPositions[d.frame].y) <= radiusPx).length;
  return near >= Math.ceil(0.75 * dots.length);
}

// ------------------------------------------------------------------ the pipeline

const slug = (kind, ra, dec) => `SPX-${kind[0].toUpperCase()}-${ra.toFixed(4)}${dec >= 0 ? "+" : "-"}${Math.abs(dec).toFixed(4)}`;

function nearestSnr(list, x, y) {
  let best = null, bd = 2;
  for (const d of list ?? []) { const r = Math.hypot(d.x - x, d.y - y); if (r < bd) { bd = r; best = d; } }
  return best?.snr ?? 0;
}

/**
 * Find, vet and classify everything the images show.
 * frames: [{ id, mjd, detector, wavelengthUm, grey, mask }] in time order; n: image size (square); geo: { ra, dec, n, scaleArcsec }.
 * isFloat: real pixels in MJy/sr (a noise floor of 1e-9 is used and fluxes are in Jansky); false for the 8-bit synthetic pictures.
 * catalogues: { simbad, gaia, "2mass", allwise } normalised lists (crossmatch.js normaliseCatalogue); a missing key = not checked.
 * skybot: [[body]] one list per image (skybot.js) or null.
 * movers / distant: results of findMoversAcrossDetectors / findDistantMovers if the caller has them already (else movers are searched here).
 * options: { dots (precomputed), needsChecking, minDetections, staticRadiusPx, skipMovers }.
 */
export function discover({ frames, n, geo, isFloat = true, catalogues = {}, skybot = null, movers = null, distant = null, options = {} }) {
  const N = frames.length;
  const mjds = frames.map((f) => f.mjd);
  const dots = options.dots ?? frames.map((f) => detectSources(f.grey, n, { ...(isFloat ? { sigmaFloor: 1e-9 } : {}), mask: f.mask ?? null }));
  const stats = { frames: N, dotsPerFrame: dots.map((d) => d.length), passes: N ? passIndices(mjds).at(-1) + 1 : 0, staticSources: 0, movers: 0, distant: 0, asteroids: 0 };
  if (N < 3) return { candidates: [], summary: summarise([], stats, catalogues), stats, reason: "needs at least 3 images", dots, shifts: [] };

  // registration: every exposure has its own small pointing error; the field stars all shift together
  const reg = registerShifts(dots.map((s, k) => ({ mjd: mjds[k], sources: s })));
  const shifts = reg.map((s) => (Math.abs(s.dx) > 0.05 || Math.abs(s.dy) > 0.05 ? s : { dx: 0, dy: 0 }));
  const corrected = dots.map((list, k) => list.map((d) => ({ ...d, x: d.x - shifts[k].dx, y: d.y - shifts[k].dy })));
  const passOf = passIndices(mjds);
  const nPasses = stats.passes;
  const index = new Map(frames.map((f, k) => [f.id, k]));

  const candidates = [];
  const add = (c) => candidates.push(c);

  // ---------------------------------------------------------------- inner helpers (they use the data above)

  function buildCandidate({ kind, sky, epochMjd, motion, detections, rmsPx, falseAlarm, significance, rawPositions, skyAt, extra }) {
    const framesWith = [...new Set(detections.map((d) => d.frame))].sort((a, b) => a - b);
    const passes = new Set(framesWith.map((g) => passOf[g])).size;
    const phot = photometry(frames, n, rawPositions, geo, isFloat);
    const medianSnr = median(detections.map((d) => d.snr ?? 0));
    const posErrArcsec = Math.hypot(ASTROMETRIC_FLOOR_ARCSEC, (Math.max(rmsPx, 0.15) / Math.sqrt(Math.max(1, detections.length))) * geo.scaleArcsec);
    const flags = vetCandidate({ detections, dotsPerFrame: dots, masks: frames.map((f) => f.mask ?? null), n, nPasses, passes, rmsPx });
    const c = {
      id: slug(kind, sky.ra, sky.dec), kind, ra: sky.ra, dec: sky.dec, epochMjd, posErrArcsec,
      pmEast: motion?.pmEast ?? null, pmNorth: motion?.pmNorth ?? null, pmErr: motion?.pmErr ?? null,
      nDet: detections.length, nFrames: N, frames: framesWith, passes, nPasses, medianSnr, rmsPx, falseAlarm, significance,
      detections, rawPositions, photometry: phot, flags, tags: [], ...extra,
    };
    c.motionIsReal = Boolean(motion && Math.hypot(motion.pmEast, motion.pmNorth) >= Math.max(MIN_USEFUL_PM, 3 * (motion.pmErr ?? 0)));
    c._skyAt = skyAt;
    return c;
  }

  function finish(c, thresholdScore) {
    // spectrum and colour
    const usable = c.photometry.filter((p) => p.measured);
    c.colour = isFloat && usable.length ? colourHint(usable) : null;
    if (c.colour?.kind === "very-red" || c.colour?.kind === "red") c.tags.push(c.colour.kind);
    if (c.motionIsReal) c.tags.push("moving");
    if (c.kind === "distant") c.tags.push("distant");
    // one-pass sources: is it absent in the other passes, where it should be seen?
    if (c.kind === "static" && c.passes === 1 && nPasses >= 2) {
      const detPass = passOf[c.frames[0]];
      const own = c.photometry.filter((p) => c.frames.includes(p.frame) && p.measured && p.snr !== null).map((p) => p.snr);
      const other = c.photometry.filter((p) => passOf[p.frame] !== detPass && p.measured && !p.flagged && p.snr !== null).map((p) => p.snr);
      if (own.length && other.length >= 3 && median(own) >= 8 && median(other) < 2) {
        c.tags.push("transient");
        c.flags.push({ code: "appears-in-one-pass", severity: "info", text: `Seen in ${c.frames.length} images of one survey pass (median S/N ${median(own).toFixed(0)}) and absent in ${other.length} images of the other passes (median S/N ${median(other).toFixed(1)}). Assuming a flat spectrum, it should have been visible there: a transient, a fast mover seen only once, or an artefact. The spectrum of a star changes with wavelength, so check the images before believing it.` });
      }
    }
    // catalogues
    const at = { ra: c.ra, dec: c.dec, epochMjd: c.epochMjd, pmEast: c.pmEast, pmNorth: c.pmNorth, pmErr: c.pmErr, posErrArcsec: c.posErrArcsec };
    c.catalogue = c.kind === "asteroid" ? { matches: [], checked: [], notChecked: [] } : matchCandidate(at, catalogues);
    // A body explains a candidate only if it is at the candidate's place in at least 2 images and in half of the images where the candidate
    // was seen: a star seen in 9 images is not an asteroid that happened to pass 15 arcsec away in one of them (an asteroid crosses a field in hours).
    const bodyHit = skybot ? matchBodies(frames.map((f, g) => (c.rawPositions[g] && c.frames.includes(g) ? c._skyAt(g) : null)), skybot) : null;
    c.body = c.forcedBody ?? (bodyHit && bodyHit.hits >= Math.max(2, Math.ceil(c.nDet / 2)) ? bodyHit : null);
    c.trackSky = c.frames.map((g) => ({ frame: g, mjd: mjds[g], ...(c._skyAt(g) ?? {}) })).filter((p) => Number.isFinite(p.ra));   // where it was on the date of each image it was seen in
    delete c._skyAt;
    // persistence: of the images of the survey passes where it was detected, how many show it (3 sigma in the aperture) at its place?
    {
      const detectedPasses = new Set(c.frames.map((g) => passOf[g]));
      const looked = c.photometry.filter((p) => detectedPasses.has(passOf[p.frame]) && p.measured && !p.flagged && p.snr !== null);
      const present = looked.filter((p) => p.snr >= PRESENT_SNR).length;
      c.persistence = c.kind === "asteroid" ? { images: looked.length, present, fraction: 1 } : { images: looked.length, present, fraction: looked.length ? present / looked.length : 0 };
    }
    // a catalogue star sits there but moves differently from what was measured: a chance line through a fixed star, not a known mover
    const mismatch = !c.body && c.catalogue.matches.length > 0 && c.catalogue.matches.every((m) => m.pmConsistent === false);
    if (mismatch) c.flags.push({ code: "motion-disagrees", severity: "warn", text: `${FLAGS_TEXT["motion-disagrees"]} (measured ${Math.hypot(c.pmEast, c.pmNorth).toFixed(1)}″/yr, catalogue ${c.catalogue.matches[0].pm.toFixed(2)}″/yr.)` });
    // class and score
    const s = supportScore(c, c.flags);
    c.support = s.score; c.supportParts = s.parts; c.supportPenalties = s.penalties;
    const artefact = looksLikeArtefact(c.flags);
    if (c.body) c.class = "solar-system";
    else if (mismatch) c.class = "artefact";
    else if (c.catalogue.matches.length) c.class = c.motionIsReal ? "catalogued-moving" : "catalogued";
    else if (!checkedDeep(c.catalogue)) c.class = "unchecked";        // no deep catalogue (Gaia, 2MASS, AllWISE) checked it completely: "new" cannot be said
    else if (artefact) c.class = "artefact";
    else c.class = c.support >= thresholdScore && c.persistence.fraction >= MIN_PERSISTENCE ? "unknown" : "unknown-weak";
    c.classLabel = CLASSES[c.class];
    c.needsChecking = c.class === "unknown";
  }

  // --- movers (straight lines): the ones movers.js finds, from all images (both detectors linked together when there are two)
  let moverResult = movers;
  if (!moverResult && !options.skipMovers) {
    moverResult = findMoversAcrossDetectors(frames.map((f) => ({ mjd: f.mjd, detector: f.detector ?? "D", id: f.id, grey: f.grey, mask: f.mask })), n, isFloat ? { sigmaFloor: 1e-9 } : {});
  }
  const moverPointsRaw = new Set();                                                   // raw dots used by a mover: not static sources
  for (const c of moverResult?.candidates ?? []) {
    const ids = c.frameIds ?? frames.map((f) => f.id);
    const raw = c.points.map((p) => ({ frame: index.get(ids[p.frame]), x: p.x + (c.shifts?.[p.frame]?.dx ?? 0), y: p.y + (c.shifts?.[p.frame]?.dy ?? 0) }));
    raw.forEach((p) => moverPointsRaw.add(`${p.frame}:${Math.round(p.x)}:${Math.round(p.y)}`));
    const d = describeMover(c, geo);
    const rawPositions = frames.map((f) => {
      const j = ids.indexOf(f.id);
      if (j < 0) return null;
      const q = moverPositionAtMjd(c, f.mjd), sh = c.shifts?.[j] ?? { dx: 0, dy: 0 };
      return { x: q.x + sh.dx, y: q.y + sh.dy };
    });
    add(buildCandidate({
      kind: "mover", sky: { ra: d.ra, dec: d.dec }, epochMjd: c.mjdRef,
      motion: { pmEast: d.pmEastArcsecPerYear, pmNorth: d.pmNorthArcsecPerYear, pmErr: d.speedArcsecPerYear / Math.max(c.significance, 1e-6) },
      detections: raw.map((p) => ({ ...p, snr: nearestSnr(dots[p.frame], p.x, p.y) })), rmsPx: c.rms, falseAlarm: c.falseAlarm, significance: c.significance, rawPositions,
      skyAt: (g) => (rawPositions[g] ? canvasToSky(rawPositions[g].x / n, rawPositions[g].y / n, geo) : null), extra: { foundIn: c.foundIn ?? null },
    }));
    stats.movers++;
  }

  // --- distant bodies (parallax), if the caller searched for them
  for (const c of distant?.candidates ?? []) {
    const ids = c.frameIds ?? frames.map((f) => f.id);
    const raw = c.points.map((p) => ({ frame: index.get(ids[p.frame]), x: p.x + (c.shifts?.[p.frame]?.dx ?? 0), y: p.y + (c.shifts?.[p.frame]?.dy ?? 0) }));
    const rawPositions = frames.map((f) => {
      const j = ids.indexOf(f.id);
      if (j < 0) return null;
      const q = moverPositionAtMjd(c, f.mjd), sh = c.shifts?.[j] ?? { dx: 0, dy: 0 };
      return { x: q.x + sh.dx, y: q.y + sh.dy };
    });
    add(buildCandidate({
      kind: "distant", sky: canvasToSky(c.x / n, c.y / n, geo), epochMjd: c.mjdRef, motion: null,
      detections: raw.map((p) => ({ ...p, snr: nearestSnr(dots[p.frame], p.x, p.y) })), rmsPx: c.rms, falseAlarm: null, significance: c.parallaxSigma, rawPositions,
      skyAt: (g) => (rawPositions[g] ? canvasToSky(rawPositions[g].x / n, rawPositions[g].y / n, geo) : null),
      extra: { distanceAU: c.distanceAU, distanceRangeAU: c.distanceRangeAU },
    }));
    stats.distant++;
  }

  // --- static sources: the same dot in 3+ images
  const clusters = linkStaticSources(corrected, { radiusPx: options.staticRadiusPx ?? STATIC_RADIUS_PX, minDetections: options.minDetections ?? MIN_DETECTIONS });
  for (const cl of clusters) {
    const usedByMover = cl.members.filter((m) => moverPointsRaw.has(`${m.frame}:${Math.round(m.x + shifts[m.frame].dx)}:${Math.round(m.y + shifts[m.frame].dy)}`)).length >= cl.members.length / 2;
    if (usedByMover) continue;
    const fit = fitTrack(cl.members, mjds);
    const raw = cl.members.map((m) => ({ frame: m.frame, x: m.x + shifts[m.frame].dx, y: m.y + shifts[m.frame].dy, snr: m.snr }));
    const rawPositions = frames.map((f, g) => ({ x: fit.x + fit.vx * ((mjds[g] - fit.mjd) / DAYS_PER_YEAR) + shifts[g].dx, y: fit.y + fit.vy * ((mjds[g] - fit.mjd) / DAYS_PER_YEAR) + shifts[g].dy }));
    const constrained = Number.isFinite(fit.vErr);
    add(buildCandidate({
      kind: "static", sky: canvasToSky(fit.x / n, fit.y / n, geo), epochMjd: fit.mjd,
      motion: constrained ? { pmEast: -fit.vx * geo.scaleArcsec, pmNorth: -fit.vy * geo.scaleArcsec, pmErr: fit.vErr * geo.scaleArcsec } : null,
      detections: raw, rmsPx: fit.rms, falseAlarm: null, significance: null, rawPositions,
      skyAt: (g) => canvasToSky(rawPositions[g].x / n, rawPositions[g].y / n, geo), extra: {},
    }));
    stats.staticSources++;
  }

  // --- known asteroids caught in a single image: a dot where SkyBoT says a body is
  if (skybot) {
    const bodies = new Map();
    frames.forEach((f, k) => {
      for (const b of skybot[k] ?? []) {
        if (b.errArcsec !== null && b.errArcsec !== undefined && b.errArcsec > 30) continue;
        const { fx, fy } = skyToCanvas(b.ra, b.dec, geo), x = fx * n, y = fy * n;
        if (x < 3 || y < 3 || x > n - 3 || y > n - 3) continue;
        const hit = dots[k].map((d) => ({ d, r: Math.hypot(d.x - x - shifts[k].dx, d.y - y - shifts[k].dy) })).sort((a, b2) => a.r - b2.r)[0];
        if (!hit || hit.r > 3) continue;
        const e = bodies.get(b.name) ?? { body: b, hits: [] };
        e.hits.push({ frame: k, x: hit.d.x, y: hit.d.y, snr: hit.d.snr ?? 0 });
        bodies.set(b.name, e);
      }
    });
    for (const [, e] of bodies) {
      const rawPositions = frames.map((f, g) => { const hit = e.hits.find((h) => h.frame === g); return hit ? { x: hit.x, y: hit.y } : null; });
      add(buildCandidate({
        kind: "asteroid", sky: { ra: e.body.ra, dec: e.body.dec }, epochMjd: mjds[e.hits[0].frame], motion: null, detections: e.hits, rmsPx: 0, falseAlarm: null, significance: null,
        rawPositions, skyAt: () => ({ ra: e.body.ra, dec: e.body.dec }), extra: { forcedBody: { name: e.body.name, vmag: e.body.vmag, cls: e.body.cls, hits: e.hits.length, bestSepArcsec: 0 } },
      }));
      stats.asteroids++;
    }
  }

  // A "mover" that is only a few of the dots of a FIXED source is not a second object (found on real data: four dots of a bright star near the
  // picture edge formed a line of 12 arcsec/yr, while the same star was also linked as a fixed source in all 12 images).
  for (let i = candidates.length - 1; i >= 0; i--) {
    const m = candidates[i];
    if (m.kind === "mover" && candidates.some((s) => s.kind === "static" && isShadowOf(m, s))) { candidates.splice(i, 1); stats.movers--; stats.shadowMovers = (stats.shadowMovers ?? 0) + 1; }
  }

  const threshold = options.needsChecking ?? NEEDS_CHECKING_SCORE;
  candidates.forEach((c) => finish(c, threshold));
  candidates.sort((a, b) => CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class) || b.support - a.support);
  return { candidates, summary: summarise(candidates, stats, catalogues), stats, dots, shifts, threshold };
}

/** Counts for the top of the page: how many sources, how many are known, how many need a person. */
export function summarise(candidates, stats, catalogues) {
  const counts = Object.fromEntries(Object.keys(CLASSES).map((k) => [k, 0]));
  for (const c of candidates) counts[c.class]++;
  return {
    total: candidates.length, counts, needsChecking: counts.unknown,
    known: counts["solar-system"] + counts["catalogued-moving"] + counts.catalogued,
    catalogues: Object.keys(catalogues ?? {}).filter((k) => Array.isArray(catalogues[k])),
    dotsPerFrame: stats.dotsPerFrame, passes: stats.passes,
  };
}
