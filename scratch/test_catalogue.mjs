// Tests for frontend/js/features/catalogue.js (SIMBAD objects moved to each image's date)
// and for matchKnownObject() with catalogue objects.  Run: node scratch/test_catalogue.mjs
import { catalogueQuery, catalogueUrl, parseCatalogueCsv, fetchCatalogue, catalogueTracks, totalMotion } from "../frontend/js/features/catalogue.js";
import { matchKnownObject } from "../frontend/js/features/movers.js";
import { TARGETS } from "../frontend/js/targets.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

// A real answer of SIMBAD (7 Nov 2026) around Barnard's Star: the star, its planets (same position), one faint star.
const CSV = `main_id,ra,dec,pmra,pmdec,otype,sp_type
"GAT  771",269.44389907959,4.79628913665,-6.159,0.513,"*",
"NAME Barnard's Star c",269.4520769586187,4.693364966576667,-801.551,10362.394,"Pl",
"NAME Barnard's Star b",269.4520769586187,4.693364966576667,-801.551,10362.394,"Pl",
"NAME Barnard's star",269.4520769586187,4.693364966576667,-801.551,10362.394,"BY*","M4V"
"Odd, name ""x""",270.1,4.8,,,"?",
`;

// ---------------------------------------------------------------- the query
const q = catalogueQuery(269.4462, 4.769, 3);
check("the query asks for the field AND, in a wider circle, only the fast objects",
  q.includes("CIRCLE('ICRS', 269.446200, 4.769000, 0.03750)") && q.includes("CIRCLE('ICRS', 269.446200, 4.769000, 0.13750)")
  && q.includes("pmra*pmra + pmdec*pmdec > 250000") && q.startsWith("SELECT TOP 800 main_id, ra, dec, pmra, pmdec, otype, sp_type FROM basic"), q.slice(0, 90));
check("the wide circle is big enough for Barnard's Star (4.5' away in the year 2000)", 0.1375 * 60 > 4.5 + 1.5);
const url = catalogueUrl(269.4462, 4.769, 3);
check("the request is a CSV TAP query to the Harvard mirror", url.startsWith("https://simbad.harvard.edu/simbad/sim-tap/sync?") && url.includes("FORMAT=csv") && url.includes("LANG=ADQL"));

// ---------------------------------------------------------------- parsing
const objects = parseCatalogueCsv(CSV);
check("planets are dropped and each position is listed once", objects.length === 3, objects.map((o) => o.label).join(" | "));
const barnard = objects.find((o) => o.label === "Barnard's star");
check("a star keeps its coordinates, proper motion and type", barnard && barnard.pmdec === 10362.394 && barnard.otype === "BY*" && barnard.spType === "M4V");
check("names are tidied (double spaces, NAME prefix)", objects[0].label === "GAT 771" && objects[0].id === "GAT 771");
check("quoted names with commas and quotes survive, unknown motion is null",
  objects.at(-1).id === 'Odd, name "x"' && objects.at(-1).pmra === null && objects.at(-1).pmdec === null);
check("an empty or header-only answer gives no objects", parseCatalogueCsv("").length === 0 && parseCatalogueCsv("main_id,ra,dec\n").length === 0);
check("total motion in arcsec per year", Math.abs(totalMotion(barnard) - 10.393) < 0.01 && totalMotion(objects.at(-1)) === 0);

// ---------------------------------------------------------------- fetching (fake network)
const fakeFetch = (body, init = {}) => async () => ({ ok: init.ok ?? true, status: init.status ?? 200, text: async () => body });
check("fetchCatalogue parses a good answer", (await fetchCatalogue(269.4462, 4.769, 3, { fetchFn: fakeFetch(CSV) })).length === 3);
check("fetchCatalogue accepts an empty table with the expected schema", (await fetchCatalogue(1, 2, 3, { fetchFn: fakeFetch("main_id,ra,dec,pmra,pmdec,otype,sp_type\n") })).length === 0);
check("fetchCatalogue handles a UTF-8 BOM on the header", (await fetchCatalogue(1, 2, 3, { fetchFn: fakeFetch("\uFEFF" + CSV) })).length === 3);
for (const [name, fetchFn, expected] of [
  ["a TAP error comes back as a readable message", fakeFetch('<?xml version="1.0"?><VOTABLE><INFO name="QUERY_STATUS" value="ERROR">Incorrect ADQL query</INFO></VOTABLE>'), /Incorrect ADQL query/],
  ["an HTTP error comes back as a readable message", fakeFetch("", { ok: false, status: 503 }), /HTTP 503/],
  ["a network failure comes back as a readable message", async () => { throw new TypeError("Failed to fetch"); }, /did not answer/],
  ["a successful response with the wrong CSV columns is a service error", fakeFetch("error,message\n0,invalid query\n"), /unrecognised CSV|invalid CSV/i],
  ["a successful HTML response is a service error", fakeFetch("<html>maintenance</html>"), /SIMBAD reported an error/],
]) {
  let message = "";
  try { await fetchCatalogue(1, 2, 3, { fetchFn }); } catch (e) { message = e.message; }
  check(name, expected.test(message), message);
}

// ---------------------------------------------------------------- moving objects to the date of each image
{
  const geo = { ra: 269.4462, dec: 4.769, n: 30, scaleArcsec: 6.138 };       // the 3' cutout around Barnard's Star in 2026
  const frames = [{ mjd: 60908.98 }, { mjd: 61305.63 }];                     // 2025-08-21 and 2026-09-22
  const far = { id: "far", label: "far", ra: 10, dec: -30, pmra: 0, pmdec: 0, otype: "*" };
  const still = { id: "still", label: "still", ra: 269.4462, dec: 4.769, pmra: 0, pmdec: 0, otype: "*" };
  const tracks = catalogueTracks([...objects.slice(0, 1), barnard, far, still], frames, geo);
  const labels = tracks.map((t) => t.label);
  check("Barnard's Star (catalogued 4.5' away in the year 2000) lands inside the field on both dates", labels.includes("Barnard's star"));
  check("an object far from the field is left out", !labels.includes("far"));
  const b = tracks.find((t) => t.label === "Barnard's star");
  const inside = b.points.every((p) => p.fx > 0.2 && p.fx < 0.8 && p.fy > 0.2 && p.fy < 0.8);
  check("... near the middle of the 3' image", inside, JSON.stringify(b.points.map((p) => [+p.fx.toFixed(2), +p.fy.toFixed(2)])));
  const yPx = (b.points[1].fy - b.points[0].fy) * geo.n;
  check("it moves north (up, smaller y) by about 1.7 px/yr x 1.09 yr", yPx < -1.4 && yPx > -2.4, `${yPx.toFixed(2)} px`);
  const s = tracks.find((t) => t.label === "still");
  check("a still star stays where it is", Math.abs(s.points[1].fx - s.points[0].fx) < 1e-9 && Math.abs(s.points[1].fy - s.points[0].fy) < 1e-9);
  check("each track knows its motion for the label", Math.abs(b.pm - 10.39) < 0.05 && s.pm === 0);
  check("only objects moving more than 1 arcsec/yr are marked as moving", b.moving === true && s.moving === false);
}

// ---------------------------------------------------------------- Find movers: "known" can now be any catalogue object
{
  const geo = { ra: 269.4462, dec: 4.769, n: 30, scaleArcsec: 6.138 };
  const mjdRef = 61107;                                                       // 2026-03-08
  const dt = 2000 + (mjdRef - 51544.5) / 365.25 - 2000;
  const cosd = Math.cos((4.7 * Math.PI) / 180);
  const ra = barnard.ra + (barnard.pmra * dt) / 3.6e6 / cosd, dec = barnard.dec + (barnard.pmdec * dt) / 3.6e6;
  const x = geo.n / 2 - ((ra - geo.ra) * cosd * 3600) / geo.scaleArcsec;       // the same flat conversion as geometry.js
  const y = geo.n / 2 - ((dec - geo.dec) * 3600) / geo.scaleArcsec;
  const candidate = { x, y, mjdRef };
  const hit = matchKnownObject(candidate, geo, [barnard], { maxDistPx: 3 });
  check("a candidate on a SIMBAD object's moved position is matched (object without a 'type')", hit?.target.label === "Barnard's star" && hit.distPx < 1, hit ? `${hit.distPx.toFixed(2)} px` : "no match");
  check("a candidate elsewhere matches nothing", matchKnownObject({ x: x + 10, y, mjdRef }, geo, [barnard]) === null);
  const variable = { ...barnard, label: "a variable", type: "variable" };
  check("test objects typed 'variable' are still ignored", matchKnownObject(candidate, geo, [variable]) === null);
  const both = matchKnownObject(candidate, geo, [...TARGETS, barnard]);
  check("test objects and catalogue objects can be searched together", both !== null && both.distPx < 1, both?.target.label);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
