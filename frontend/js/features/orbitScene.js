import { earthPositionAU, parallaxOffsetArcsec } from "./parallax.js";

const RAD = Math.PI / 180;

export function orbitScene(ra, dec, distance, epoch, day) {
  const observer = earthPositionAU(epoch + day), reference = earthPositionAU(epoch);
  const lon = ra * RAD, lat = dec * RAD;
  const direction = [Math.cos(lon) * Math.cos(lat), Math.sin(lon) * Math.cos(lat), Math.sin(lat)];
  const target = reference.map((x,i) => x + distance * direction[i]);
  return { observer, reference, target, direction,
    range: Math.hypot(...target.map((v,i) => v - observer[i])),
    offset: parallaxOffsetArcsec(ra, dec, epoch + day, epoch, distance) };
}

export function cameraPoint([x,y,z], azimuth, elevation) {
  const az = azimuth * RAD, el = elevation * RAD;
  return [x * Math.cos(az) - y * Math.sin(az),
    -(x * Math.sin(az) + y * Math.cos(az)) * Math.sin(el) + z * Math.cos(el)];
}
