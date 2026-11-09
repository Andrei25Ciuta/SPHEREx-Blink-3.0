// check_survey_live.mjs – does the page's "which survey images cover this place" agree with IRSA's own answer?   (needs the network and a running backend; NOT part of the test_*.mjs set)
//
//   node scratch/check_survey_live.mjs [--api http://localhost:8003]
//
// For each position, two numbers of images that cover the POINT:
//   IRSA   SELECT COUNT(*) FROM spherex.plane WHERE 1=CONTAINS(POINT('ICRS', ra, dec), poly)       IRSA's own point-in-polygon, asked directly (Node has no CORS limit)
//   page   the backend's /api/survey (a circle of 6') and covers() of surveyCoverage.js            the gnomonic point-in-polygon of the page
// They must be equal. A position whose list was cut off by the limit is reported and not compared (a cut-off list is not a count). Only catalogue queries are made: no FITS file is downloaded.
// The positions are the test objects of the app plus three places chosen for their geometry: across RA 0, near a pole, and on the ecliptic where the survey is dense.

import { TARGETS } from "../frontend/js/targets.js";
import { covers, coverage } from "../frontend/js/features/surveyCoverage.js";

const api = process.argv.includes("--api") ? process.argv[process.argv.indexOf("--api") + 1] : "http://localhost:8003";
const TAP = "https://irsa.ipac.caltech.edu/TAP/sync";
const positions = [...TARGETS.map((t) => ({ name: t.label, ra: t.ra, dec: t.dec })),
  { name: "across RA 0 (0.3, +10)", ra: 0.3, dec: 10 }, { name: "near the north pole (100, +85)", ra: 100, dec: 85 }, { name: "on the ecliptic (90, +23.4)", ra: 90, dec: 23.4 }];

async function irsaCount(ra, dec) {
  const body = new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv", QUERY: `SELECT COUNT(*) AS n FROM spherex.plane WHERE 1=CONTAINS(POINT('ICRS', ${ra.toFixed(6)}, ${dec.toFixed(6)}), poly)` });
  const text = await (await fetch(TAP, { method: "POST", body, signal: AbortSignal.timeout(120000) })).text();
  const n = Number(text.trim().split("\n")[1]);
  if (!Number.isInteger(n)) throw new Error(`IRSA did not answer with a count: ${text.slice(0, 120)}`);
  return n;
}

let mismatches = 0, compared = 0;
console.log(`Backend ${api}\n`);
console.log("| position | RA, Dec | IRSA: images covering the point | page: images covering the point | passes (30-day rule) | same? |\n|---|---|---|---|---|---|");
for (const p of positions) {
  try {
    const theirs = await irsaCount(p.ra, p.dec);
    const answer = await (await fetch(`${api}/api/survey?ra=${p.ra.toFixed(6)}&dec=${p.dec.toFixed(6)}&radius=0.1&limit=1000`, { signal: AbortSignal.timeout(150000) })).json();
    if (!Array.isArray(answer.planes)) throw new Error(`the backend said: ${JSON.stringify(answer).slice(0, 120)}`);
    const mine = answer.planes.filter((pl) => covers(pl, p.ra, p.dec)).length, c = coverage(answer.planes, p.ra, p.dec);
    const same = answer.truncated ? "cut off, not compared" : mine === theirs ? "yes" : "**NO**";
    if (!answer.truncated) { compared++; if (mine !== theirs) mismatches++; }
    console.log(`| ${p.name} | ${p.ra.toFixed(3)}, ${p.dec.toFixed(3)} | ${theirs} | ${mine} | ${c.passes.length} | ${same} |`);
  } catch (err) {
    mismatches++;
    console.log(`| ${p.name} | ${p.ra.toFixed(3)}, ${p.dec.toFixed(3)} | error | error | – | ${err.message} |`);
  }
}
console.log(`\n${compared} positions compared, ${mismatches} mismatch${mismatches === 1 ? "" : "es"} or error${mismatches === 1 ? "" : "s"}.`);
process.exitCode = mismatches ? 1 : 0;
