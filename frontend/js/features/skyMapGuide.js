import { separationDeg } from "./skyExplorer.js";
import { aladinSkyAt } from "./skyContextClick.js";

export function outsideWorkspaceField(aladin, field) {
  if (!field) return false;
  const [ra, dec] = aladin.getRaDec();
  return separationDeg(ra, dec, field.ra, field.dec) > field.fov / 120;
}

/** Sample the projection locally, so the guide follows the zoom and coordinate frame. */
export function skyMapGuide(aladin) {
  const [width, height] = aladin.getSize();
  const x = width / 2, y = height / 2;
  const sample = Math.min(80, x - 1);
  if (sample <= 0 || y <= 0) return null;
  const centre = aladinSkyAt(aladin, { x, y });
  const edge = aladinSkyAt(aladin, { x: x + sample, y });
  if (!centre || !edge) return null;
  const span = separationDeg(centre.ra, centre.dec, edge.ra, edge.dec);
  if (!Number.isFinite(span) || span <= 0) return null;

  const unit = span >= 1 ? 1 : span >= 1 / 60 ? 60 : 3600;
  const magnitude = span * unit;
  const power = 10 ** Math.floor(Math.log10(magnitude));
  const step = [5, 2, 1].find((factor) => factor * power <= magnitude) ?? 1;
  const amount = step * power;
  const scale = {
    width: sample * amount / magnitude,
    label: `${Number(amount.toPrecision(2))}${unit === 1 ? "°" : unit === 60 ? "′" : "″"}`,
  };

  // Recover the local screen directions from pixel samples in ICRS. This
  // avoids world2pix's frame-argument incompatibility in Aladin Lite 3.6.5.
  const delta = Math.min(8, sample, y / 2);
  const right = aladinSkyAt(aladin, { x: x + delta, y });
  const down = aladinSkyAt(aladin, { x, y: y + delta });
  const eastOffset = ({ ra }) => ((ra - centre.ra + 540) % 360) - 180;
  let north = null, east = null;
  if (right && down && Math.abs(centre.dec) < 90) {
    const eastRight = eastOffset(right), eastDown = eastOffset(down);
    const northRight = right.dec - centre.dec, northDown = down.dec - centre.dec;
    const determinant = eastRight * northDown - eastDown * northRight;
    if (determinant) {
      const sign = Math.sign(determinant);
      const angle = (dx, dy) => Math.atan2(sign * dy, sign * dx) * 180 / Math.PI;
      north = angle(-eastDown, eastRight);
      east = angle(northDown, -northRight);
    }
  }
  return { ...scale, north, east };
}
