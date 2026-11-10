// skyExplorer.js – the maths of the sky explorer (pure: no DOM, no network): an all-sky map and the footprints of the image files that exist.
//
// The map is a Hammer projection (equal area; right ascension grows to the LEFT, as on a sky chart, so that east is left like in the pictures of the app). The footprints come from
// the backend (backend/spherex/footprints.py): the four corners of each image file ON THAT MACHINE, from the file's own WCS. They are grouped into fields (images of nearly the same
// place). Nothing is invented: a sky with no file has no footprint, and the SPHEREx survey as a whole is not drawn at all.
//
//   hammer / inverseHammer     (RA, Dec) <-> map coordinates x in [-2 sqrt 2, 2 sqrt 2], y in [-sqrt 2, sqrt 2]
//   eclipticLine / galacticLine  great circles to draw: the ecliptic (where a Planet X would move) and the plane of the Milky Way
//   groupFields                images of nearly the same place -> one field each (centre, how many images, which detectors, which dates)
//   fieldOffsets               the corners of a field's images as offsets from its centre, in arcmin, to draw them at true scale

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const SQRT2 = Math.SQRT2;
export const MAP_HALF_WIDTH = 2 * SQRT2, MAP_HALF_HEIGHT = SQRT2;

const wrap360 = (a) => ((a % 360) + 360) % 360;
const wrap180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;

/** Map coordinates of a sky position. RA 180 deg, Dec 0 is the middle; RA 0 / 360 is the right / left edge; the poles are (0, +-sqrt 2). */
export function hammer(raDeg, decDeg) {
  const lambda = (180 - wrap360(raDeg)) * RAD, phi = decDeg * RAD;
  const d = Math.sqrt(1 + Math.cos(phi) * Math.cos(lambda / 2));
  return { x: (2 * SQRT2 * Math.cos(phi) * Math.sin(lambda / 2)) / d, y: (SQRT2 * Math.sin(phi)) / d };
}

/** The sky position under a point of the map, or null outside the ellipse of the map. */
export function inverseHammer(x, y) {
  const z2 = 1 - (x / 4) ** 2 - (y / 2) ** 2;
  if (!(z2 >= 0.5)) return null;                                   // the ellipse of the projection is z^2 = 1/2 .. 1 (a point of the map has z^2 >= 1/2)
  const z = Math.sqrt(z2);
  const lambda = 2 * Math.atan2(z * x, 2 * (2 * z2 - 1));
  const phi = Math.asin(Math.max(-1, Math.min(1, z * y)));
  return { ra: wrap360(180 - lambda * DEG), dec: phi * DEG };
}

/** Angular separation of two sky positions, degrees (haversine). */
export function separationDeg(ra1, dec1, ra2, dec2) {
  const a = Math.sin(((dec2 - dec1) * RAD) / 2) ** 2 + Math.cos(dec1 * RAD) * Math.cos(dec2 * RAD) * Math.sin(((ra2 - ra1) * RAD) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * DEG;
}

/** The ecliptic as a list of { ra, dec }, n points (obliquity 23.4392911 deg, J2000). */
export function eclipticLine(n = 181) {
  const eps = 23.4392911 * RAD;
  return Array.from({ length: n }, (_, i) => {
    const lon = (i / (n - 1)) * 2 * Math.PI;
    return { ra: wrap360(Math.atan2(Math.cos(eps) * Math.sin(lon), Math.cos(lon)) * DEG), dec: Math.asin(Math.sin(eps) * Math.sin(lon)) * DEG };
  });
}

/** The galactic plane (b = 0) as a list of { ra, dec }, n points. The pole used is the IAU one: RA 192.85948, Dec 27.12825, l of the celestial pole 122.93192 (all deg). */
export function galacticLine(n = 181) {
  const raG = 192.85948 * RAD, decG = 27.12825 * RAD, lNcp = 122.93192 * RAD;
  return Array.from({ length: n }, (_, i) => {
    const l = (i / (n - 1)) * 2 * Math.PI, b = 0;
    const dec = Math.asin(Math.sin(b) * Math.sin(decG) + Math.cos(b) * Math.cos(decG) * Math.cos(lNcp - l));
    const ra = raG + Math.atan2(Math.cos(b) * Math.sin(lNcp - l), Math.sin(b) * Math.cos(decG) - Math.cos(b) * Math.sin(decG) * Math.cos(lNcp - l));
    return { ra: wrap360(ra * DEG), dec: dec * DEG };
  });
}

/** The same great circle as a path in map coordinates, as segments: it is cut where it crosses the edge of the map (RA 0 / 360), so no line crosses the whole map. */
export function pathSegments(points) {
  const segments = [];
  let current = [];
  let prev = null;
  for (const p of points) {
    const q = hammer(p.ra, p.dec);
    if (prev && Math.abs(q.x - prev.x) > 1.5) { if (current.length > 1) segments.push(current); current = []; }
    current.push(q);
    prev = q;
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

// ------------------------------------------------------------------ fields

/**
 * Group footprints (as the backend sends them) into fields: images whose centres are within `radiusDeg` of the field's centre (the first image starts a field, the centre
 * is the mean direction of its images). -> [{ id, ra, dec, count, detectors: { D2: n }, firstDate, lastDate, minWidthArcmin, maxWidthArcmin, footprints }] biggest first.
 */
export function groupFields(footprints, radiusDeg = 0.6) {
  const fields = [];
  for (const fp of footprints ?? []) {
    const [ra, dec] = fp.centre;
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    const f = fields.find((g) => separationDeg(g.ra, g.dec, ra, dec) <= radiusDeg);
    if (f) { f.footprints.push(fp); recentre(f); } else { const g = { footprints: [fp] }; recentre(g); fields.push(g); }
  }
  for (const f of fields) {
    const dates = f.footprints.map((p) => p.dateISO).sort(), widths = f.footprints.map((p) => p.widthArcmin);
    f.count = f.footprints.length;
    f.detectors = {};
    for (const p of f.footprints) f.detectors[p.detector] = (f.detectors[p.detector] ?? 0) + 1;
    f.firstDate = dates[0].slice(0, 10); f.lastDate = dates.at(-1).slice(0, 10);
    f.minWidthArcmin = Math.min(...widths); f.maxWidthArcmin = Math.max(...widths);
  }
  fields.sort((a, b) => b.count - a.count || a.ra - b.ra);
  fields.forEach((f, i) => { f.id = `F${i + 1}`; });
  return fields;
}

function recentre(f) {
  let x = 0, y = 0, z = 0;
  for (const p of f.footprints) {
    const a = p.centre[0] * RAD, d = p.centre[1] * RAD;
    x += Math.cos(d) * Math.cos(a); y += Math.cos(d) * Math.sin(a); z += Math.sin(d);
  }
  f.ra = wrap360(Math.atan2(y, x) * DEG);
  f.dec = Math.atan2(z, Math.hypot(x, y)) * DEG;
}

/** The field nearest to a sky position, if one is within maxDeg; else null. */
export function nearestField(fields, ra, dec, maxDeg = 8) {
  let best = null, bd = maxDeg;
  for (const f of fields) { const d = separationDeg(f.ra, f.dec, ra, dec); if (d <= bd) { bd = d; best = f; } }
  return best;
}

/** A field in words: where, how many images of which detectors, and when. */
export function fieldText(f) {
  const dets = Object.entries(f.detectors).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([d, n]) => `${d} ×${n}`).join(", ");
  const dates = f.firstDate === f.lastDate ? f.firstDate : `${f.firstDate} to ${f.lastDate}`;
  const lo = f.minWidthArcmin.toFixed(1), hi = f.maxWidthArcmin.toFixed(1), width = lo === hi ? `${hi}′` : `${lo}–${hi}′`;
  return `${f.count} image${f.count === 1 ? "" : "s"} (${dets}), ${width} wide, ${dates}`;
}

/** A field of view (arcmin, integer, 1-30) that shows what the field's images have in common: the narrowest of them. */
export const suggestedFov = (f) => Math.max(1, Math.min(30, Math.floor(f.minWidthArcmin)));

/**
 * The corners of a field's images as offsets (arcmin) from the field's centre, east to the LEFT (x grows to the west) and north UP (y grows north), to draw at true scale.
 * -> [{ detector, dateISO, polygon: [[x, y] x4] }]
 */
export function fieldOffsets(f) {
  const cosd = Math.cos(f.dec * RAD);
  return f.footprints.map((p) => ({
    detector: p.detector, dateISO: p.dateISO,
    polygon: p.corners.map(([ra, dec]) => [-wrap180(ra - f.ra) * cosd * 60, (dec - f.dec) * 60]),          // a corner east of the centre (larger RA) has x < 0: east is left
  }));
}
