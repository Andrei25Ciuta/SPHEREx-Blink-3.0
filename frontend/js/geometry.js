// geometry.js – convert between sky coordinates and positions on the cutout image.
//
// Image convention (mock AND backend PNGs): north UP, east LEFT, the requested RA/Dec
// exactly in the centre, square, n × n pixels of scaleArcsec each.
// Positions on the image are FRACTIONS (fx, fy) from the top-left corner (0..1), so they
// do not depend on how big the <canvas> is drawn on screen.
//
// Small-field (flat) approximation: fine for our ≤ 30′ cutouts (error ≪ 1 pixel).

const DEG = Math.PI / 180;

/** Image fraction -> sky. Returns { ra, dec, eastArcsec, northArcsec } (offsets from centre). */
export function canvasToSky(fx, fy, { ra, dec, n, scaleArcsec }) {
  const dxArcsec = (fx * n - n / 2) * scaleArcsec;     // + = towards the right = WEST
  const dyArcsec = (fy * n - n / 2) * scaleArcsec;     // + = down = SOUTH
  const decOut = dec - dyArcsec / 3600;
  let raOut = ra - dxArcsec / 3600 / Math.cos(dec * DEG);
  raOut = ((raOut % 360) + 360) % 360;
  return { ra: raOut, dec: decOut, eastArcsec: -dxArcsec, northArcsec: -dyArcsec };
}

/** Sky -> image fraction { fx, fy } (may be outside 0..1 if the point is off the image). */
export function skyToCanvas(raPt, decPt, { ra, dec, n, scaleArcsec }) {
  let dRa = raPt - ra;
  if (dRa > 180) dRa -= 360; else if (dRa < -180) dRa += 360;  // across RA = 0
  const eastArcsec = dRa * 3600 * Math.cos(dec * DEG);
  const northArcsec = (decPt - dec) * 3600;
  return {
    fx: (n / 2 - eastArcsec / scaleArcsec) / n,
    fy: (n / 2 - northArcsec / scaleArcsec) / n,
  };
}

/** Modified Julian Date -> decimal (Julian) year. J2000.0 = MJD 51544.5. */
export const mjdToYear = (mjd) => 2000 + (mjd - 51544.5) / 365.25;

/** Inverse gnomonic projection on the real backend north-up TAN grid.
 * fx/fy are continuous coordinates measured from the displayed pixel edges.
 * Offsets are tangent-plane coordinates in arcseconds.
 */
export function tanCanvasToSky(fx, fy, { ra, dec, n, scaleArcsec }) {
  const eastArcsec = (.5 - fx) * n * scaleArcsec;
  const northArcsec = (.5 - fy) * n * scaleArcsec;
  const x = eastArcsec * DEG / 3600, y = northArcsec * DEG / 3600;
  const lat = dec * DEG;
  const base = Math.cos(lat) - y * Math.sin(lat);
  return { ra: (ra + Math.atan2(x, base) / DEG + 360) % 360,
    dec: Math.atan2(Math.sin(lat) + y * Math.cos(lat), Math.hypot(base, x)) / DEG,
    eastArcsec, northArcsec };
}
