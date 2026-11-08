// parallax.js – distance from apparent motion: "Planet X mode".
//
// A star is so far away that it stays put on the sky. A body of the outer Solar System does not: as the
// Earth goes round the Sun, the body seems to swing back and forth ("parallax"), and the closer it is, the
// wider the swing (1 AU / distance, as an angle: 412" at 500 AU). On top of that it drifts along its own
// slow orbit. So its apparent path is a LOOP-like curve, not the straight line "Find movers" looks for,
// and the size of the loop tells the distance.
//
//   earthPositionAU()        where the Earth is on a date (low-precision ephemeris, good to about 0.0002 AU)
//   parallaxOffsetArcsec()   how far a body at distance rho seems displaced, relative to the middle date
//   fitParallax()            distance (with a range) from measured positions: parallax + straight drift
//   findDistantMovers()      the search: for every triple of dots from 3 survey passes, ask "is the middle
//                            one displaced from the straight line exactly as the Earth's motion predicts
//                            for SOME distance?", then keep the triples that dots in the other images confirm
//   describeDistant()        the physical reading of a result (own velocity, bound to the Sun or not)
//   classifyApparentMotion() a cautious word on what an ordinary candidate's speed suggests
//
// Approximations (also said in the interface): the Earth is placed with the low-precision Sun formula of
// Meeus (Astronomical Algorithms, ch. 25) and measured from the Sun, not from the Solar System barycentre
// (up to 0.005 AU = 2" at 500 AU); the body's own motion is taken as a straight line over the one or two
// years observed; the distance is measured from the Earth on the middle date (from the Sun it differs by
// at most 1 AU). Pure functions, so they also run in Node tests.

import { DEFAULTS, registerShifts, passIndices } from "./movers.js";
import { canvasToSky } from "../geometry.js";

const DEG = Math.PI / 180;
export const ARCSEC_PER_RAD = 206264.806;
const OBLIQUITY = 23.4392911 * DEG;             // of the ecliptic, J2000
const KMS_PER_AU_YR = 4.740470;                 // 1 AU/yr in km/s

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Heliocentric position of the Earth, equatorial J2000 axes, in AU. (Sun formula of Meeus, ch. 25.) */
export function earthPositionAU(mjd) {
  const T = (mjd + 2400000.5 - 2451545.0) / 36525;                                   // Julian centuries since J2000
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;                        // mean longitude of the Sun
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG;                 // mean anomaly
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;                    // eccentricity of the orbit
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
          + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const R = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(M + C * DEG));             // Sun-Earth distance, AU
  // The Earth is opposite the Sun. The Sun's longitude is "of date"; remove the precession to get J2000 axes.
  const lon = (L0 + C + 180 - (1.396971 * T + 0.0003086 * T * T)) * DEG;
  const x = R * Math.cos(lon), y = R * Math.sin(lon);                                // ecliptic plane (latitude ~ 0)
  return [x, y * Math.cos(OBLIQUITY), y * Math.sin(OBLIQUITY)];
}

/** Unit vectors: towards (ra, dec), towards the east and towards the north (degrees in). */
function basis(ra, dec) {
  const a = ra * DEG, d = dec * DEG;
  return {
    n0: [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)],
    east: [-Math.sin(a), Math.cos(a), 0],
    north: [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)],
  };
}

/**
 * Where a body that does NOT move in space, at distance `distanceAU` from the Earth on date mjdRef, appears
 * on date `mjd`, relative to where it appears on mjdRef (so the offset is 0 on mjdRef). (ra, dec) = the
 * direction of the body (the field centre will do). Returns tangent-plane arcsec: { east, north }.
 * An infinite distance (a star) gives no offset.
 */
export function parallaxOffsetArcsec(ra, dec, mjd, mjdRef, distanceAU) {
  if (!Number.isFinite(distanceAU)) return { east: 0, north: 0 };
  const { n0, east, north } = basis(ra, dec);
  const e0 = earthPositionAU(mjdRef), e1 = earthPositionAU(mjd);
  // the body sits at E(mjdRef) + distance * n0; seen from the Earth on `mjd` it lies along u
  const u = [e0[0] - e1[0] + distanceAU * n0[0], e0[1] - e1[1] + distanceAU * n0[1], e0[2] - e1[2] + distanceAU * n0[2]];
  const w = dot(u, n0);
  return { east: (dot(u, east) / w) * ARCSEC_PER_RAD, north: (dot(u, north) / w) * ARCSEC_PER_RAD };
}

/** Distances spaced evenly in the logarithm. */
export function logGrid(lo, hi, count) {
  return Array.from({ length: count }, (_, i) => lo * (hi / lo) ** (i / (count - 1)));
}

// ------------------------------------------------------------------ fit of the distance

/** Weighted least-squares straight line y = a + mu * t. Returns { a, mu, chi2 }. */
function lineFit(t, y, w) {
  let sw = 0, st = 0, sy = 0, stt = 0, sty = 0;
  for (let i = 0; i < t.length; i++) { sw += w[i]; st += w[i] * t[i]; sy += w[i] * y[i]; stt += w[i] * t[i] * t[i]; sty += w[i] * t[i] * y[i]; }
  const det = sw * stt - st * st;
  const mu = Math.abs(det) > 1e-12 ? (sw * sty - st * sy) / det : 0;
  const a = (sy - mu * st) / sw;
  let chi2 = 0;
  for (let i = 0; i < t.length; i++) chi2 += w[i] * (y[i] - a - mu * t[i]) ** 2;
  return { a, mu, chi2 };
}

/**
 * Distance of a body from its measured positions.
 * obs: [{ mjd, east, north, sigma }]  positions in arcsec (tangent plane, any fixed origin), sigma in arcsec.
 * Model: position(t) = a + mu * (t - tMean) + parallax(distance). Straight drift and offset are free; for
 * every trial distance they are fitted exactly, and the distance with the smallest chi-square wins.
 * Returns { best: { distanceAU, chi2 }, linear: { chi2 }, deltaChi2, rangeAU: [lo, hi] (1 sigma),
 *           dof, muEast, muNorth (arcsec/yr), scan }.
 */
export function fitParallax(obs, { ra, dec, mjdRef, distancesAU = logGrid(20, 20000, 240) }) {
  const m = obs.length;
  if (m < 3 || new Set(obs.map(o => o.mjd)).size < 3 ||
      !obs.every(o => [o.mjd, o.east, o.north, o.sigma].every(Number.isFinite) && o.sigma > 0)) {
    throw new RangeError("At least three distinct dates and finite positions with positive uncertainties are required.");
  }
  if (![ra, dec, mjdRef].every(Number.isFinite) || Math.abs(dec) > 90 ||
      distancesAU.length < 2 || !distancesAU.every((d, i) => Number.isFinite(d) && d > 0 && (!i || d > distancesAU[i - 1]))) {
    throw new RangeError("Supply valid sky coordinates and an increasing positive distance grid.");
  }
  const t0 = obs.reduce((s, o) => s + o.mjd, 0) / m;
  const t = obs.map((o) => (o.mjd - t0) / 365.25);
  const w = obs.map((o) => 1 / (o.sigma * o.sigma));
  const trial = (distance) => {
    const p = obs.map((o) => parallaxOffsetArcsec(ra, dec, o.mjd, mjdRef, distance));
    const fe = lineFit(t, obs.map((o, i) => o.east - p[i].east), w);
    const fn = lineFit(t, obs.map((o, i) => o.north - p[i].north), w);
    return { distanceAU: distance, chi2: fe.chi2 + fn.chi2, muEast: fe.mu, muNorth: fn.mu };
  };
  const scan = distancesAU.map(trial);
  const linear = trial(Infinity);
  // Refine inside the best grid cell so a high-precision fit can resolve a range narrower than one grid step.
  const gridBest = scan.reduce((b, s) => s.chi2 < b.chi2 ? s : b);
  const k = scan.indexOf(gridBest);
  let left = distancesAU[Math.max(0, k - 1)], right = distancesAU[Math.min(k + 1, scan.length - 1)];
  let best = gridBest;
  for (let i = 0; i < 45; i++) {
    const a = trial((2 * left + right) / 3), b = trial((left + 2 * right) / 3);
    if (a.chi2 < best.chi2) best = a;
    if (b.chi2 < best.chi2) best = b;
    if (a.chi2 < b.chi2) right = b.distanceAU;
    else left = a.distanceAU;
  }
  const threshold = best.chi2 + 1;
  function profileEdge(limit) {
    if (trial(limit).chi2 <= threshold) return null;
    let inside = best.distanceAU, outside = limit;
    for (let i = 0; i < 48; i++) {
      const middle = Math.sqrt(inside * outside);
      if (trial(middle).chi2 < threshold) inside = middle;
      else outside = middle;
    }
    return (inside + outside) / 2;
  }
  const profileAU = [profileEdge(distancesAU[0]), profileEdge(distancesAU.at(-1))];
  const sw = w.reduce((s, v) => s + v);
  const meanE = obs.reduce((s, o, i) => s + w[i] * o.east, 0) / sw;
  const meanN = obs.reduce((s, o, i) => s + w[i] * o.north, 0) / sw;
  const stationary = { chi2: obs.reduce((s, o, i) => s + w[i] * ((o.east - meanE) ** 2 + (o.north - meanN) ** 2), 0) };
  return {
    best, stationary, linear, deltaChi2: linear.chi2 - best.chi2, profileAU,
    // Keep the existing numeric range for scripts. Null profile endpoints explicitly identify scan limits.
    rangeAU: [profileAU[0] ?? distancesAU[0], profileAU[1] ?? distancesAU.at(-1)],
    dof: 2 * m - 5, muEast: best.muEast, muNorth: best.muNorth, scan,
  };
}

// ------------------------------------------------------------------ the search

/** Solve the normal equations A x = b (small, dense). Returns null when singular. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Find bodies whose positions follow "straight drift + Earth parallax" but NOT a straight line alone.
 * frames: [{ mjd, sources: [{ x, y, snr }] }] in time order, as for findMovers; geo = { ra, dec, n, scaleArcsec }.
 * options: minDistanceAU (50), maxDistanceAU (5000), minParallaxSigma (6), maxEscapeFactor (1.5: the body's own
 * speed may be at most 1.5 times the Sun's escape speed at that distance, i.e. it must be bound to the Sun;
 * pass Infinity to drop that assumption), plus the findMovers options.
 * Returns { candidates, stats, reason? }. A candidate has the fields of a findMovers candidate (x, y, vx, vy, mjdRef
 * = the STRAIGHT-DRIFT part, shifts[k] = how far the body is displaced on image k, points) and, in addition,
 *   distanceAU, distanceRangeAU: [lo, hi], parallaxSigma (how much better than a straight line), rmsLinear.
 */
export function findDistantMovers(frames, geo, options = {}) {
  const o = { minDistanceAU: 50, maxDistanceAU: 5000, minParallaxSigma: 6, seedResidualPx: 2, maxSeedDots: 80, maxTriples: 4e7,
    maxEscapeFactor: 1.5,       // the body must be bound to the Sun: own speed at most this times the escape speed (Infinity = no limit)
    minParallaxFraction: 0.6,   // a body must be found at this fraction of the distinct dates (0.5 for the faint real one of VALIDATION.md)
    minPerPass: 2,              // ... and have at least this many dots in each survey pass it uses (1 for a faint body seen once per pass)
    maxParallaxRmsPx: 0.6,      // rms of its dots about the model; real faint sources need about 1.5 (centroid error of S/N 4-8 sources).
                                // The effective limit is the smaller of this and maxRmsPx (0.8 from findMovers): pass both to loosen it.
    ...DEFAULTS, ...options };
  const N = frames.length;
  const stats = { frames: N, passes: 0, dotsPerFrame: frames.map((f) => f.sources.length), movingDots: 0, seeds: 0, triples: 0, truncated: false };
  if (N < 3) return { candidates: [], stats, reason: "needs at least 3 images" };
  const epoch = passIndices(frames.map((f) => f.mjd), o.minPassGapDays);
  const nEpochs = epoch[N - 1] + 1;
  stats.passes = nEpochs;
  if (nEpochs < 3) return { candidates: [], stats, reason: `needs images from at least 3 survey passes (found ${nEpochs})` };

  // 0) several fields: an image that carries its own field (frame.geo = { ra, dec, n, scaleArcsec } of ITS cutout) has its dots
  //    brought into the common plane of `geo`. A body that swings out of one cutout is then followed into the next one (the plane
  //    can be as large as the cutouts together; flat-field approximation, fine up to about a degree).
  //    Each cutout is small (the flat-field approximation of geometry.js is fine inside it); the common plane is the exact
  //    gnomonic (tangent-plane) projection about geo's centre, the same one the parallax offsets use, so cutouts degrees apart still agree.
  const gnomonic = (ra, dec) => {
    const a = (ra - geo.ra) * DEG, d = dec * DEG, d0 = geo.dec * DEG;
    const D = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a);
    const east = (Math.cos(d) * Math.sin(a) / D) * ARCSEC_PER_RAD, north = ((Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a)) / D) * ARCSEC_PER_RAD;
    return { x: geo.n / 2 - east / geo.scaleArcsec, y: geo.n / 2 - north / geo.scaleArcsec };       // east is LEFT, north is UP
  };
  const inCommon = (f) => (f.geo
    ? f.sources.map((s) => { const sky = canvasToSky(s.x / f.geo.n, s.y / f.geo.n, f.geo); return { ...s, ...gnomonic(sky.ra, sky.dec) }; })
    : f.sources);
  const plane = frames.map((f) => ({ mjd: f.mjd, sources: inCommon(f) }));
  stats.dotsPerFrame = plane.map((f) => f.sources.length);

  // pointing errors between exposures, exactly as in findMovers
  const reg = o.register === false ? frames.map(() => ({ dx: 0, dy: 0 })) : registerShifts(plane).map((s) => (Math.abs(s.dx) > 0.05 || Math.abs(s.dy) > 0.05 ? s : { dx: 0, dy: 0 }));
  const dots = plane.map((f, k) => f.sources.map((s) => ({ k, x: s.x - reg[k].dx, y: s.y - reg[k].dy, snr: s.snr ?? 0, used: false })));

  const t0 = frames[0].mjd, mjdRef = (t0 + frames[N - 1].mjd) / 2;
  const t = frames.map((f) => (f.mjd - mjdRef) / 365.25);                         // years from the middle date
  const scale = geo.scaleArcsec;
  /** Exact displacement (pixels) of a body at distance rho on image k: observed = still position + this. */
  const offPx = (k, rho) => {
    const p = parallaxOffsetArcsec(geo.ra, geo.dec, frames[k].mjd, mjdRef, rho);
    return { x: -p.east / scale, y: -p.north / scale };                           // east is LEFT, north is UP (row 0 = top)
  };
  const GREF = 1000;                                                              // first-order shape: offset ~ g / rho
  const g = frames.map((_, k) => { const p = offPx(k, GREF); return { x: p.x * GREF, y: p.y * GREF }; });
  const sMin = 1 / o.maxDistanceAU, sMax = 1 / o.minDistanceAU;

  // 1) dots of field stars (still in >= 3 passes) can never be a swinging body: leave them out of the seeds
  // (a grid of cells per image, so a mosaic of thousands of dots is not compared pair by pair)
  const CELL = Math.max(2, Math.ceil(o.staticRadiusPx));
  const cells = dots.map((list) => {
    const m = new Map();
    for (const d of list) { const key = Math.floor(d.x / CELL) * 100003 + Math.floor(d.y / CELL); (m.get(key) ?? m.set(key, []).get(key)).push(d); }
    return m;
  });
  const hasPartner = (k, a) => {
    const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = cells[k].get((cx + dx) * 100003 + cy + dy);
      if (list) for (const b of list) if (Math.hypot(b.x - a.x, b.y - a.y) <= o.staticRadiusPx) return true;
    }
    return false;
  };
  const still = (a) => {
    const seen = new Set([epoch[a.k]]);
    for (let k = 0; k < N; k++) {
      if (epoch[k] === epoch[a.k] || seen.has(epoch[k])) continue;
      if (hasPartner(k, a)) seen.add(epoch[k]);
    }
    return seen.size >= Math.min(nEpochs, 3);
  };
  // `moving` = every dot that is not a still star (a body's dots can only be among these, in seeds AND as members:
  // letting the model pass through field stars lets chance dots in a crowded field confirm a false body);
  // `seedDots` = the brightest of them, to keep the number of triples manageable.
  const moving = dots.map((list) => list.filter((a) => !still(a)));
  const seedDots = moving.map((list) => [...list].sort((p, q) => q.snr - p.snr).slice(0, o.maxSeedDots));
  stats.movingDots = moving.reduce((s, l) => s + l.length, 0);

  // frames of each pass
  const framesOf = Array.from({ length: nEpochs }, () => []);
  frames.forEach((_, k) => framesOf[epoch[k]].push(k));

  const members = (theta, rho) => {                                                // nearest free dot to the predicted spot, per image
    const out = [];
    for (let k = 0; k < N; k++) {
      const off = offPx(k, rho);
      const px = theta[0] + theta[2] * t[k] + off.x, py = theta[1] + theta[3] * t[k] + off.y;
      let best = null, bd = o.matchRadiusPx;
      for (const d of moving[k]) {
        const dist = Math.hypot(d.x - px, d.y - py);
        if (dist <= bd) { best = d; bd = dist; }
      }
      if (best) out.push(best);
    }
    return out;
  };

  /** Gauss-Newton on theta = [Ax, Ay, mux, muy, s] (s = 1/distance) using the exact parallax. */
  const refine = (list, theta, iterations = 6) => {
    let th = [...theta];
    for (let it = 0; it < iterations; it++) {
      const rho = 1 / th[4], ds = th[4] * 1e-3;
      const rho2 = 1 / (th[4] + ds);
      const AtA = Array.from({ length: 5 }, () => new Array(5).fill(0)), Atb = new Array(5).fill(0);
      for (const d of list) {
        const off = offPx(d.k, rho), off2 = offPx(d.k, rho2);
        const dx = (off2.x - off.x) / ds, dy = (off2.y - off.y) / ds;
        const rx = d.x - (th[0] + th[2] * t[d.k] + off.x), ry = d.y - (th[1] + th[3] * t[d.k] + off.y);
        const rowx = [1, 0, t[d.k], 0, dx], rowy = [0, 1, 0, t[d.k], dy];
        for (let i = 0; i < 5; i++) {
          Atb[i] += rowx[i] * rx + rowy[i] * ry;
          for (let j = 0; j < 5; j++) AtA[i][j] += rowx[i] * rowx[j] + rowy[i] * rowy[j];
        }
      }
      const step = solve(AtA, Atb);
      if (!step) return null;
      th = th.map((v, i) => v + step[i]);
      if (!(th[4] > 0)) return null;
    }
    return th;
  };

  /**
   * The seed's distance, exactly: minimise |D - G(s)| where G uses the exact parallax offsets (the first-order
   * shape is only good to a few percent, which at hundreds of pixels of swing is far more than a match radius).
   */
  const exactSeed = (a, b, c, w, Dx, Dy, s0) => {
    const G = (sv) => {
      const pi = offPx(a.k, 1 / sv), pj = offPx(b.k, 1 / sv), pl = offPx(c.k, 1 / sv);
      return { x: pl.x - pi.x - w * (pj.x - pi.x), y: pl.y - pi.y - w * (pj.y - pi.y) };
    };
    let s = s0;
    for (let it = 0; it < 5; it++) {
      const g0 = G(s), g1 = G(s * 1.001), ds0 = s * 0.001;
      const Jx = (g1.x - g0.x) / ds0, Jy = (g1.y - g0.y) / ds0;
      const den = Jx * Jx + Jy * Jy;
      if (den < 1e-12) return null;
      s += (Jx * (Dx - g0.x) + Jy * (Dy - g0.y)) / den;
      if (!(s > 0)) return null;
    }
    const g = G(s);
    return { s, res: Math.hypot(Dx - g.x, Dy - g.y) };
  };

  /** Own speed (km/s) of a body at distance rho with a drift of speedPx pixels per year, and the Sun's escape speed there. */
  const ownKms = (speedPx, rho) => (speedPx * scale / ARCSEC_PER_RAD) * rho * KMS_PER_AU_YR;
  const tooFast = (speedPx, rho) => ownKms(speedPx, rho) > o.maxEscapeFactor * (42.1 / Math.sqrt(rho));   // not bound to the Sun

  const found = [];                                                               // { c: candidate, dots: Set, score }
  const minEpochs = Math.min(nEpochs, Math.max(3, Math.ceil(nEpochs / 2)));
  // A 5-parameter model fitted to 3 dots can pass through chance dots in a few other images, so ask for
  // most of the images (a real body is in most of them) and for at least two dots in every pass it uses;
  // the plain search needs only half of the images.
  // (counted over the distinct DATES: with a mosaic there are several images per date and the body is in only one of them)
  const nTimes = new Set(frames.map((f) => f.mjd)).size;
  const minDet = Math.max(o.minDetections, Math.ceil(o.minParallaxFraction * nTimes));
  const epochsOf = (list) => new Set(list.map((d) => epoch[d.k])).size;
  const wellCovered = (list) => {
    const per = new Array(nEpochs).fill(0);
    for (const d of list) per[epoch[d.k]] += 1;
    return per.filter((n, e) => n >= Math.min(o.minPerPass, framesOf[e].length)).length >= minEpochs;
  };
  const maxRms = Math.min(o.maxRmsPx, o.maxParallaxRmsPx);

  // 2) seeds: three dots from three different passes. For the model  position = A + mu*t + s*g  the middle
  //    one must be displaced from the straight line through the other two by a vector PARALLEL to
  //    G = g_l - g_i - w (g_j - g_i); that fixes s = 1/distance (one constraint is left over: the test).
  for (let e1 = 0; e1 < nEpochs - 2; e1++) {
    for (let e2 = e1 + 1; e2 < nEpochs - 1; e2++) {
      for (let e3 = e2 + 1; e3 < nEpochs; e3++) {
        for (const i of framesOf[e1]) for (const j of framesOf[e2]) for (const l of framesOf[e3]) {
          const w = (t[l] - t[i]) / (t[j] - t[i]);
          const Gx = g[l].x - g[i].x - w * (g[j].x - g[i].x), Gy = g[l].y - g[i].y - w * (g[j].y - g[i].y);
          const G2 = Gx * Gx + Gy * Gy;
          if (G2 * sMin * sMin < 9) continue;                                      // Earth moved too little: no lever arm (< 3 px at the far limit)
          for (const a of seedDots[i]) for (const b of seedDots[j]) {
            for (const c of seedDots[l]) {
              if (++stats.triples > o.maxTriples) { stats.truncated = true; break; }
              const Dx = c.x - a.x - w * (b.x - a.x), Dy = c.y - a.y - w * (b.y - a.y);
              const s = (Dx * Gx + Dy * Gy) / G2;
              if (s < sMin * 0.8 || s > sMax * 1.2) continue;
              if (Math.hypot(Dx - s * Gx, Dy - s * Gy) > o.seedResidualPx + 0.1 * s * Math.sqrt(G2)) continue;   // quick first-order screen
              const seed = exactSeed(a, b, c, w, Dx, Dy, s);                         // then the exact test
              if (!seed || seed.res > o.seedResidualPx || seed.s < sMin || seed.s > sMax) continue;
              stats.seeds += 1;
              // straight line through the three dots after removing the parallax
              const offs = [a, b, c].map((d) => offPx(d.k, 1 / seed.s));
              const xs = [a, b, c].map((d, n) => d.x - offs[n].x), ys = [a, b, c].map((d, n) => d.y - offs[n].y);
              const tt = [a, b, c].map((d) => t[d.k]);
              const fx = lineFit(tt, xs, [1, 1, 1]), fy = lineFit(tt, ys, [1, 1, 1]);
              if (Math.hypot(fx.mu, fy.mu) > o.maxSpeedPxPerYear || tooFast(Math.hypot(fx.mu, fy.mu), 1 / seed.s)) continue;   // faster than allowed / than any bound orbit
              let th = refine([a, b, c], [fx.a, fy.a, fx.mu, fy.mu, seed.s]);
              if (!th) continue;
              let list = members(th, 1 / th[4]);
              if (list.length < minDet || epochsOf(list) < minEpochs) continue;
              for (let pass = 0; pass < 2; pass++) {                                 // refit on all the dots, look again
                th = refine(list, th, 4);
                if (!th) break;
                list = members(th, 1 / th[4]);
                if (list.length < minDet || epochsOf(list) < minEpochs) { th = null; break; }
              }
              if (th && !wellCovered(list)) th = null;
              if (!th) continue;
              th = refine(list, th, 4);
              if (!th || th[4] < sMin * 0.9 || th[4] > sMax * 1.1 || Math.hypot(th[2], th[3]) > o.maxSpeedPxPerYear) continue;
              const rho = 1 / th[4];
              if (tooFast(Math.hypot(th[2], th[3]), rho)) continue;

              // quality: rms about the parallax model, and about the best straight line without it
              let ss = 0, ssLin = 0;
              const lineX = lineFit(list.map((d) => t[d.k]), list.map((d) => d.x), list.map(() => 1));
              const lineY = lineFit(list.map((d) => t[d.k]), list.map((d) => d.y), list.map(() => 1));
              for (const d of list) {
                const off = offPx(d.k, rho);
                ss += (d.x - (th[0] + th[2] * t[d.k] + off.x)) ** 2 + (d.y - (th[1] + th[3] * t[d.k] + off.y)) ** 2;
                ssLin += (d.x - lineX.a - lineX.mu * t[d.k]) ** 2 + (d.y - lineY.a - lineY.mu * t[d.k]) ** 2;
              }
              const m = list.length;
              const rms = Math.sqrt(ss / Math.max(1, 2 * m - 5)), rmsLinear = Math.sqrt(ssLin / Math.max(1, 2 * m - 4));
              if (rms > maxRms) continue;
              const sigmaPos = Math.max(rms, o.centroidFloorPx);
              const parallaxSigma = Math.sqrt(Math.max(0, ssLin - ss)) / sigmaPos;
              if (parallaxSigma < o.minParallaxSigma) continue;                      // a straight line explains it: an ordinary mover

              const cand = {
                x: th[0], y: th[1], vx: th[2], vy: th[3], mjdRef,
                speedPx: Math.hypot(th[2], th[3]), motionPx: Math.hypot(th[2], th[3]) * (Math.max(...list.map((d) => t[d.k])) - Math.min(...list.map((d) => t[d.k]))),
                nDet: m, nFrames: nTimes, rms, rmsLinear, significance: parallaxSigma, parallaxSigma,
                snr: list.reduce((s, d) => s + d.snr, 0) / m,
                distanceAU: rho,
                points: list.map((d) => ({ frame: d.k, x: d.x, y: d.y })),
                shifts: frames.map((_, k) => { const off = offPx(k, rho); return { dx: off.x + reg[k].dx, dy: off.y + reg[k].dy }; }),
                registration: reg,
              };
              // The same body is found again from many seeds (and chance fits share a few dots with it):
              // two candidates that share 2 dots are rivals, the one with more dots and a tighter fit stays.
              // (Also rivals: two models that predict the same spot, within 3 px, on at least half of the images.)
              const dotSet = new Set(list), score = m - rms;
              const predicted = frames.map((_, k) => { const off = offPx(k, rho); return { x: th[0] + th[2] * t[k] + off.x, y: th[1] + th[3] * t[k] + off.y }; });
              // The new candidate is compared with ALL its rivals (rivalry is not transitive: A and B may both rival C
              // without rivalling each other); it stays only if it beats every one of them, and then it replaces all of them.
              const rivals = [];
              found.forEach((f, idx) => {
                let shared = 0;
                for (const d of dotSet) if (f.dots.has(d)) shared++;
                let close = 0;
                for (let k = 0; k < N; k++) if (Math.hypot(f.predicted[k].x - predicted[k].x, f.predicted[k].y - predicted[k].y) <= 3) close++;
                if (shared >= 2 || close >= N / 2) rivals.push(idx);
              });
              if (!rivals.length) found.push({ c: cand, dots: dotSet, score, predicted });
              else if (rivals.every((idx) => score > found[idx].score)) {
                for (let r = rivals.length - 1; r >= 0; r--) found.splice(rivals[r], 1);
                found.push({ c: cand, dots: dotSet, score, predicted });
              }
            }
            if (stats.truncated) break;
          }
          if (stats.truncated) break;
        }
      }
    }
  }
  const candidates = found.map((f) => f.c).sort((p, q) => q.parallaxSigma - p.parallaxSigma);
  // Infer uncertainty once per surviving association. Refit both coordinates and both drifts at each distance.
  for (const c of candidates) {
    const sigma = Math.max(c.rms, o.centroidFloorPx) * scale;
    const measurements = c.points.map(p => ({
      mjd: frames[p.frame].mjd, east: -p.x * scale, north: -p.y * scale, sigma,
    }));
    const fit = fitParallax(measurements, { ra: geo.ra, dec: geo.dec, mjdRef,
      distancesAU: logGrid(o.minDistanceAU, o.maxDistanceAU, 64) });
    c.distanceRangeAU = fit.rangeAU;
    c.distanceProfileAU = fit.profileAU;
    c.modelChi2 = { stationary: fit.stationary.chi2, linear: fit.linear.chi2, parallax: fit.best.chi2, dof: fit.dof };
  }
  return { candidates, stats };
}

// ------------------------------------------------------------------ reading a result

/**
 * Physical reading of a findDistantMovers candidate. geo = { scaleArcsec }.
 * Its own velocity follows from the drift and the distance: v = mu * distance. A body bound to the Sun at
 * distance r moves at 29.78/sqrt(r) km/s on a circular orbit and cannot exceed 42.1/sqrt(r) km/s.
 */
export function describeDistant(c, geo) {
  const east = -c.vx * geo.scaleArcsec, north = -c.vy * geo.scaleArcsec;          // own drift, arcsec per year (east is LEFT)
  const speed = Math.hypot(east, north);
  const vKms = (speed / ARCSEC_PER_RAD) * c.distanceAU * KMS_PER_AU_YR;
  const vCirc = 29.78 / Math.sqrt(c.distanceAU), vEsc = 42.1 / Math.sqrt(c.distanceAU);
  const bound = vKms <= vEsc * 1.2;
  const [lo, hi] = c.distanceRangeAU;
  const range = c.distanceProfileAU?.includes(null) ? "distance range open at search limit" : `${lo.toFixed(1)}–${hi.toFixed(1)} AU`;
  return {
    distanceAU: c.distanceAU, rangeText: range, ownSpeedArcsecPerYear: speed, ownPmEast: east, ownPmNorth: north,
    ownVelocityKms: vKms, circularKms: vCirc, escapeKms: vEsc, bound,
    text: `Follows Earth parallax: about ${Math.round(c.distanceAU)} AU away (${range}, profile Δχ² = 1). ` +
      `Its own drift is ${speed.toFixed(0)}″/yr, which at that distance is ${vKms.toFixed(1)} km/s; a body orbiting the Sun there moves at ${vCirc.toFixed(1)} km/s ` +
      (bound ? "and cannot exceed " + vEsc.toFixed(1) + " km/s: consistent with a Solar System object." : "and cannot exceed " + vEsc.toFixed(1) + " km/s: too fast to be bound to the Sun, so treat the distance with suspicion."),
  };
}

/** A cautious word on what the apparent speed of an ordinary (straight-line) candidate suggests. speed in arcsec/yr. */
export function classifyApparentMotion(speedArcsecPerYear) {
  if (speedArcsecPerYear < 12) {
    return "Speed in the range of nearby stars and brown dwarfs (Barnard's Star, the fastest known star, moves about 10.4″/yr).";
  }
  return "Faster than any known star. A Solar System object is more likely, or an artifact: compare the other detectors.";
}

/** Rough distance from the retrograde rate near opposition: the Earth overtakes the body at 29.8 km/s = 6.28 AU/yr. */
export function retrogradeDistanceAU(arcsecPerYear) {
  return (6.28 * ARCSEC_PER_RAD) / arcsecPerYear;
}
