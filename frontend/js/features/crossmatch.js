// crossmatch.js – is a candidate already known? Catalogue matching that knows about proper motion and epochs.
//
// A dot "in neither 2MASS nor AllWISE" is not unknown: the star may have moved since 1999 or 2010 (Barnard's Star moved 270
// arcsec), or be missing from one catalogue and present in another. So a candidate is compared with each catalogue AT THAT
// CATALOGUE'S EPOCH:
//   * catalogues that list a proper motion (SIMBAD, Gaia DR3): the catalogue object is moved to the candidate's date;
//   * catalogues that do not (2MASS about 1999, AllWISE about 2010): the candidate is moved BACK to the catalogue's date with
//     its own measured proper motion, but only when that motion is significant (3 sigma and above 0.15 arcsec/yr); the extra
//     room for its uncertainty is capped, because the wider the circle the more chance matches (2MASS has about 4000 sources
//     per square degree, so a circle of 30 arcsec would catch one by chance almost every time).
// Pure functions (no DOM, no network): the catalogues are fetched elsewhere (catalogue.js for SIMBAD, the backend's
// /api/catalogue for 2MASS, AllWISE and Gaia, skybot.js for asteroids) and passed in.

export const CATALOGUES = {
  simbad: { label: "SIMBAD", epochMjd: 51544.5, hasPm: true },       // positions are for J2000.0 with a proper motion
  gaia: { label: "Gaia DR3", epochMjd: 57388.0, hasPm: true },       // reference epoch 2016.0
  "2mass": { label: "2MASS", epochMjd: 51400, hasPm: false },        // observed 1997-2001, about 1999 (each source has its own date)
  allwise: { label: "AllWISE", epochMjd: 55380, hasPm: false },      // about 2010.5 (each source has its own date)
};
const DEG = Math.PI / 180;
const DAYS_PER_YEAR = 365.25;
export const BASE_RADIUS_ARCSEC = 8;           // about 1.3 pixel: how well a SPHEREx position and a catalogue position agree
const MAX_EXTRA_ARCSEC = 12;                   // the most room given for the candidate's own motion uncertainty
export const MIN_USEFUL_PM = 0.15;             // arcsec/yr: below this a measured motion is not used to move the candidate
const PM_AGREE_FLOOR = 0.3;                    // arcsec/yr: motions closer than this (or 3 sigma) agree

/** Angular separation in arcsec (small-angle formula: fine for the few arcminutes of a cutout, exact enough to 1e-3 arcsec). */
export function separationArcsec(ra1, dec1, ra2, dec2) {
  let dRa = ra1 - ra2;
  if (dRa > 180) dRa -= 360; else if (dRa < -180) dRa += 360;
  const mid = ((dec1 + dec2) / 2) * DEG;
  return Math.hypot(dRa * Math.cos(mid), dec1 - dec2) * 3600;
}

/** Move a position by a proper motion (arcsec/yr, east and north) over dtYears. */
export function movePosition(ra, dec, pmEastArcsecPerYr, pmNorthArcsecPerYr, dtYears) {
  return {
    ra: ra + (pmEastArcsecPerYr * dtYears) / 3600 / Math.cos(dec * DEG),
    dec: dec + (pmNorthArcsecPerYr * dtYears) / 3600,
  };
}

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Rows of one catalogue -> normalised objects { cat, id, ra, dec, pmEast, pmNorth (arcsec/yr, null if the catalogue has none),
 * epochMjd, mag (text for people), type }.
 * Accepts SIMBAD objects from catalogue.js ({ id, ra, dec, pmra, pmdec (mas/yr), otype }) and the backend's /api/catalogue rows
 * ({ id, ra, dec, pmra, pmdec, epochMjd, mags: { J: .., W2: .. } }).
 */
export function normaliseCatalogue(catKey, rows) {
  const spec = CATALOGUES[catKey];
  if (!spec) throw new Error(`unknown catalogue "${catKey}"`);
  return (rows ?? []).map((r, i) => {
    const pmra = num(r.pmra), pmdec = num(r.pmdec);
    const mags = r.mags ? Object.entries(r.mags).filter(([, v]) => num(v) !== null).map(([k, v]) => `${k} ${Number(v).toFixed(1)}`).join(", ") : "";
    return {
      cat: catKey, id: String(r.id ?? r.label ?? `${spec.label} #${i + 1}`), ra: Number(r.ra), dec: Number(r.dec),
      pmEast: spec.hasPm && pmra !== null ? pmra / 1000 : null, pmNorth: spec.hasPm && pmdec !== null ? pmdec / 1000 : null,
      epochMjd: num(r.epochMjd) ?? spec.epochMjd, mag: mags, type: r.otype ?? r.type ?? "",
    };
  }).filter((o) => Number.isFinite(o.ra) && Number.isFinite(o.dec));
}

/**
 * Which objects of the catalogues sit where the candidate is?
 * candidate: { ra, dec, epochMjd, pmEast, pmNorth, pmErr (arcsec/yr), posErrArcsec }; the motion fields may be null (a static source).
 * catalogues: { simbad: [...], gaia: [...], "2mass": [...], allwise: [...] } as returned by normaliseCatalogue (a missing key = not checked).
 * A list with `truncated: true` (the server cut it) counts as checked only for the candidates it matched.
 * Returns { matches: [{ cat, label, id, sepArcsec, radiusArcsec, mag, type, pm, pmConsistent (true/false when both motions are known, else null) }], checked: ["SIMBAD", ...], checkedKeys: ["simbad", ...], notChecked: [...] }.
 */
export function matchCandidate(candidate, catalogues, { baseArcsec = BASE_RADIUS_ARCSEC } = {}) {
  const matches = [], checked = [], notChecked = [];
  const posErr = Math.max(0, candidate.posErrArcsec ?? 0);
  const pmErr = Math.max(0, candidate.pmErr ?? 0);
  const motion = candidate.pmEast !== null && candidate.pmEast !== undefined && candidate.pmNorth !== null && candidate.pmNorth !== undefined
    && Math.hypot(candidate.pmEast, candidate.pmNorth) >= Math.max(MIN_USEFUL_PM, 3 * pmErr)
    ? { east: candidate.pmEast, north: candidate.pmNorth } : null;
  const checkedKeys = [];
  for (const key of Object.keys(CATALOGUES)) {
    const list = catalogues?.[key];
    if (!Array.isArray(list)) { notChecked.push(CATALOGUES[key].label); continue; }
    const before = matches.length;
    for (const o of list) {
      let sep, radius;
      if (o.pmEast !== null && o.pmEast !== undefined) {
        // the catalogue knows the motion: move the OBJECT to the candidate's date
        const dt = (candidate.epochMjd - o.epochMjd) / DAYS_PER_YEAR;
        const p = movePosition(o.ra, o.dec, o.pmEast, o.pmNorth, dt);
        sep = separationArcsec(candidate.ra, candidate.dec, p.ra, p.dec);
        radius = Math.hypot(baseArcsec, 3 * posErr);
      } else {
        // the catalogue has no motion: move the CANDIDATE to the catalogue's date, if its own motion is real
        const dt = (o.epochMjd - candidate.epochMjd) / DAYS_PER_YEAR;
        const p = motion ? movePosition(candidate.ra, candidate.dec, motion.east, motion.north, dt) : { ra: candidate.ra, dec: candidate.dec };
        sep = separationArcsec(p.ra, p.dec, o.ra, o.dec);
        const extra = motion ? Math.min(MAX_EXTRA_ARCSEC, 3 * pmErr * Math.abs(dt)) : 0;
        radius = Math.hypot(baseArcsec, 3 * posErr, extra);
      }
      if (sep <= radius) {
        const hasPm = o.pmEast !== null && o.pmEast !== undefined;
        // Does the catalogue's own motion agree with the one measured? A line of dots through a fixed star near the picture edge can "move"
        // at 12 arcsec/yr and still sit on that star: the position alone would call it "known and moving".
        let pmConsistent = null;
        if (hasPm && motion) {
          const diff = Math.hypot(motion.east - o.pmEast, motion.north - o.pmNorth);
          pmConsistent = diff <= Math.max(PM_AGREE_FLOOR, 3 * Math.hypot(pmErr, 0.05));
        }
        matches.push({ cat: key, label: CATALOGUES[key].label, id: o.id, sepArcsec: sep, radiusArcsec: radius, mag: o.mag, type: o.type, pm: hasPm ? Math.hypot(o.pmEast, o.pmNorth) : null, pmConsistent });
      }
    }
    // A list the server had to cut short (a dense field) cannot say "not in this catalogue": a match counts, the absence of one does not.
    if (list.truncated && matches.length === before) notChecked.push(`${CATALOGUES[key].label} (answer incomplete)`);
    else { checked.push(CATALOGUES[key].label); checkedKeys.push(key); }
  }
  matches.sort((a, b) => a.sepArcsec - b.sepArcsec);
  return { matches, checked, checkedKeys, notChecked };
}

/** Catalogues deep enough to say "this source is new": SIMBAD alone lists few faint infrared sources, so it cannot. */
export const DEEP_CATALOGUES = ["gaia", "2mass", "allwise"];
export const checkedDeep = (match) => (match?.checkedKeys ?? []).some((k) => DEEP_CATALOGUES.includes(k));

/**
 * Known Solar System bodies (SkyBoT, one list per image) that a candidate coincides with.
 * positions: [{ ra, dec } or null] the candidate's place on each image's date; perFrame: [[body]] from skybot.js (parseSkybot);
 * bodies whose own position error is larger than maxErrArcsec are ignored (they cannot be matched to a dot).
 * Returns the body with most hits: { name, vmag, cls, hits (images), bestSepArcsec } or null.
 */
export function matchBodies(positions, perFrame, { radiusArcsec = 20, maxErrArcsec = 30 } = {}) {
  const tally = new Map();
  positions.forEach((p, k) => {
    if (!p) return;
    for (const b of perFrame?.[k] ?? []) {
      if (b.errArcsec !== null && b.errArcsec !== undefined && b.errArcsec > maxErrArcsec) continue;
      const sep = separationArcsec(p.ra, p.dec, b.ra, b.dec);
      if (sep > radiusArcsec) continue;
      const t = tally.get(b.name) ?? { name: b.name, vmag: b.vmag, cls: b.cls, hits: 0, bestSepArcsec: Infinity };
      t.hits++; t.bestSepArcsec = Math.min(t.bestSepArcsec, sep);
      tally.set(b.name, t);
    }
  });
  return [...tally.values()].sort((a, b) => b.hits - a.hits || a.bestSepArcsec - b.bestSepArcsec)[0] ?? null;
}
