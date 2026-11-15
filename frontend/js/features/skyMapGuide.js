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

  const offset = Math.min(span / 8, 0.1);
  const { ra, dec } = centre;
  const northStep = dec + offset < 90 ? offset : -offset;
  const eastStep = offset / Math.cos(dec * Math.PI / 180);
  const direction = (lon, lat, sign = 1) => {
    try {
      const p = aladin.world2pix((lon + 360) % 360, lat, "icrs");
      if (!p?.every(Number.isFinite)) return null;
      return Math.atan2(sign * (p[1] - y), sign * (p[0] - x)) * 180 / Math.PI;
    } catch { return null; }
  };
  return {
    ...scale,
    north: Math.abs(dec) < 90 ? direction(ra, dec + northStep, Math.sign(northStep)) : null,
    east: Math.abs(eastStep) < 90 ? direction(ra + eastStep, dec) : null,
  };
}
