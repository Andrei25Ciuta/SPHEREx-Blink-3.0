// Tests for the coordinate grid of the viewer (js/features/grid.js): where the RA and Dec lines are, how fine they are at each zoom, what is written
// on them, and how good the flat-sky mapping they rest on is. Run: node scratch/test_grid.mjs
import { gridLines, raLabel, decLabel } from "../frontend/js/features/grid.js";
import { createView, clampView, canvasToFrac, zoomAt } from "../frontend/js/features/view.js";
import { canvasToSky, skyToCanvas } from "../frontend/js/geometry.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const W = 512, H = 512;
let seed = 777;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const randomView = () => clampView({ zoom: 1 + rnd() * 31, cx: rnd(), cy: rnd() });
const arcsecOf = (text) => (text.endsWith("′") ? 60 : 1) * parseFloat(text);        // "1′" -> 60, "30″" -> 30

// ---------------------------------------------------------------- labels
{
  check("raLabel: hours, minutes, seconds of time", raLabel(64670, 5) === "17h57m50s" && raLabel(64665, 5) === "17h57m45s");
  check("raLabel: a step under a second gets decimals", raLabel(64670.5, 0.5) === "17h57m50.5s" && raLabel(0.04, 0.05) === "00h00m00.04s" && raLabel(86399.97, 0.05) === "23h59m59.97s");
  check("raLabel: a step of a minute or more drops the seconds, an hour drops the minutes", raLabel(64680, 60) === "17h58m" && raLabel(64800, 3600) === "18h");
  check("raLabel: wraps at 24 h, never negative or 24h", raLabel(86400, 1) === "00h00m00s" && raLabel(-1, 1) === "23h59m59s" && raLabel(86399.6, 1) === "00h00m00s");
  check("decLabel: degrees, arcminutes, arcseconds", decLabel(17160, 60) === "+04°46′" && decLabel(17168.4, 0.5) === "+04°46′08.4″" && decLabel(17170, 10) === "+04°46′10″");
  check("decLabel: a real minus sign, and no negative zero", decLabel(-17160, 60) === "−04°46′" && decLabel(-0.2, 0.5) === "−00°00′00.2″" && decLabel(-0.04, 1) === "+00°00′00″" && decLabel(0, 1) === "+00°00′00″");
  check("decLabel: rounding carries (59.96″ at 0.5″ steps is 1′)", decLabel(59.96, 0.5) === "+00°01′00.0″");
  check("decLabel: an hour of arc is whole degrees", decLabel(18000, 3600) === "+05°");
}

// ---------------------------------------------------------------- one grid, worked out by hand
{
  const geo = { ra: 269.4462, dec: 4.769, n: 49, scaleArcsec: 6.14 };
  const g = gridLines(createView(), geo, W, H);
  // 0.5876 arcsec per canvas pixel. Dec: the first round step with 64 px between lines is 60″; RA: 14.95″ per second of time, 96 px = 56″ -> 5 s
  check("the whole 5′ cutout: Dec lines every 1′, RA lines every 5 s", g.decStep === "1′" && g.raStep === "5 s", `${g.decStep}, ${g.raStep}`);
  const raLabels = g.raLines.map((l) => l.label).join(" "), decLabels = g.decLines.map((l) => l.label).join(" ");
  check("Dec lines are +04°44′ … +04°48′ (south to north in the order of the Dec values) and RA lines 17h57m40s … 17h57m55s", decLabels === "+04°44′ +04°45′ +04°46′ +04°47′ +04°48′" && raLabels === "17h57m40s 17h57m45s 17h57m50s 17h57m55s", `${decLabels} | ${raLabels}`);
  const ra50 = g.raLines.find((l) => l.label === "17h57m50s"), dec46 = g.decLines.find((l) => l.label === "+04°46′");
  // 17h57m50s is 2.912 s after the centre = 43.53″ east = 74.08 canvas px to the LEFT of the middle; +04°46′ is 8.4″ south = 14.30 px below it
  check("the lines are where the arithmetic puts them (east is left, north is up)", near(ra50.x, 256 - 74.08, 0.05) && near(dec46.y, 256 + 14.30, 0.05), `x ${ra50.x.toFixed(2)}, y ${dec46.y.toFixed(2)}`);
  check("a larger RA is further to the left (east is left)", g.raLines.every((l, i, a) => i === 0 || l.x < a[i - 1].x));
  check("a larger Dec is higher up (north is up)", g.decLines.every((l, i, a) => i === 0 || l.y < a[i - 1].y));
}

// ---------------------------------------------------------------- every line is exactly where its label says, at any zoom and pan
{
  const geo = { ra: 269.4462, dec: 4.769, n: 49, scaleArcsec: 6.14 };
  let worstRa = 0, worstDec = 0, tooClose = 0, outside = 0, tooMany = 0, tooFew = 0, lines = 0;
  for (let i = 0; i < 1500; i++) {
    const v = randomView();
    const g = gridLines(v, geo, W, H);
    lines += g.raLines.length + g.decLines.length;
    if (g.raLines.length < 2 || g.decLines.length < 2) tooFew++;
    if (g.raLines.length > 24 || g.decLines.length > 24) tooMany++;
    for (const l of g.raLines) {
      if (l.x < 0 || l.x > W) outside++;
      const f = canvasToFrac(v, l.x, H / 2, W, H), sky = canvasToSky(f.fx, f.fy, geo);
      worstRa = Math.max(worstRa, Math.abs(sky.ra - l.deg));
    }
    for (const l of g.decLines) {
      if (l.y < 0 || l.y > H) outside++;
      const f = canvasToFrac(v, W / 2, l.y, W, H), sky = canvasToSky(f.fx, f.fy, geo);
      worstDec = Math.max(worstDec, Math.abs(sky.dec - l.deg));
    }
    const xs = g.raLines.map((l) => l.x).sort((a, b) => a - b), ys = g.decLines.map((l) => l.y).sort((a, b) => a - b);
    for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] < 96 - 1e-6) tooClose++;
    for (let k = 1; k < ys.length; k++) if (ys[k] - ys[k - 1] < 64 - 1e-6) tooClose++;
  }
  check("every RA line sits at the RA it is labelled with, to under a milli-arcsecond (1500 random views)", worstRa * 3600 < 1e-3, `worst ${(worstRa * 3600).toExponential(1)}″`);
  check("every Dec line sits at the Dec it is labelled with, to under a milli-arcsecond", worstDec * 3600 < 1e-3, `worst ${(worstDec * 3600).toExponential(1)}″`);
  check("neighbouring lines are never closer than the minimum (96 px for RA, 64 px for Dec)", tooClose === 0, `${tooClose} too close`);
  check("no line outside the canvas, never more than 24 per direction, at least 2 per direction at every zoom", outside === 0 && tooMany === 0 && tooFew === 0, `${lines} lines, ${outside} outside, ${tooMany} too many, ${tooFew} too few`);
}

// ---------------------------------------------------------------- finer when zoomed in, coarser for a big field
{
  const small = { ra: 269.4462, dec: 4.769, n: 49, scaleArcsec: 6.14 };
  const deep = gridLines(zoomAt(createView(), 32, 256, 256, W, H), small, W, H);
  check("zoom x32 on a 5′ cutout: Dec lines every 2″, RA lines every 0.2 s, with decimals", deep.decStep === "2″" && deep.raStep === "0.2 s" && /^\+04°4\d′\d\d″$/.test(deep.decLines[0].label) && /^17h57m\d\d\.\ds$/.test(deep.raLines[0].label), `${deep.decStep}, ${deep.raStep}, ${deep.decLines[0].label}, ${deep.raLines[0].label}`);
  const wide = gridLines(createView(), { ra: 269.4462, dec: 4.769, n: 290, scaleArcsec: 6.2 }, W, H);
  check("a 30′ field: Dec lines every 5′, RA lines every 30 s", wide.decStep === "5′" && wide.raStep === "30 s", `${wide.decStep}, ${wide.raStep}`);
  const steps = [1, 2, 4, 8, 16, 32].map((z) => arcsecOf(gridLines(zoomAt(createView(), z, 256, 256, W, H), small, W, H).decStep));
  check("the Dec step never grows as the zoom grows, and is smaller at x32 than at x1", steps.every((s, i) => i === 0 || s <= steps[i - 1]) && steps.at(-1) < steps[0], steps.join(" "));
}

// ---------------------------------------------------------------- awkward places
{
  const around0 = gridLines(createView(), { ra: 0.003, dec: 4.769, n: 49, scaleArcsec: 6.14 }, W, H);
  check("across RA = 0: labels stay valid (00h or 23h), degrees stay in [0, 360)", around0.raLines.length >= 2 && around0.raLines.every((l) => /^(23|00)h\d\dm\d\ds$/.test(l.label) && l.deg >= 0 && l.deg < 360), around0.raLines.map((l) => l.label).join(" "));
  const labelsNear360 = gridLines(createView(), { ra: 359.998, dec: -30.2, n: 49, scaleArcsec: 6.14 }, W, H);
  check("RA near 360 and a southern Dec: lines are found, Dec labels start with a minus", labelsNear360.raLines.length >= 2 && labelsNear360.decLines.every((l) => l.label.startsWith("−30°")), `${labelsNear360.raLines.map((l) => l.label).join(" ")} | ${labelsNear360.decLines.map((l) => l.label).join(" ")}`);
  const pole = gridLines(createView(), { ra: 10, dec: 89.99, n: 49, scaleArcsec: 6.14 }, W, H);
  check("at a pole there are no RA lines (they would all meet), but Dec lines remain", pole.raLines.length === 0 && pole.raStep === "" && pole.decLines.length >= 2);
  const none = gridLines(createView(), { ra: 10, dec: 10, n: 49, scaleArcsec: 0 }, W, H);
  check("no pixel scale: no lines, no error", none.raLines.length === 0 && none.decLines.length === 0);
}

// ---------------------------------------------------------------- how good is the flat-sky mapping the grid rests on?
// geometry.js maps RA/Dec to the image with a flat approximation. The images are TAN (gnomonic) projections. The difference, for a point at the edge or corner of a field:
{
  const D2R = Math.PI / 180, ARC = 206264.806;
  function worstErrorPx(dec0, n, scale) {
    const geo = { ra: 100, dec: dec0, n, scaleArcsec: scale };
    const half = (n * scale) / 2 / ARC;                                   // radians, offset of the edge from the centre
    let worst = 0;
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [0, 1]]) {
      const xi = sx * half, eta = sy * half;                              // TAN offsets (east, north) of a point at the edge or corner
      const rho = Math.hypot(xi, eta), c = Math.atan(rho), d0 = dec0 * D2R;
      const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (eta * Math.sin(c) * Math.cos(d0)) / rho);
      const ra = geo.ra * D2R + Math.atan2(xi * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - eta * Math.sin(d0) * Math.sin(c));
      const flat = skyToCanvas(ra / D2R, dec / D2R, geo);                 // where the flat mapping puts it
      const trueFx = 0.5 - (xi * ARC) / (scale * n), trueFy = 0.5 - (eta * ARC) / (scale * n);
      worst = Math.max(worst, Math.hypot(flat.fx - trueFx, flat.fy - trueFy) * n);
    }
    return worst;
  }
  const e5_5 = worstErrorPx(5, 49, 6.14), e5_60 = worstErrorPx(60, 49, 6.14), e30_5 = worstErrorPx(5, 290, 6.2), e30_60 = worstErrorPx(60, 290, 6.2);
  check("flat-sky error at the corner of a 5′ cutout: under 0.05 pixel at Dec 5° and at Dec 60°", e5_5 < 0.05 && e5_60 < 0.05, `${e5_5.toFixed(4)} px, ${e5_60.toFixed(4)} px`);
  check("flat-sky error at the corner of a 30′ cutout: under 0.1 pixel at Dec 5°, about a pixel at Dec 60° (a 30′ field far from the equator is only good to about a pixel)", e30_5 < 0.1 && e30_60 > 0.3 && e30_60 < 3, `${e30_5.toFixed(3)} px, ${e30_60.toFixed(3)} px`);
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
