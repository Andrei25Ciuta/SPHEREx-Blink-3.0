// view.js – the zoom/pan state of the image viewer, as pure functions (no DOM), so Node can test them.
//
// Positions on the image are FRACTIONS (fx, fy) from the top-left corner, 0..1 (geometry.js). Zooming does NOT change that
// geometry: sky <-> image fraction (canvasToSky / skyToCanvas) stays exactly as it is. The view only says which part of the image
// the canvas shows, so one more step maps image fraction <-> canvas pixel:
//
//   view = { zoom, cx, cy }     zoom >= 1 (1 = the whole image); (cx, cy) = the image fraction in the middle of the canvas
//   canvas x = ((fx - cx) * zoom + 0.5) * W        W, H = the canvas size in its own pixels
//
// Every function returns a NEW view and keeps it inside the image (you cannot drag past the edge).

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 32;
export const ZOOM_STEP = 1.5;                       // one button press or key press

export const createView = () => ({ zoom: 1, cx: 0.5, cy: 0.5 });

/** Zoom inside [MIN_ZOOM, MAX_ZOOM] and the centre such that the shown part stays inside the image. Bad numbers fall back to the whole image. */
export function clampView(view) {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(view?.zoom) ? view.zoom : 1));
  const half = 0.5 / zoom;
  const inside = (c) => Math.min(1 - half, Math.max(half, Number.isFinite(c) ? c : 0.5));
  return { zoom, cx: inside(view?.cx), cy: inside(view?.cy) };
}

/** Image fraction -> canvas pixel. Outside 0..W when the point is off screen. */
export function fracToCanvas(view, fx, fy, W, H) {
  return { x: ((fx - view.cx) * view.zoom + 0.5) * W, y: ((fy - view.cy) * view.zoom + 0.5) * H };
}

/** Canvas pixel -> image fraction (the inverse of fracToCanvas). */
export function canvasToFrac(view, x, y, W, H) {
  return { fx: (x / W - 0.5) / view.zoom + view.cx, fy: (y / H - 0.5) / view.zoom + view.cy };
}

/** The part of the image on screen, in IMAGE pixels, for ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H). n = image size in pixels. */
export function sourceRect(view, n) {
  const side = n / view.zoom;
  return { sx: (view.cx - 0.5 / view.zoom) * n, sy: (view.cy - 0.5 / view.zoom) * n, sw: side, sh: side };
}

/** Zoom by `factor` keeping the image point under the canvas pixel (x, y) where it is (so the cursor stays on the same star). */
export function zoomAt(view, factor, x, y, W, H) {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const { fx, fy } = canvasToFrac(view, x, y, W, H);
  return clampView({ zoom, cx: fx - (x / W - 0.5) / zoom, cy: fy - (y / H - 0.5) / zoom });
}

/** Set the zoom level about the middle of the canvas. */
export function zoomTo(view, zoom, W, H) { return zoomAt(view, zoom / view.zoom, W / 2, H / 2, W, H); }

/** Drag: the image follows the pointer, which moved (dx, dy) canvas pixels. */
export function panBy(view, dx, dy, W, H) {
  return clampView({ zoom: view.zoom, cx: view.cx - dx / (W * view.zoom), cy: view.cy - dy / (H * view.zoom) });
}

/** Keyboard pan: dirX, dirY in {-1, 0, 1}; one press moves `share` of the field on screen. */
export function panStep(view, dirX, dirY, share = 0.15) {
  return clampView({ zoom: view.zoom, cx: view.cx + (dirX * share) / view.zoom, cy: view.cy + (dirY * share) / view.zoom });
}

/** Centre the view on an image fraction, keeping the zoom (for "show this candidate"). */
export function centreOn(view, fx, fy) { return clampView({ zoom: view.zoom, cx: fx, cy: fy }); }

/** The pixel of the image that holds an image fraction: { ix, iy, inside }. Pixel ix covers fractions [ix/n, (ix+1)/n). */
export function pixelOf(fx, fy, n) {
  const inside = fx >= 0 && fx < 1 && fy >= 0 && fy < 1;
  return { ix: Math.floor(fx * n), iy: Math.floor(fy * n), inside };
}

const BAR_STEPS_ARCSEC = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 900, 1800, 3600];

/**
 * A scale bar: the longest "round" angle that fits in maxPx canvas pixels.
 * arcsecPerCanvasPx = (arcsec per image pixel) * n / (W * zoom). Returns { arcsec, px, label } or null if even the smallest step is too long.
 */
export function scaleBar(arcsecPerCanvasPx, maxPx = 140) {
  if (!(arcsecPerCanvasPx > 0) || !Number.isFinite(arcsecPerCanvasPx)) return null;
  let best = null;
  for (const arcsec of BAR_STEPS_ARCSEC) if (arcsec / arcsecPerCanvasPx <= maxPx) best = arcsec;
  if (best === null) return null;
  return { arcsec: best, px: best / arcsecPerCanvasPx, label: best >= 60 ? `${best / 60}′` : `${best}″` };
}

/** "×1", "×1.5", "×12": the zoom as shown next to the buttons. */
export const zoomLabel = (zoom) => `×${Number.isInteger(zoom) ? zoom : Number(zoom.toFixed(1))}`;
