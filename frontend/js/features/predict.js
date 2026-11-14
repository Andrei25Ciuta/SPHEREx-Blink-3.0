// predict.js – where a moving candidate will be at a future date (pure: no DOM, no network; Node tests: scratch/test_predict.mjs).
//
// Model: the straight line the mover search fitted (position at mjdRef plus a constant motion), carried forward in time. The 1-sigma
// range grows with time from the measured errors: sigma(t) = sqrt(posErr^2 + (vErr * years)^2), both from movers.js (posErrPx, vErrPx,
// converted to arcseconds with the pixel scale). What the model leaves out, and the page says so: acceleration, the curved paths of
// Solar System bodies (an asteroid's apparent motion changes within weeks), and the yearly parallax swing of a nearby or distant body.
// It is a prediction to check against new images, not a measurement.

const DAY = 1, YEAR = 365.25;

/** The horizons offered on the page, in days after the reference date. */
export const HORIZONS = [
  { id: "1m", label: "1 month", days: 30 },
  { id: "6m", label: "6 months", days: 182 },
  { id: "1y", label: "1 year", days: YEAR },
  { id: "5y", label: "5 years", days: 5 * YEAR },
  { id: "10y", label: "10 years", days: 10 * YEAR },
];

/** Motion and errors of a candidate in arcseconds: { east, north } ″/yr, sigmaV ″/yr per component, sigma0 ″. null if it cannot be predicted. */
export function motionOf(c, scaleArcsec) {
  if (!c || !Number.isFinite(c.ra) || !Number.isFinite(c.dec) || !Number.isFinite(c.mjdRef)) return null;
  const east = Number.isFinite(c.pmEastArcsecPerYear) ? c.pmEastArcsecPerYear : Number.isFinite(c.vx) && scaleArcsec ? -c.vx * scaleArcsec : null;
  const north = Number.isFinite(c.pmNorthArcsecPerYear) ? c.pmNorthArcsecPerYear : Number.isFinite(c.vy) && scaleArcsec ? -c.vy * scaleArcsec : null;
  if (east === null || north === null) return null;
  const sigmaV = Number.isFinite(c.vErrPx) && scaleArcsec ? c.vErrPx * scaleArcsec : null;
  const sigma0 = Number.isFinite(c.posErrPx) && scaleArcsec ? c.posErrPx * scaleArcsec : 0;
  return { east, north, speed: Math.hypot(east, north), sigmaV, sigma0 };
}

/**
 * The predicted position `days` after the reference date (negative = before).
 * -> { mjd, years, east, north (″ from the reference position), ra, dec (degrees), sigma (″, 1-sigma radius, null if unknown) } or null.
 */
export function predictAt(c, days, scaleArcsec) {
  const m = motionOf(c, scaleArcsec);
  if (!m) return null;
  const years = days / YEAR;
  const east = m.east * years, north = m.north * years;
  const dec = c.dec + north / 3600;
  const cosDec = Math.cos(((c.dec + dec) / 2) * Math.PI / 180) || 1e-9;
  const ra = (((c.ra + east / 3600 / cosDec) % 360) + 360) % 360;
  const sigma = m.sigmaV === null ? null : Math.hypot(m.sigma0, m.sigmaV * Math.abs(years));
  return { mjd: c.mjdRef + days * DAY, years, east, north, ra, dec, sigma };
}

/** Points of the predicted path from `fromDays` to `toDays` (for drawing), with their 1-sigma radii. */
export function predictPath(c, scaleArcsec, fromDays, toDays, steps = 40) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const p = predictAt(c, fromDays + (toDays - fromDays) * (i / steps), scaleArcsec);
    if (p) out.push(p);
  }
  return out;
}

/**
 * When does the object leave a square field of side fovArcmin centred on (ra0, dec0)? Days after mjdRef, or null if it stays inside for
 * `limitDays` (or is already outside). Small-field approximation.
 */
export function daysUntilOutside(c, scaleArcsec, ra0, dec0, fovArcmin, limitDays = 100 * YEAR) {
  const m = motionOf(c, scaleArcsec);
  if (!m || !m.speed) return null;
  const half = (fovArcmin * 60) / 2;
  const cosDec = Math.cos(dec0 * Math.PI / 180);
  const x0 = (c.ra - ra0) * 3600 * cosDec, y0 = (c.dec - dec0) * 3600;
  if (Math.abs(x0) > half || Math.abs(y0) > half) return null;
  let t = Infinity;
  for (const [p, v] of [[x0, m.east], [y0, m.north]]) {
    if (v > 0) t = Math.min(t, (half - p) / v);
    else if (v < 0) t = Math.min(t, (-half - p) / v);
  }
  const days = t * YEAR;
  return days <= limitDays ? days : null;
}

/** MJD to a calendar date "YYYY-MM-DD" (UTC). */
export function mjdToDate(mjd) {
  return new Date(Date.UTC(1858, 10, 17) + mjd * 86400000).toISOString().slice(0, 10);
}

/** A short, honest note about how far the straight-line model can be trusted for this object. */
export function reliabilityNote(c, scaleArcsec) {
  const m = motionOf(c, scaleArcsec);
  if (!m) return "This candidate has no measured motion to extend.";
  if (c.distant) return "This body also swings with Earth's yearly orbit; the straight line shows only its slow drift, so the real path weaves around it.";
  if (m.speed > 3600) return "This moves fast, like a Solar System body: its path curves within weeks, so a straight line is only a rough guide beyond a few days.";
  return "A star's motion through space is steady, so a straight line works well for years; the circle shows the 1-sigma range from the measured errors.";
}
