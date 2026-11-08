// Tests for the sky explorer (frontend/js/features/skyExplorer.js): the Hammer map, the ecliptic and the galactic plane, the fields made of footprints.
// Everything here is synthetic or textbook; the real footprints come from the backend (backend/tests/test_footprints.py).   Run: node scratch/test_sky.mjs
import { readFileSync } from "node:fs";
import {
  hammer, inverseHammer, separationDeg, eclipticLine, galacticLine, pathSegments, groupFields, nearestField, fieldText, suggestedFov, fieldOffsets, MAP_HALF_WIDTH, MAP_HALF_HEIGHT,
} from "../frontend/js/features/skyExplorer.js";
import { mulberry32 } from "../frontend/js/features/planetLab.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// ---------------------------------------------------------------- the map
{
  const c = hammer(180, 0), np = hammer(0, 90), sp = hammer(123, -90), right = hammer(0, 0), left = hammer(359.999999, 0);
  check("hammer: RA 180, Dec 0 is the middle; the poles are at the top and bottom of the ellipse; RA 0 is the right edge and RA 360 the left one (RA grows to the left)",
    near(c.x, 0) && near(c.y, 0) && near(np.x, 0) && near(np.y, MAP_HALF_HEIGHT) && near(sp.x, 0) && near(sp.y, -MAP_HALF_HEIGHT) && near(right.x, MAP_HALF_WIDTH) && near(right.y, 0) && near(left.x, -MAP_HALF_WIDTH, 1e-5));
  check("hammer: east is to the left: a larger RA gives a smaller x, and north is up", hammer(100, 10).x > hammer(110, 10).x && hammer(100, 20).y > hammer(100, 10).y);
  const rng = mulberry32(7);
  let worst = 0;
  for (let i = 0; i < 3000; i++) {
    const ra = rng() * 360, dec = Math.asin(2 * rng() - 1) * 180 / Math.PI;
    const p = hammer(ra, dec), back = inverseHammer(p.x, p.y);
    if (!back) { worst = Infinity; break; }
    worst = Math.max(worst, separationDeg(ra, dec, back.ra, back.dec));
  }
  check("hammer: 3000 random sky positions go to the map and back to within 1e-6 degrees", worst < 1e-6, `${worst.toExponential(2)}`);
  check("hammer: a point outside the ellipse is no position", inverseHammer(2.7, 1.3) === null && inverseHammer(0, 1.5) === null && inverseHammer(MAP_HALF_WIDTH * 1.01, 0) === null && inverseHammer(0, 0) !== null);
  const area = (a, b) => { let n = 0, tot = 0; for (let i = 0; i < 40000; i++) { const x = (rng() * 2 - 1) * MAP_HALF_WIDTH, y = (rng() * 2 - 1) * MAP_HALF_HEIGHT; tot++; const s = inverseHammer(x, y); if (s && s.dec >= a && s.dec < b) n++; } return n / tot; };
  const frac = area(-30, 30) / area(-90, 90);
  check("hammer: equal area: the band of |Dec| < 30 deg is half of the sky (sin 30 = 0.5), and so it is half of the map", near(frac, 0.5, 0.02), frac.toFixed(3));
}
check("separation: a degree on the equator, on the same RA, and across RA 0", near(separationDeg(10, 0, 11, 0), 1, 1e-9) && near(separationDeg(5, 10, 5, 12), 2, 1e-9) && near(separationDeg(359.5, 0, 0.5, 0), 1, 1e-9) && separationDeg(1, 2, 1, 2) === 0);

// ---------------------------------------------------------------- the ecliptic and the galactic plane
{
  const e = eclipticLine(361);
  check("ecliptic: longitude 0 is RA 0, Dec 0; longitude 90 is RA 90, Dec +23.44; longitude 270 is RA 270, Dec -23.44", near(e[0].ra, 0, 1e-9) && near(e[0].dec, 0, 1e-9) && near(e[90].ra, 90, 1e-7) && near(e[90].dec, 23.4392911, 1e-7) && near(e[270].ra, 270, 1e-7) && near(e[270].dec, -23.4392911, 1e-7));
  check("ecliptic: never farther from the equator than the obliquity", e.every((p) => Math.abs(p.dec) <= 23.4392911 + 1e-9));
  const g = galacticLine(361);
  check("galactic plane: l = 0 is the Galactic centre (RA 266.405, Dec -28.936) and l = 180 the anticentre (RA 86.405, Dec +28.936), to 0.01 deg", angDiff(g[0].ra, 266.405) < 0.01 && near(g[0].dec, -28.936, 0.01) && angDiff(g[180].ra, 86.405) < 0.01 && near(g[180].dec, 28.936, 0.01), JSON.stringify([g[0], g[180]]));
  check("galactic plane: every point is 90 degrees from the north galactic pole (RA 192.85948, Dec 27.12825)", g.every((p) => near(separationDeg(p.ra, p.dec, 192.85948, 27.12825), 90, 1e-6)));
  const seg = pathSegments(g), segE = pathSegments(e);
  check("path: a great circle is cut where it crosses the edge of the map (the galactic plane crosses RA 0), so no line is drawn across the whole map; the ecliptic, which starts on the edge, is one piece",
    seg.length === 2 && seg.every((s) => s.every((p, i) => i === 0 || Math.abs(p.x - s[i - 1].x) < 1.5)) && seg.flat().length >= 355 && segE.length === 1 && segE[0].length >= 355 && segE[0].every((p, i) => i === 0 || Math.abs(p.x - segE[0][i - 1].x) < 1.5));
}

// ---------------------------------------------------------------- fields
const fp = (ra, dec, detector = "D2", dateISO = "2026-01-01T00:00:00Z", widthArcmin = 5, corners = null) => ({
  id: `${ra}${dec}${dateISO}`, detector, dateISO, widthArcmin, centre: [ra, dec],
  corners: corners ?? [[ra + 0.04, dec - 0.04], [ra - 0.04, dec - 0.04], [ra - 0.04, dec + 0.04], [ra + 0.04, dec + 0.04]],
});
{
  const list = [fp(269.4, 4.8, "D2", "2025-08-21T10:00:00Z"), fp(269.45, 4.78, "D2", "2026-09-22T00:00:00Z"), fp(269.38, 4.82, "D6", "2025-08-15T00:00:00Z", 5.03), fp(133.8, -7.2, "D2"), fp(331.1, -56.8, "D2"), fp(0.1, 10, "D1", "2026-02-02T00:00:00Z", 30), fp(359.9, 10.1, "D1", "2026-03-03T00:00:00Z", 30)];
  const fields = groupFields(list);
  check("fields: images of nearly the same place are one field, the biggest field first, ids F1, F2, ...", fields.length === 4 && fields[0].count === 3 && fields[0].id === "F1" && fields.map((f) => f.id).join() === "F1,F2,F3,F4" && fields[1].count === 2);
  const barnard = fields[0];
  check("fields: the centre is the mean direction of the images, the detectors are counted, the dates run from the first to the last, the widths from the narrowest to the widest",
    near(barnard.ra, 269.41, 0.05) && near(barnard.dec, 4.8, 0.05) && barnard.detectors.D2 === 2 && barnard.detectors.D6 === 1 && barnard.firstDate === "2025-08-15" && barnard.lastDate === "2026-09-22" && barnard.minWidthArcmin === 5 && barnard.maxWidthArcmin === 5.03);
  const wrapped = fields.find((f) => f.count === 2 && f.footprints.some((p) => p.detector === "D1"));
  check("fields: two images either side of RA 0 are one field (the centre is not the mean of 0.1 and 359.9)", Boolean(wrapped) && (wrapped.ra > 359.9 || wrapped.ra < 0.1) && near(wrapped.dec, 10.05, 0.05), JSON.stringify([wrapped?.ra, wrapped?.dec]));
  check("fields: a smaller radius makes more fields; a bigger one fewer; nothing and junk give nothing", groupFields(list, 0.01).length > 4 && groupFields(list, 200).length === 1 && groupFields([]).length === 0 && groupFields(undefined).length === 0 && groupFields([{ centre: [NaN, 1] }]).length === 0);
  check("fields: the nearest to a position, within a limit; none far away", nearestField(fields, 270, 5)?.id === "F1" && nearestField(fields, 134, -7)?.count === 1 && nearestField(fields, 50, 60) === null && nearestField([], 1, 1) === null);
  const t = fieldText(barnard), t1 = fieldText(fields.find((f) => f.count === 1));
  check("field text: '3 images (D2 ×2, D6 ×1), 5.0′ wide, 2025-08-15 to 2026-09-22' (one width when they round to the same), and for one image 'image' with one date",
    t === "3 images (D2 ×2, D6 ×1), 5.0′ wide, 2025-08-15 to 2026-09-22" && t1.startsWith("1 image (") && !/ to /.test(t1) && fieldText({ ...barnard, minWidthArcmin: 5, maxWidthArcmin: 30 }).includes("5.0–30.0′ wide"), `${t} | ${t1}`);
  check("field of view: the narrowest image of the field, whole arcminutes, between 1 and 30", suggestedFov(barnard) === 5 && suggestedFov({ minWidthArcmin: 29.9 }) === 29 && suggestedFov({ minWidthArcmin: 0.4 }) === 1 && suggestedFov({ minWidthArcmin: 90 }) === 30);
}
{
  const f = groupFields([fp(100, 0, "D2", "2026-01-01T00:00:00Z", 5, [[100.0417, -0.0417], [99.9583, -0.0417], [99.9583, 0.0417], [100.0417, 0.0417]])])[0];
  const off = fieldOffsets(f);
  check("offsets: the corners of an image as arcminutes from the centre: ±2.5′; a corner east of the centre (larger RA) is on the LEFT (negative x), north is positive y",
    off.length === 1 && off[0].polygon.length === 4 && off[0].polygon.every(([x, y]) => near(Math.abs(x), 2.5, 0.02) && near(Math.abs(y), 2.5, 0.02)) && off[0].polygon[0][0] < 0 && off[0].polygon[0][1] < 0 && off[0].polygon[2][0] > 0 && off[0].polygon[2][1] > 0 && off[0].detector === "D2");
  const high = groupFields([fp(10, 60, "D2", "2026-01-01T00:00:00Z", 5, [[10.0833, 60], [9.9167, 60], [9.9167, 60.0833], [10.0833, 60.0833]])])[0];
  check("offsets: at Dec 60 a degree of RA is half as long on the sky: 0.1667 deg of RA is 5 arcmin of sky", near(Math.abs(fieldOffsets(high)[0].polygon[0][0] - fieldOffsets(high)[0].polygon[1][0]), 5, 0.05));
  const across = groupFields([fp(359.99, 0, "D2", "2026-01-01T00:00:00Z", 5, [[0.02, 0], [359.96, 0], [359.96, 0.05], [0.02, 0.05]])])[0];
  check("offsets: across RA 0 the corners are close to the centre, not 360 degrees away", fieldOffsets(across)[0].polygon.every(([x]) => Math.abs(x) < 5));
}

// ---------------------------------------------------------------- the page
{
  const HTML = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  const MAIN = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
  const wired = [...(/setupSkyExplorer\(\{\s*els: \{([\s\S]*?)\},\s*/.exec(MAIN)?.[1] ?? "").matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]);
  check("page: main.js wires the sky explorer to ids that exist in index.html, and its section comes after the Planet X Lab", wired.length >= 6 && wired.every((id) => HTML.includes(`id="${id}"`)) && HTML.indexOf('id="sky-explorer"') > HTML.indexOf('id="planet-lab"') && HTML.indexOf('id="sky-explorer"') < HTML.indexOf("</main>"), wired.filter((id) => !HTML.includes(`id="${id}"`)).join(", "));
  check("page: the section says what the map shows and what it does not (the files on the server, not the survey; nothing invented)", /files? (on|of) (this|the) (server|backend|machine)|image files this backend has/i.test(HTML.slice(HTML.indexOf('id="sky-explorer"'))) && /not (the )?(sky coverage|coverage|footprint) of (SPHEREx|the survey)|not of the SPHEREx survey|not the survey/i.test(HTML.slice(HTML.indexOf('id="sky-explorer"'))));
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
