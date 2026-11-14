import { parallaxOffsetArcsec } from "./parallax.js";

/** Injection path before the per-exposure registration corrections. */
export function recoveryTrack(data, cell, outcome) {
  return data.frames.map(({ mjd, dateISO }) => {
    const p = parallaxOffsetArcsec(data.ra, data.dec, mjd, data.refMjd, cell.distanceAU);
    const years = (mjd - data.refMjd) / 365.25;
    return {
      x: outcome.origin.x - (p.east + data.muEast * years) / data.scale,
      y: outcome.origin.y - (p.north + data.muNorth * years) / data.scale,
      dateISO,
    };
  });
}
