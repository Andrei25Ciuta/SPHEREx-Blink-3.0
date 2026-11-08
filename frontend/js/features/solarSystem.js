// solarSystem.js – where the planets are on a date, for the Solar System simulator (pure: no DOM, no network).
//
// Positions are heliocentric, ecliptic J2000, in AU. The planets come from the Keplerian elements of JPL's "Approximate Positions of the Major Planets" (E. M. Standish; valid 1800-2050
// AD; a table of six elements and their rates per Julian century). THE NUMBERS OF THAT TABLE ARE WRITTEN HERE FROM MEMORY: they are not trusted until they are checked, and
// `node scratch/check_planets.mjs` checks them against JPL Horizons (the numbers of docs/VALIDATION.md section 17 come from it). The Earth is NOT taken from this table: it is the Earth of
// parallax.js (earthPositionAU, low-precision Sun formula of Meeus, the one the Planet X search uses and test_parallax.mjs checks), turned into ecliptic axes, so that the simulator and
// the parallax of the search can never disagree.
//
//   planetPosition(name, mjd)    heliocentric ecliptic position of a planet (AU)
//   earthPosition(mjd)           the Earth, the same as the parallax search uses, in ecliptic axes
//   sightLine(ra, dec)           the direction of a sky position, as a unit vector in ecliptic axes
//   bodyAt(earthMjd, ...)        where a distant body that does not move in space is, and the angle it seems to swing through
//   screenRadius(mode, r, max)   how far from the Sun a distance in AU is drawn: true (linear) or compressed (square root, EDUCATIONAL mode, labelled as such)

import { earthPositionAU } from "./parallax.js";

const RAD = Math.PI / 180;
const OBLIQUITY = 23.4392911 * RAD;                                   // of the ecliptic, J2000 (the same as parallax.js)
export const MJD_J2000 = 51544.5;

/** a (AU), e, I, L, long. of perihelion, long. of the node (deg) at J2000, and their rates per Julian century. From memory: see the head of the file. */
export const ELEMENTS = {
  Mercury: { base: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  Venus: { base: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418] },
  Mars: { base: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  Jupiter: { base: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  Saturn: { base: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  Uranus: { base: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
  Neptune: { base: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664] },
};
export const PLANETS = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];

/** E from the mean anomaly M (radians) and the eccentricity e: Newton's method on E - e sin E = M. */
export function solveKepler(M, e) {
  // E - M = e sin E lies in [-e, e], so E is kept inside [M - e, M + e]: Newton's method then cannot run away, whatever the eccentricity or the sign of M
  let E = M + 0.85 * e * Math.sign(Math.sin(M) || 1);
  for (let i = 0; i < 60; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E = Math.min(Math.max(E - d, M - e), M + e);
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

/** Heliocentric ecliptic J2000 position of a planet of ELEMENTS on a date (MJD), AU. */
export function planetPosition(name, mjd) {
  const el = ELEMENTS[name];
  if (!el) throw new Error(`unknown planet: ${name}`);
  const T = (mjd - MJD_J2000) / 36525;
  const [a, e, I, L, wbar, node] = el.base.map((v, i) => v + el.rate[i] * T);
  let M = ((L - wbar) % 360 + 540) % 360 - 180;                       // mean anomaly, -180..180 degrees
  const E = solveKepler(M * RAD, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = (wbar - node) * RAD, O = node * RAD, i = I * RAD;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  return [(cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    (sw * si) * xp + (cw * si) * yp];
}

/** Equatorial J2000 axes -> ecliptic J2000 axes (a turn about the x axis by the obliquity). */
export const equatorialToEcliptic = ([x, y, z]) => [x, Math.cos(OBLIQUITY) * y + Math.sin(OBLIQUITY) * z, -Math.sin(OBLIQUITY) * y + Math.cos(OBLIQUITY) * z];

/** The Earth on a date, in ecliptic axes: the one the parallax search uses (parallax.js earthPositionAU). */
export const earthPosition = (mjd) => equatorialToEcliptic(earthPositionAU(mjd));

/** Any of the eight planets (the Earth through earthPosition). */
export const position = (name, mjd) => (name === "Earth" ? earthPosition(mjd) : planetPosition(name, mjd));

/** The direction of a sky position (RA, Dec in degrees) as a unit vector in ecliptic axes. */
export function sightLine(raDeg, decDeg) {
  const a = raDeg * RAD, d = decDeg * RAD;
  return equatorialToEcliptic([Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]);
}

/** Orbital period of a planet, years (Kepler's third law with its semi-major axis at J2000: derived, not looked up). */
export const periodYears = (name) => (name === "Earth" ? 1 : ELEMENTS[name].base[0] ** 1.5);

/**
 * A body that does not move in space, `distanceAU` from the Earth of date `mjdRef` in the direction (ra, dec): its place, and, for the Earth of another date, the angle (arcsec) between the lines
 * of sight from the two Earths (the parallax the search measures). -> { body: [x, y, z], swingArcsec(mjd) }
 */
export function bodyAt(mjdRef, raDeg, decDeg, distanceAU) {
  const n = sightLine(raDeg, decDeg), e0 = earthPosition(mjdRef);
  const body = [e0[0] + distanceAU * n[0], e0[1] + distanceAU * n[1], e0[2] + distanceAU * n[2]];
  return {
    body,
    swingArcsec(mjd) {
      const e1 = earthPosition(mjd), u = [body[0] - e1[0], body[1] - e1[1], body[2] - e1[2]];
      const lu = Math.hypot(...u), c = (u[0] * n[0] + u[1] * n[1] + u[2] * n[2]) / lu;
      return Math.acos(Math.max(-1, Math.min(1, c))) * (180 / Math.PI) * 3600;
    },
  };
}

/**
 * How far from the Sun a distance is drawn, as a fraction of the radius of the drawing (0 at the Sun, 1 at `maxAU`).
 * "true": linear, to scale. "educational": the square root, which spreads the inner planets out so that all can be seen; NOT to scale, and the page says so.
 */
export function screenRadius(mode, rAU, maxAU) {
  const f = Math.max(0, rAU) / maxAU;
  return mode === "educational" ? Math.sqrt(f) : f;
}

export const RANGES_AU = [{ id: "inner", label: "Inner Solar System (2 AU)", maxAU: 2 }, { id: "giants", label: "To Jupiter (6 AU)", maxAU: 6 }, { id: "all", label: "To Neptune (35 AU)", maxAU: 35 },
  { id: "far", label: "Far away (1000 AU)", maxAU: 1000 }];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** MJD -> "22 Aug 2025". */
export function mjdLabel(mjd) {
  const d = new Date((mjd - 40587) * 86400000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
