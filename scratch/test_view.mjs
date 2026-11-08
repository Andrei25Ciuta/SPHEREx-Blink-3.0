// Tests for the viewer's zoom/pan maths (js/features/view.js), the layer registry (layers.js) and the pixel readout (readout.js).
// The key claim of Phase 2: zooming and panning change what the canvas SHOWS, never where a star IS on the sky.
// Run: node scratch/test_view.mjs
import { readFileSync } from "node:fs";
import {
  MIN_ZOOM, MAX_ZOOM, ZOOM_STEP, createView, clampView, fracToCanvas, canvasToFrac, sourceRect,
  zoomAt, zoomTo, panBy, panStep, centreOn, centreAndZoom, pathCentre, pixelOf, scaleBar, zoomLabel,
} from "../frontend/js/features/view.js";
import { OVERLAY_COLORS, LAYERS, layerCounts } from "../frontend/js/features/layers.js";
import { describePoint, cleanUnit, formatValue, readoutParts } from "../frontend/js/features/readout.js";
import { canvasToSky, skyToCanvas } from "../frontend/js/geometry.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const W = 512, H = 512;
// a small deterministic random generator, so a failure can be repeated
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const randomView = () => clampView({ zoom: 1 + rnd() * 31, cx: rnd(), cy: rnd() });

// ---------------------------------------------------------------- the view itself
{
  const v = createView();
  check("a new view shows the whole image", v.zoom === 1 && v.cx === 0.5 && v.cy === 0.5);
  check("clampView: zoom stays inside [1, 32]", clampView({ zoom: 0.2, cx: 0.5, cy: 0.5 }).zoom === MIN_ZOOM && clampView({ zoom: 500, cx: 0.5, cy: 0.5 }).zoom === MAX_ZOOM);
  check("clampView: at zoom 1 the centre is forced to the middle (nothing to pan)", (() => { const c = clampView({ zoom: 1, cx: 0.9, cy: 0.1 }); return c.cx === 0.5 && c.cy === 0.5; })());
  const edge = clampView({ zoom: 4, cx: 0, cy: 1 });
  check("clampView: the shown part cannot leave the image (zoom 4 -> centre between 0.125 and 0.875)", near(edge.cx, 0.125) && near(edge.cy, 0.875));
  const bad = clampView({ zoom: NaN, cx: undefined, cy: null });
  check("clampView: nonsense falls back to the whole image", bad.zoom === 1 && bad.cx === 0.5 && bad.cy === 0.5);
  check("clampView(undefined) does not throw and gives the whole image", clampView(undefined).zoom === 1);
}

// ---------------------------------------------------------------- image fraction <-> canvas pixel
{
  const v1 = createView();
  const p = fracToCanvas(v1, 0.25, 0.75, W, H);
  check("zoom 1 is the identity of before: canvas pixel = fraction x canvas size", near(p.x, 128) && near(p.y, 384));
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const v = randomView(), fx = rnd() * 1.4 - 0.2, fy = rnd() * 1.4 - 0.2;
    const c = fracToCanvas(v, fx, fy, W, H), back = canvasToFrac(v, c.x, c.y, W, H);
    worst = Math.max(worst, Math.abs(back.fx - fx), Math.abs(back.fy - fy));
  }
  check("fracToCanvas and canvasToFrac are inverses (2000 random views and points, also off the image)", worst < 1e-12, `worst ${worst.toExponential(1)}`);
  const v = { zoom: 4, cx: 0.3, cy: 0.6 };
  const c = fracToCanvas(v, 0.3, 0.6, W, H);
  check("the image fraction at the centre of the view is the middle of the canvas", near(c.x, W / 2) && near(c.y, H / 2));
  const r = sourceRect(v, 49), a = fracToCanvas(v, r.sx / 49, r.sy / 49, W, H), b = fracToCanvas(v, (r.sx + r.sw) / 49, (r.sy + r.sh) / 49, W, H);
  check("sourceRect: its corners land exactly on the corners of the canvas", near(a.x, 0) && near(a.y, 0) && near(b.x, W) && near(b.y, H));
  const full = sourceRect(createView(), 49);
  check("sourceRect at zoom 1 is the whole image", full.sx === 0 && full.sy === 0 && full.sw === 49 && full.sh === 49);
}

// ---------------------------------------------------------------- zoom and pan
{
  // the point under the cursor stays under the cursor, except where the edge of the image stops the view from moving that far
  let worst = 0, free = 0;
  for (let i = 0; i < 2000; i++) {
    const v = randomView(), x = rnd() * W, y = rnd() * H, factor = Math.exp((rnd() - 0.5) * 1.5);
    const before = canvasToFrac(v, x, y, W, H), after = zoomAt(v, factor, x, y, W, H), now = canvasToFrac(after, x, y, W, H);
    const wantCx = before.fx - (x / W - 0.5) / after.zoom, wantCy = before.fy - (y / H - 0.5) / after.zoom;
    const half = 0.5 / after.zoom;
    const isFree = wantCx >= half && wantCx <= 1 - half && wantCy >= half && wantCy <= 1 - half;
    if (isFree) { free++; worst = Math.max(worst, Math.hypot(now.fx - before.fx, now.fy - before.fy)); }
  }
  check("zoomAt: the image point under the cursor stays under the cursor (where the edge does not stop it)", free > 300 && worst < 1e-12, `${free} cases, worst ${worst.toExponential(1)}`);

  const corner = zoomAt(createView(), 2, 0, 0, W, H);
  check("zooming x2 about the top-left corner shows the top-left quarter", near(corner.zoom, 2) && near(corner.cx, 0.25) && near(corner.cy, 0.25));
  check("zoomAt cannot go past the zoom limits", zoomAt({ zoom: 30, cx: .5, cy: .5 }, 10, 256, 256, W, H).zoom === MAX_ZOOM && zoomAt({ zoom: 1.2, cx: .5, cy: .5 }, 0.01, 256, 256, W, H).zoom === MIN_ZOOM);
  const back = zoomAt({ zoom: 4, cx: 0.2, cy: 0.8 }, 1 / 4, 100, 400, W, H);
  check("zooming all the way out gives the whole image again", back.zoom === 1 && back.cx === 0.5 && back.cy === 0.5);
  check("zoomTo sets the zoom level about the middle", (() => { const z = zoomTo(createView(), 8, W, H); return z.zoom === 8 && near(z.cx, 0.5) && near(z.cy, 0.5); })());
  check("ZOOM_STEP is 1.5 (one press changes the zoom by half)", ZOOM_STEP === 1.5);

  const v = { zoom: 4, cx: 0.5, cy: 0.5 };
  const dragged = panBy(v, 100, 0, W, H);
  check("panBy: dragging the picture to the right shows what was further left (the centre moves left)", dragged.cx < 0.5 && near(dragged.cx, 0.5 - 100 / (W * 4)) && dragged.cy === 0.5);
  check("panBy: you cannot drag past the edge", panBy(v, 1e6, -1e6, W, H).cx === 0.125 && panBy(v, 1e6, -1e6, W, H).cy === 0.875);
  check("panBy at zoom 1 does nothing", (() => { const p = panBy(createView(), 80, 40, W, H); return p.cx === 0.5 && p.cy === 0.5; })());
  const key = panStep(v, 1, -1);
  check("panStep moves 15 % of the field on screen: right and up", near(key.cx, 0.5 + 0.15 / 4) && near(key.cy, 0.5 - 0.15 / 4));
  check("centreOn keeps the zoom and clamps at the edge", (() => { const c = centreOn(v, 0.02, 0.5); return c.zoom === 4 && c.cx === 0.125 && c.cy === 0.5; })());
}

// ---------------------------------------------------------------- centring on a candidate
{
  const whole = createView();
  const c = centreAndZoom(whole, 0.6, 0.45, 6);
  check("centreAndZoom: zooms in to at least the given zoom and puts the point in the middle of the canvas",
    c.zoom === 6 && near(c.cx, 0.6) && near(c.cy, 0.45) && near(fracToCanvas(c, 0.6, 0.45, W, H).x, W / 2) && near(fracToCanvas(c, 0.6, 0.45, W, H).y, H / 2));
  check("centreAndZoom: a view that is already closer stays as close (it never zooms out)", centreAndZoom({ zoom: 12, cx: 0.5, cy: 0.5 }, 0.3, 0.3, 6).zoom === 12);
  const edge = centreAndZoom(whole, 0.99, 0.01, 6);
  check("centreAndZoom: near the edge the view stops at the edge, and the point is still on screen", near(edge.cx, 1 - 0.5 / 6) && near(edge.cy, 0.5 / 6) && fracToCanvas(edge, 0.99, 0.01, W, H).x < W && fracToCanvas(edge, 0.99, 0.01, W, H).y > 0);
  check("centreAndZoom: a point off the image is clamped, not followed", (() => { const o = centreAndZoom(whole, 3, -2, 6); return o.cx === 1 - 0.5 / 6 && o.cy === 0.5 / 6; })());
  check("centreAndZoom: the zoom limit holds", centreAndZoom(whole, 0.5, 0.5, 1000).zoom === MAX_ZOOM);

  const path = [{ fx: 0.40, fy: 0.50 }, { fx: 0.42, fy: 0.52 }, { fx: 0.46, fy: 0.50 }, { fx: 0.44, fy: 0.56 }];
  const now = pathCentre(path, 2, true);
  check("pathCentre: one image at a time -> where the candidate is on the image shown", now.fx === 0.46 && now.fy === 0.50);
  const mid = pathCentre(path, 2, false);
  check("pathCentre: stack or trail -> the middle of the box around its whole path", near(mid.fx, 0.43) && near(mid.fy, 0.53));
  check("pathCentre: an index past the end falls back to the first point; no points or bad numbers give null",
    pathCentre(path, 99, true).fx === 0.40 && pathCentre([], 0, true) === null && pathCentre(undefined, 0, true) === null && pathCentre([{ fx: NaN, fy: 0.5 }], 0, true) === null);
}

// ---------------------------------------------------------------- THE claim: the sky mapping does not change with zoom and pan
{
  // a cutout like the real ones: 49 x 49 pixels of 6.14 arcsec around Barnard's Star's field
  const geo = { ra: 269.4462, dec: 4.769, n: 49, scaleArcsec: 6.14 };
  let worstDeg = 0, worstPx = 0;
  for (let i = 0; i < 3000; i++) {
    const star = { ra: geo.ra + (rnd() - 0.5) * 0.08, dec: geo.dec + (rnd() - 0.5) * 0.08 };
    const f = skyToCanvas(star.ra, star.dec, geo);
    const v = randomView();
    const c = fracToCanvas(v, f.fx, f.fy, W, H);                          // where the star is drawn on this view
    const g = canvasToFrac(v, c.x, c.y, W, H);                            // the viewer turns the pixel under the cursor back into an image fraction
    const sky = canvasToSky(g.fx, g.fy, geo);
    worstDeg = Math.max(worstDeg, Math.abs(sky.ra - star.ra), Math.abs(sky.dec - star.dec));
    worstPx = Math.max(worstPx, Math.hypot(g.fx - f.fx, g.fy - f.fy) * geo.n);
  }
  check("sky -> screen -> sky returns the star's own RA/Dec at any zoom and pan (3000 random views)", worstDeg < 1e-10, `worst ${(worstDeg * 3600).toExponential(1)} arcsec`);
  check("... and its image pixel position to far better than a thousandth of a pixel", worstPx < 1e-9, `worst ${worstPx.toExponential(1)} px`);

  // arcsec per canvas pixel really is scale * n / (W * zoom)
  const v = { zoom: 8, cx: 0.4, cy: 0.55 };
  const a = canvasToFrac(v, 200, 300, W, H), b = canvasToFrac(v, 201, 300, W, H);
  const dEast = canvasToSky(a.fx, a.fy, geo).eastArcsec - canvasToSky(b.fx, b.fy, geo).eastArcsec;
  check("one canvas pixel at zoom 8 is scale * n / (W * zoom) arcsec on the sky", near(dEast, geo.scaleArcsec * geo.n / (W * 8), 1e-9), `${dEast.toFixed(5)}″`);
  // north up, east left stays true on a zoomed view
  const tl = canvasToFrac(v, 0, 0, W, H), br = canvasToFrac(v, W, H, W, H);
  const s1 = canvasToSky(tl.fx, tl.fy, geo), s2 = canvasToSky(br.fx, br.fy, geo);
  check("north is still up and east still left on a zoomed view", s1.dec > s2.dec && s1.ra > s2.ra);
}

// ---------------------------------------------------------------- pixels
{
  check("pixelOf: pixel ix covers [ix/n, (ix+1)/n)", pixelOf(0, 0, 49).ix === 0 && pixelOf(1 / 49 - 1e-9, 0.5, 49).ix === 0 && pixelOf(1 / 49 + 1e-9, 0.5, 49).ix === 1);
  check("pixelOf: the centre of a 49 px cutout is pixel 24", pixelOf(0.5, 0.5, 49).ix === 24 && pixelOf(0.5, 0.5, 49).iy === 24);
  check("pixelOf: 1.0 and negative fractions are outside the image", !pixelOf(1, 0.5, 49).inside && !pixelOf(-0.001, 0.5, 49).inside && pixelOf(0.999, 0.999, 49).inside);
}

// ---------------------------------------------------------------- scale bar and zoom label
{
  const perPx = (zoom) => 6.14 * 49 / (W * zoom);
  const b1 = scaleBar(perPx(1));
  check("scale bar at zoom 1 of a 5′ cutout: 1′, about 100 canvas pixels", b1.label === "1′" && b1.arcsec === 60 && near(b1.px, 60 / perPx(1)) && b1.px <= 140, `${b1.label} ${b1.px.toFixed(0)} px`);
  const b8 = scaleBar(perPx(8)), b32 = scaleBar(perPx(32));
  check("scale bar at zoom 8 and 32: 10″ and 2″", b8.label === "10″" && b32.label === "2″", `${b8.label} ${b32.label}`);
  check("scale bar: never longer than the limit, never missing for a usable zoom", [1, 2, 3, 5, 8, 13, 21, 32].every((z) => { const b = scaleBar(perPx(z)); return b && b.px <= 140 && b.px > 20; }));
  check("scale bar: nonsense gives null (no bar), not NaN", scaleBar(0) === null && scaleBar(NaN) === null && scaleBar(-1) === null && scaleBar(1e-6) === null);
  check("scale bar: a 30′ field in a small canvas uses arcminutes", scaleBar(1800 / 512 * 0.9).label.endsWith("′"));
  check("zoomLabel", zoomLabel(1) === "×1" && zoomLabel(1.5) === "×1.5" && zoomLabel(2.25) === "×2.3" && zoomLabel(12) === "×12");
}

// ---------------------------------------------------------------- layers
{
  const ids = LAYERS.map((l) => l.id);
  check("layers: ids and checkbox ids are unique", new Set(ids).size === ids.length && new Set(LAYERS.map((l) => l.checkbox)).size === ids.length);
  check("layers: every colour is a hex colour and comes from OVERLAY_COLORS", LAYERS.every((l) => /^#[0-9A-F]{6}$/i.test(l.color) && Object.values(OVERLAY_COLORS).includes(l.color)));
  check("layers: every swatch shape is one the CSS draws", LAYERS.every((l) => ["square", "ring", "diamond", "bar", "cross"].includes(l.swatch)));
  const html = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  const missing = LAYERS.filter((l) => !html.includes(`id="${l.checkbox}"`)).map((l) => l.checkbox);
  check("layers: every layer has its checkbox in index.html", missing.length === 0, missing.join(", "));
  const missingRow = LAYERS.filter((l) => !html.includes(`data-layer="${l.id}"`)).map((l) => l.id);
  check("layers: every layer has its row (data-layer) in the layer list", missingRow.length === 0, missingRow.join(", "));

  const state = {
    tracks: [{}, {}], catalogue: [{}, {}, {}], candidates: [{}], marker: { fx: .5, fy: .5, rPx: 2 },
    asteroids: [[{ name: "A" }, { name: "B" }], [{ name: "A" }], null], isAnimated: true, index: 0,
  };
  const c = layerCounts(state);
  check("layerCounts: objects per layer; asteroids on this date when animated", c.tracks === 2 && c.catalogue === 3 && c.candidates === 1 && c.marker === 1 && c.asteroids === 2, JSON.stringify(c));
  check("layerCounts: flags, grid and scale bar have no count", c.flags === null && c.grid === null && c.scalebar === null);
  check("layerCounts: not animated -> each asteroid once over all dates", layerCounts({ ...state, isAnimated: false }).asteroids === 2 && layerCounts({ ...state, isAnimated: true, index: 2 }).asteroids === 0);
  const empty = layerCounts({});
  check("layerCounts: an empty player gives zeros, not errors", empty.tracks === 0 && empty.marker === 0 && empty.asteroids === 0);
}

// ---------------------------------------------------------------- readout
{
  const geo = { ra: 269.4462, dec: 4.769, n: 49, scaleArcsec: 6.14 };
  const mid = describePoint(0.5, 0.5, geo);
  check("readout: the middle of the cutout is the requested RA/Dec, pixel 24, offsets 0", mid.inside && mid.ix === 24 && mid.iy === 24 && near(mid.ra, geo.ra) && near(mid.dec, geo.dec) && near(mid.east, 0) && near(mid.north, 0));
  const tl = describePoint(0, 0, geo);
  check("readout: the top-left corner is north-east of the centre by half the cutout", near(tl.north, 24.5 * 6.14, 1e-9) && near(tl.east, 24.5 * 6.14, 1e-9) && tl.ix === 0 && tl.iy === 0);
  const sky = canvasToSky(0.3, 0.7, geo), d = describePoint(0.3, 0.7, geo);
  check("readout: gives exactly the position that clicking would measure (same conversion)", d.ra === sky.ra && d.dec === sky.dec);
  check("readout: outside the image is said so", !describePoint(1.2, 0.5, geo).inside && readoutParts(describePoint(1.2, 0.5, geo)).pixel === "outside the image");
  const parts = readoutParts(mid, { text: "1.23 MJy/sr" });
  check("readoutParts: pixel, sky, offset and value as text", parts.pixel === "pixel 24, 24" && parts.sky === "RA 17h57m47.09s  Dec +04°46′08.4″" && parts.offset === "E +0.0″  N +0.0″" && parts.value === "1.23 MJy/sr", JSON.stringify(parts));
  check("readoutParts: a minus sign is a real minus, and no value gives an empty string", readoutParts(describePoint(0.6, 0.6, geo)).offset.includes("−") && readoutParts(mid).value === "");
  check("cleanUnit", cleanUnit("MJy / sr") === "MJy/sr" && cleanUnit(undefined) === "" && cleanUnit(null) === "");
  check("formatValue: three significant digits and the unit", formatValue(1.234567, "MJy / sr") === "1.23 MJy/sr" && formatValue(-0.5, "") === "-0.500");
  check("formatValue: very large and very small numbers use a power of ten", formatValue(12345, "MJy/sr") === "1.23e+4 MJy/sr" && formatValue(0.001234, "") === "1.23e-3");
  check("formatValue: no data (NaN, undefined) is said, never shown as a number", formatValue(NaN) === "no data" && formatValue(undefined) === "no data" && formatValue(Infinity) === "no data");
  check("formatValue: zero is zero", formatValue(0, "MJy/sr") === "0.00 MJy/sr");
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
