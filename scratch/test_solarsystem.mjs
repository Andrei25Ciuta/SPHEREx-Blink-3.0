// Tests for the Solar System simulator (frontend/js/features/solarSystem.js): the planets against JPL Horizons, the Earth against the one the parallax search uses, the body that
// swings, the scales.   Run: node scratch/test_solarsystem.mjs
//
// REFERENCE below = what JPL Horizons gave for the vectors of the eight planets (heliocentric, ecliptic J2000, AU) on five dates, fetched on 8 Nov 2026 with
//   node scratch/check_planets.mjs --json
// (the file needs no network: the numbers are kept here, to 8 decimals). `node scratch/check_planets.mjs` makes the live comparison and prints the table of docs/VALIDATION.md section 17.
import {
  ELEMENTS, PLANETS, RANGES_AU, solveKepler, planetPosition, earthPosition, position, equatorialToEcliptic, sightLine, periodYears, bodyAt, screenRadius, mjdLabel, MJD_J2000,
} from "../frontend/js/features/solarSystem.js";
import { earthPositionAU, parallaxOffsetArcsec } from "../frontend/js/features/parallax.js";
import { readFileSync } from "node:fs";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

const HORIZONS = { mjds: [60909, 61114, 61271, 61306, 61041], reference: {
  Mercury: [[0.23066995, 0.21721914, -0.00340543], [-0.39386712, -0.11503711, 0.02672342], [-0.08705581, 0.30009717, 0.03250956], [-0.1938269, -0.42128929, -0.01665237], [-0.2152013, -0.40920762, -0.01370327]],
  Venus: [[0.31126036, 0.65071979, -0.00902003], [0.60776775, 0.3923969, -0.02967692], [0.19321407, -0.70130158, -0.02078336], [0.68587662, -0.23903296, -0.04285822], [0.08887725, -0.72176238, -0.01504406]],
  Earth: [[0.86537928, -0.52368785, 2.486e-05], [-0.98900092, 0.10313083, 9.6e-07], [0.83597816, -0.57055942, 3.215e-05], [1.00355662, -0.00655947, -4.98e-06], [-0.17428148, 0.96775892, -5.945e-05]],
  Mars: [[-1.3278567, -0.8758085, 0.01420857], [1.18338103, -0.71281337, -0.04395539], [0.68020128, 1.34018571, 0.01140664], [0.23418285, 1.53023524, 0.02632593], [0.34057968, -1.38700202, -0.03741723]],
  Jupiter: [[-0.71436132, 5.11418047, -0.00526133], [-2.2114803, 4.74844053, 0.02975355], [-3.23580093, 4.18809415, 0.05499919], [-3.44401405, 4.03376097, 0.06029883], [-1.69400369, 4.92888236, 0.01742622]],
  Saturn: [[9.54013003, -0.47691855, -0.37144647], [9.46484045, 0.6635759, -0.38831251], [9.31440761, 1.53111341, -0.39743431], [9.26989341, 1.72295647, -0.39900488], [9.50734165, 0.25773904, -0.38293568]],
  Uranus: [[10.32912058, 16.55512858, -0.07244855], [9.629144, 16.9303465, -0.06197805], [9.08212665, 17.19817868, -0.05388849], [8.95894967, 17.25554566, -0.05207775], [9.88031093, 16.80001212, -0.06571964]],
  Neptune: [[29.88004856, 0.10207438, -0.6906622], [29.86527264, 0.74936412, -0.70365706], [29.84462903, 1.24459985, -0.71338821], [29.83892932, 1.35493642, -0.71553118], [29.87212236, 0.51893834, -0.69906749]],
} };
const BOUND_AU = { Mercury: 0.0003, Venus: 0.0003, Earth: 0.0006, Mars: 0.0008, Jupiter: 0.005, Saturn: 0.02, Uranus: 0.012, Neptune: 0.01 };      // about 1.5 times the largest difference measured (VALIDATION 17)

// ---------------------------------------------------------------- Kepler
{
  check("kepler: a circular orbit has E = M", near(solveKepler(1.234, 0), 1.234, 1e-12));
  let worst = 0;
  for (const e of [0.01, 0.2, 0.5, 0.9, 0.99]) for (let M = -3; M <= 3; M += 0.37) { const E = solveKepler(M, e); worst = Math.max(worst, Math.abs(E - e * Math.sin(E) - M)); }
  check("kepler: E - e sin E = M to 1e-12 for e from 0.01 to 0.99 and M over the whole orbit", worst < 1e-12, worst.toExponential(2));
}

// ---------------------------------------------------------------- the planets against Horizons
{
  const worst = {};
  for (const planet of PLANETS) {
    worst[planet] = 0;
    HORIZONS.mjds.forEach((mjd, k) => {
      const mine = position(planet, mjd), ref = HORIZONS.reference[planet][k];
      worst[planet] = Math.max(worst[planet], Math.hypot(mine[0] - ref[0], mine[1] - ref[1], mine[2] - ref[2]));
    });
  }
  check("planets: all eight are within their bound of JPL Horizons on five dates (the bound is about 1.5 times the largest difference measured)", PLANETS.every((p) => worst[p] < BOUND_AU[p]),
    PLANETS.map((p) => `${p} ${worst[p].toFixed(5)}`).join(", "));
  check("planets: the elements are right, not only close: no planet is farther than 0.015 AU from Horizons (the 1.5 AU of a wrong constant would show)", PLANETS.every((p) => worst[p] < 0.015));
  check("planets: every planet is where it should be in the sky of the Sun: the direction (longitude) agrees to 6 arcmin", PLANETS.every((p) => HORIZONS.mjds.every((mjd, k) => {
    const mine = position(p, mjd), ref = HORIZONS.reference[p][k];
    const d = Math.abs(((Math.atan2(mine[1], mine[0]) - Math.atan2(ref[1], ref[0]) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI) * 60;
    return d < 6;
  })));
  check("planets: the distance from the Sun of each is what Horizons gives to 0.5 %", PLANETS.every((p) => HORIZONS.mjds.every((mjd, k) => {
    const mine = position(p, mjd), ref = HORIZONS.reference[p][k];
    return Math.abs(Math.hypot(...mine) / Math.hypot(...ref) - 1) < 0.005;
  })));
  check("planets: an unknown name is an error, not a position", (() => { try { planetPosition("Pluto", 60000); return false; } catch { return true; } })() && Object.keys(ELEMENTS).length === 7);
  check("planets: the same date gives the same place (no state)", JSON.stringify(planetPosition("Mars", 60909)) === JSON.stringify(planetPosition("Mars", 60909)));
}

// ---------------------------------------------------------------- the Earth is the Earth of the parallax search
{
  const mjds = [60909, 61000, 61100, 61200, 61300, 60000, 62000];
  const rot = (m) => equatorialToEcliptic(earthPositionAU(m));
  check("earth: the simulator's Earth is the Earth of the parallax search (parallax.js earthPositionAU) turned into ecliptic axes: the same to 1e-12 AU, whatever the date",
    mjds.every((m) => { const a = earthPosition(m), b = rot(m); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-12; }));
  const radii = Array.from({ length: 366 }, (_, i) => Math.hypot(...earthPosition(60909 + i)));
  check("earth: its distance from the Sun stays between 0.983 and 1.017 AU over a year (perihelion early January, aphelion early July) and it lies in the ecliptic (|z| < 0.0001 AU)",
    Math.min(...radii) > 0.983 && Math.max(...radii) < 1.017 && Array.from({ length: 366 }, (_, i) => Math.abs(earthPosition(60909 + i)[2])).every((z) => z < 1e-4));
  const e0 = earthPosition(MJD_J2000), e1 = earthPosition(MJD_J2000 + 365.25);
  check("earth: it comes back to the same place after a year (within 0.01 AU)", Math.hypot(e1[0] - e0[0], e1[1] - e0[1], e1[2] - e0[2]) < 0.01);
}

// ---------------------------------------------------------------- a body that swings
{
  check("sight line: a unit vector; the equatorial pole is the ecliptic pole tilted by the obliquity; RA 0 Dec 0 is the x axis", near(Math.hypot(...sightLine(123.4, -56.7)), 1, 1e-12) && near(sightLine(0, 0)[0], 1, 1e-12)
    && near(sightLine(10, 90)[2], Math.cos(23.4392911 * Math.PI / 180), 1e-9) && near(sightLine(10, 90)[1], Math.sin(23.4392911 * Math.PI / 180), 1e-9));        // the north equatorial pole is at ecliptic longitude 90, latitude 66.56: y = cos(66.56) = sin(23.44) > 0
  const ra = 136.5, dec = 16.6, ref = 60908 + 198.5;
  const b = bodyAt(ref, ra, dec, 500);
  check("body: the angle seen from the Earth of the reference date is 0, and the body is 500 AU from that Earth", near(b.swingArcsec(ref), 0, 1e-6) && (() => { const e = earthPosition(ref); return near(Math.hypot(b.body[0] - e[0], b.body[1] - e[1], b.body[2] - e[2]), 500, 1e-9); })());
  const dates = [60909, 61114, 61271, 61306], worst = Math.max(...dates.map((m) => {
    const par = parallaxOffsetArcsec(ra, dec, m, ref, 500), mine = b.swingArcsec(m);
    return Math.abs(Math.hypot(par.east, par.north) - mine) / Math.max(1, mine);
  }));
  check("body: the swing (the angle between the two lines of sight from two Earths) is the parallax of the search (parallaxOffsetArcsec) to 0.3 %, on the dates of the Barnard D2 passes (angles of up to several hundred arcsec)", worst < 0.003, worst.toExponential(2));
  check("body: farther means a smaller swing, in proportion (500 AU swings about twice as much as 1000 AU)", near(bodyAt(ref, ra, dec, 500).swingArcsec(61114) / bodyAt(ref, ra, dec, 1000).swingArcsec(61114), 2, 0.02));
}

// ---------------------------------------------------------------- scales, time, words
{
  check("scale: true is linear (half of the range is half of the radius), educational is the square root (a quarter of the range is half of the radius), both reach 1 at the edge and 0 at the Sun",
    screenRadius("true", 1, 2) === 0.5 && screenRadius("educational", 0.5, 2) === 0.5 && screenRadius("true", 2, 2) === 1 && screenRadius("educational", 2, 2) === 1 && screenRadius("true", 0, 2) === 0 && screenRadius("educational", -1, 2) === 0);
  check("scale: educational spreads the inner planets out: Mercury and Earth are drawn farther apart than to scale", screenRadius("educational", 0.39, 35) > 3 * screenRadius("true", 0.39, 35));
  check("period: derived from Kepler's third law: Earth 1 year, Mars 1.88, Jupiter 11.9, Neptune 165", periodYears("Earth") === 1 && near(periodYears("Mars"), 1.881, 0.005) && near(periodYears("Jupiter"), 11.86, 0.05) && near(periodYears("Neptune"), 164.9, 0.5));
  check("dates: MJD 60909 is 22 Aug 2025 and MJD 61041 is 1 Jan 2026; J2000 is 1 Jan 2000", mjdLabel(60909) === "22 Aug 2025" && mjdLabel(61041) === "1 Jan 2026" && mjdLabel(MJD_J2000 - 0.5) === "1 Jan 2000");
  check("ranges: four, in growing order, the last one far enough for a Planet X", RANGES_AU.length === 4 && RANGES_AU.every((r, i) => i === 0 || r.maxAU > RANGES_AU[i - 1].maxAU) && RANGES_AU.at(-1).maxAU >= 1000 && RANGES_AU[2].maxAU > 30.1);
}

// ---------------------------------------------------------------- Workspace removal and standalone simulator
{
  const HTML = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  const MAIN = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
  const standalone = readFileSync(new URL("../frontend/simulator.html", import.meta.url), "utf8");
  check("page: the embedded Solar System panel and its Workspace wiring are removed; the standalone Simulator remains", !HTML.includes('id="solar-system"') && !MAIN.includes("setupSolarSystem") && standalone.includes('id="scene"') && standalone.includes('src="js/simulator.js'));
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
