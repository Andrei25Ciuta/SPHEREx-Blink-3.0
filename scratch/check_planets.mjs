// Are the positions of the planets in the Solar System simulator right?  Compared with JPL Horizons.   Run:   node scratch/check_planets.mjs [--dates 60909,61114,61271,61306,61041] [--json]
//
// frontend/js/features/solarSystem.js takes the planets from the Keplerian elements of JPL's table of approximate positions (written from memory) and the Earth from parallax.js. Here the
// same positions are asked of JPL Horizons (an ephemeris query: vectors, heliocentric, ecliptic J2000, in AU; one request per planet; no file is downloaded) on a few dates and the
// difference is printed in AU and as an angle seen from the Sun. The default dates are the survey passes of the Barnard D2 field and 1 Jan 2026.
// Needs the internet (ssd.jpl.nasa.gov). With --json it prints the Horizons numbers as a JSON object (what scratch/test_solarsystem.mjs keeps, so that the test needs no network).

import { position, PLANETS } from "../frontend/js/features/solarSystem.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]] : acc), []));
const mjds = (args.dates ?? "60909,61114,61271,61306,61041").split(",").map(Number);
const ID = { Mercury: 199, Venus: 299, Earth: 399, Mars: 499, Jupiter: 599, Saturn: 699, Uranus: 799, Neptune: 899 };
const jd = (mjd) => mjd + 2400000.5;

async function horizons(planet) {
  const url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + new URLSearchParams({
    format: "json", COMMAND: `'${ID[planet]}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'VECTORS'", CENTER: "'500@10'", REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'ICRF'",
    OUT_UNITS: "'AU-D'", VEC_TABLE: "'1'", CSV_FORMAT: "'YES'", TLIST: `'${mjds.map((m) => jd(m).toFixed(4)).join(" ")}'`,
  });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Horizons answered HTTP ${r.status} for ${planet}`);
  const text = (await r.json()).result;
  const body = text.slice(text.indexOf("$$SOE") + 5, text.indexOf("$$EOE")).trim().split("\n");
  // the answer is matched to the dates by the Julian date it prints (it need not come back in the order that was asked)
  const byJd = body.map((line) => { const c = line.split(",").map((s) => s.trim()); return { jd: Number(c[0]), v: [Number(c[2]), Number(c[3]), Number(c[4])] }; });
  return mjds.map((m) => { const hit = byJd.find((x) => Math.abs(x.jd - jd(m)) < 1e-3); if (!hit) throw new Error(`Horizons did not answer for MJD ${m}`); return hit.v; });
}

const reference = {};
const rows = [];
for (const planet of PLANETS) {
  const ref = await horizons(planet);
  reference[planet] = ref;
  mjds.forEach((mjd, k) => {
    const mine = position(planet, mjd), r = ref[k];
    const diff = Math.hypot(mine[0] - r[0], mine[1] - r[1], mine[2] - r[2]);
    const lonMine = Math.atan2(mine[1], mine[0]), lonRef = Math.atan2(r[1], r[0]);
    const dLon = Math.abs(((lonMine - lonRef + Math.PI * 3) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI) * 3600;
    rows.push({ planet, mjd, rRef: Math.hypot(...r), diffAU: diff, diffArcsec: dLon });
  });
}
if (args.json) { console.log(JSON.stringify({ mjds, reference }, null, 0)); process.exit(0); }
console.log(`Positions of the planets in the simulator against JPL Horizons (heliocentric, ecliptic J2000), MJD ${mjds.join(", ")}\n`);
console.log("| planet | distance from the Sun (AU) | largest difference (AU) | largest difference seen from the Sun (arcsec) |\n|---|---|---|---|");
for (const planet of PLANETS) {
  const own = rows.filter((x) => x.planet === planet);
  console.log(`| ${planet} | ${own[0].rRef.toFixed(2)} | ${Math.max(...own.map((x) => x.diffAU)).toFixed(5)} | ${Math.max(...own.map((x) => x.diffArcsec)).toFixed(0)} |`);
}
