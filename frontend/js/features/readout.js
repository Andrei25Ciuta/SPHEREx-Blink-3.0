// readout.js – what the viewer shows under the cursor: which pixel, which place on the sky, how far from the middle, what value.
// Pure (no DOM). The sky position uses the SAME conversion as the click-to-measure (geometry.js canvasToSky), so the number under the
// cursor and the number measured after a click can never disagree.

import { canvasToSky } from "../geometry.js";
import { pixelOf } from "./view.js";
import { formatRA, formatDec } from "../coords.js";

/**
 * The pixel and the sky position of an image fraction.
 * geo = { ra, dec, n, scaleArcsec } (the centre of the cutout, its size in pixels, arcsec per pixel).
 * -> { inside, ix, iy, ra, dec, east, north }   east / north = arcsec from the centre of the cutout (east = left, north = up)
 */
export function describePoint(fx, fy, geo, skyFn = canvasToSky) {
  const px = pixelOf(fx, fy, geo.n);
  const sky = skyFn(fx, fy, geo);
  return { inside: px.inside, ix: px.ix, iy: px.iy, ra: sky.ra, dec: sky.dec, east: sky.eastArcsec, north: sky.northArcsec };
}

/** "MJy / sr" -> "MJy/sr". Empty or missing -> "". */
export const cleanUnit = (unit) => String(unit ?? "").replace(/\s+/g, "");

const signed = (v) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}″`;

/** A pixel value for display: three significant digits and the unit; NaN = the file has no data there. */
export function formatValue(value, unit = "") {
  if (!Number.isFinite(value)) return "no data";
  const u = cleanUnit(unit);
  return `${Math.abs(value) >= 1000 || (value !== 0 && Math.abs(value) < 0.01) ? value.toExponential(2) : value.toPrecision(3)}${u ? ` ${u}` : ""}`;
}

const signedLevel = (v) => `${v < 0 ? "−" : "+"}${Math.abs(Math.round(v))}`;

/**
 * What the picture holds at a pixel in the modes that combine images, in DISPLAY levels (0-255, the stretched 8-bit picture), never in the file's unit:
 * the real values exist for the single image of Blink mode only.
 * mode = "mean" (Stack) | "max" (Trail) | "diff" (Difference) | "compare"; v = { level } | { current, reference } | { a, b }.
 */
export function levelsText(mode, v) {
  if (!v) return "";
  if (mode === "mean") return `Stack: display level ${Math.round(v.level)}/255`;
  if (mode === "max") return `Trail: display level ${Math.round(v.level)}/255`;
  if (mode === "diff") return `Difference: ${signedLevel(v.current - v.reference)} display levels (now ${Math.round(v.current)}, reference ${Math.round(v.reference)})`;
  if (mode === "compare") return `A ${Math.round(v.a)} · B ${Math.round(v.b)} (display levels)`;
  return "";
}

/**
 * The strings of the readout. value = { text } to show a value, or null to show none.
 * -> { pixel, sky, offset, value }  (value is "" when there is none)
 */
export function readoutParts(desc, value = null) {
  if (!desc.inside) return { pixel: "outside the image", sky: "", offset: "", value: "" };
  return {
    pixel: `pixel ${desc.ix}, ${desc.iy}`,
    sky: `RA ${formatRA(desc.ra)}  Dec ${formatDec(desc.dec)}`,
    offset: `E ${signed(desc.east)}  N ${signed(desc.north)}`,
    value: value?.text ?? "",
  };
}
