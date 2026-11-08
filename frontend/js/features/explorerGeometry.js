// Gnomonic coordinates relative to a field centre, in degrees of tangent-plane length.
const RAD = Math.PI / 180;

export function tangentPoint(ra, dec, centreRa, centreDec) {
  const lon = (ra - centreRa) * RAD, lat = dec * RAD, lat0 = centreDec * RAD;
  const w = Math.sin(lat0) * Math.sin(lat) + Math.cos(lat0) * Math.cos(lat) * Math.cos(lon);
  if (w <= 0) return null;
  return [Math.cos(lat) * Math.sin(lon) / (w * RAD),
    (Math.cos(lat0) * Math.sin(lat) - Math.sin(lat0) * Math.cos(lat) * Math.cos(lon)) / (w * RAD)];
}

export function fieldCorners(ra, dec, fovArcmin) {
  const half = Math.tan(fovArcmin * RAD / 120);
  const d = dec * RAD;
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => {
    const x = sx * half, y = sy * half;
    const radial = Math.cos(d) - y * Math.sin(d);
    return [(ra + Math.atan2(x, radial) / RAD + 360) % 360,
      Math.atan2(Math.sin(d) + y * Math.cos(d), Math.hypot(radial, x)) / RAD];
  });
}
