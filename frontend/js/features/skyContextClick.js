// Pure coordinate helpers for Aladin Lite's Sky Context pointer readouts.
// pix2world returns ICRS positions even if a different frame is displayed.
export function aladinSkyAt(aladin, event) {
  if (!aladin || !event) return null;
  let coordinates = null;
  if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
    try { coordinates = aladin.pix2world(event.x, event.y, "icrs"); }
    catch { return null; }
  }
  if (!coordinates && Number.isFinite(event.ra) && Number.isFinite(event.dec) &&
      (!event.frame || /^(icrs|equatorial)$/i.test(event.frame))) {
    coordinates = [event.ra, event.dec];
  }
  if (!Array.isArray(coordinates) || !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1]) || Math.abs(coordinates[1]) > 90) return null;
  return { ra: ((coordinates[0] % 360) + 360) % 360, dec: coordinates[1] };
}

export function selectionText({ ra, dec }) {
  const raText = (Number(ra.toFixed(5)) % 360).toFixed(5);
  const decText = dec.toFixed(5);
  return { raText, decText };
}
