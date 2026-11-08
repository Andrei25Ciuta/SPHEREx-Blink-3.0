// Tests for frontend/js/features/skybot.js (known asteroids at the date of each image).
// Run: node scratch/test_skybot.mjs
import { skybotUrl, parseSkybot, fetchSkybot, fetchSkybotForFrames, fieldRadiusDeg, asteroidPoints, matchAsteroids, MAX_POSITION_ERROR_ARCSEC } from "../frontend/js/features/skybot.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

// A real answer of the service (2026-11-07, cone of 0.2 deg around Barnard's Star, JD 2460908.5), the fields we read.
const REAL = [{ "Name": "2015 RW209", "RA (hms)": "17 57 41.8259", "DEC (dms)": "+04 49 46.203", "Class": "MB>Outer", "VMag (mag)": 22.6, "Err (arcsec)": 0.128,
  "d (arcsec)": 231.571, "dRA (arcsec/h)": 0.908, "dDEC (arcsec/h)": -23.7555, "dg (ua)": 2.2012644319, "dh (ua)": 2.81395902859 }];
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

// ---------------------------------------------------------------- request
{
  const url = new URL(skybotUrl(269.4462, 4.769, 0.2, 60908));
  check("URL: the documented endpoint over https", url.origin + url.pathname === "https://ssp.imcce.fr/webservices/skybot/api/conesearch.php");
  check("URL: epoch is the Julian date (MJD + 2400000.5)", url.searchParams.get("-ep") === "2460908.50000", url.searchParams.get("-ep"));
  check("URL: position, radius, JSON, geocentric", url.searchParams.get("-ra") === "269.446200" && url.searchParams.get("-dec") === "4.769000" && url.searchParams.get("-rd") === "0.20000"
    && url.searchParams.get("-mime") === "json" && url.searchParams.get("-loc") === "500");
  check("search circle covers the half-diagonal of a square field (0.707 x field)", fieldRadiusDeg(30) > 0.707 * 30 / 60 && fieldRadiusDeg(5) === 5 * 0.75 / 60);
}

// ---------------------------------------------------------------- parsing
{
  const [a] = parseSkybot(REAL);
  check("parse: name, class, magnitude", a.name === "2015 RW209" && a.cls === "MB>Outer" && a.vmag === 22.6);
  check("parse: RA 17h57m41.8259s = 269.42427 deg", Math.abs(a.ra - 269.42427) < 1e-4, a.ra.toFixed(5));
  check("parse: Dec +4d49m46.203s = 4.82950 deg", Math.abs(a.dec - 4.82950) < 1e-4, a.dec.toFixed(5));
  check("parse: -23.76 arcsec/h in Dec is 570 arcsec/day: a 5 arcmin field is crossed in about half a day", Math.abs(a.rateArcsecPerDay - 570.6) < 0.5, a.rateArcsecPerDay.toFixed(1));
  const south = parseSkybot([{ Name: "x", "RA (hms)": "00 00 10.0", "DEC (dms)": "-00 30 00.0" }, { Name: "y", "RA (hms)": "23 59 59.9", "DEC (dms)": "-56 47 02.5" }]);
  check("parse: a negative declination with 0 degrees keeps its sign (-0 30 00 = -0.5 deg)", Math.abs(south[0].dec + 0.5) < 1e-9, south[0].dec);
  check("parse: -56 47 02.5 = -56.78403, RA 23h59m59.9s = 359.99958", Math.abs(south[1].dec + 56.78403) < 1e-4 && Math.abs(south[1].ra - 359.99958) < 1e-4);
  check("parse: rows without a position are dropped, a non-array is an empty list", parseSkybot([{ Name: "z" }, ...REAL]).length === 1 && parseSkybot(null).length === 0 && parseSkybot({}).length === 0);
}

// ---------------------------------------------------------------- one request, every kind of answer
{
  check("fetch: a normal answer is parsed", (await fetchSkybot(1, 2, 0.1, 60908, { fetchFn: async () => response(200, REAL) }))[0].name === "2015 RW209");
  check("fetch: HTTP 204 = no body in the circle = empty list", (await fetchSkybot(1, 2, 0.1, 60908, { fetchFn: async () => response(204, "") })).length === 0);
  check("fetch: an empty JSON array is also a valid empty field", (await fetchSkybot(1, 2, 0.1, 60908, { fetchFn: async () => response(200, []) })).length === 0);
  const fails = async (fetchFn) => { try { await fetchSkybot(1, 2, 0.1, 60908, { fetchFn }); return null; } catch (e) { return e.message; } };
  check("fetch: HTTP 400 shows the service's own message", /HTTP 400.*epoch cannot be empty/.test(await fails(async () => response(400, { flag: -1, status: 400, message: "Skybot.conesearch -> Bad request: epoch cannot be empty or null" }))));
  check("fetch: HTTP 403 (the old address) says so", /HTTP 403/.test(await fails(async () => response(403, "<html>403 Forbidden</html>"))));
  check("fetch: a blocked network says 'did not answer'", /did not answer.*network or blocked/.test(await fails(async () => { throw new TypeError("Failed to fetch"); })));
  check("fetch: a timeout says 'too slow'", /too slow/.test(await fails(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); })));
  check("fetch: not JSON", /not JSON/.test(await fails(async () => response(200, "<html>oops</html>"))));
  check("fetch: an error object inside HTTP 200", /reported: boom/.test(await fails(async () => response(200, { status: 500, message: "boom" }))));
  check("fetch: an unexpected success object is a service error", /unexpected|invalid/i.test(await fails(async () => response(200, { message: "changed schema" }))));
  check("fetch: nonempty rows with no usable coordinates are a service error", /unusable|invalid/i.test(await fails(async () => response(200, [{ Name: "x", ra: 10, dec: 2 }]))));
}

// ---------------------------------------------------------------- many dates
const FRAMES = Array.from({ length: 9 }, (_, k) => ({ mjd: 60900 + k * 3 }));
const QUERY = { ra: 269.4462, dec: 4.769, fovArcmin: 5 };
{
  let inFlight = 0, peak = 0, calls = 0;
  const slow = async () => { calls++; inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return response(200, REAL); };
  const cache = new Map(), progress = [];
  const r = await fetchSkybotForFrames(FRAMES, QUERY, { fetchFn: slow, cache, onProgress: (d, n) => progress.push(`${d}/${n}`) });
  check("many dates: one request per image date, 4 at a time", calls === 9 && peak <= 4 && peak >= 2, `${calls} calls, at most ${peak} at once`);
  check("many dates: every frame has its answer, progress reaches 9/9", r.perFrame.every((p) => p?.[0].name === "2015 RW209") && progress.at(-1) === "9/9" && r.failures === 0);
  await fetchSkybotForFrames(FRAMES, QUERY, { fetchFn: slow, cache });
  check("many dates: the second time everything comes from the cache", calls === 9);
  let n = 0;
  const flaky = async () => { n++; return n === 3 ? response(503, "busy") : response(200, REAL); };
  const part = await fetchSkybotForFrames(FRAMES, QUERY, { fetchFn: flaky });
  check("many dates: one failed request leaves that frame null and counts it", part.failures === 1 && part.perFrame.filter((p) => p === null).length === 1 && /HTTP 503/.test(part.firstError));
  let threw = "";
  try { await fetchSkybotForFrames(FRAMES, QUERY, { fetchFn: async () => { throw new TypeError("Failed to fetch"); } }); } catch (e) { threw = e.message; }
  check("many dates: if EVERY request fails it throws the first reason", /did not answer/.test(threw), threw);
  let after = 0;
  await fetchSkybotForFrames(FRAMES, QUERY, { fetchFn: async () => { after++; return response(200, REAL); }, shouldStop: () => after >= 2, concurrency: 1 });
  check("many dates: it stops asking when the field changed (shouldStop)", after === 2, `${after} request(s)`);
}

// ---------------------------------------------------------------- on the image
const GEO = { ra: 269.4462, dec: 4.769, n: 100, scaleArcsec: 6.2 };
{
  const objects = parseSkybot(REAL);
  const perFrame = [objects, null, objects];
  // the service says this body is 231.571 arcsec from the centre of the cone: our projection must agree
  const wide = asteroidPoints([objects], { ...GEO, n: 200 }, 1)[0];
  const d = Math.hypot((wide[0].fx - 0.5) * 200, (wide[0].fy - 0.5) * 200) * GEO.scaleArcsec;
  check("projection agrees with the service's own distance from the cone centre (231.57 arcsec)", Math.abs(d - 231.571) < 2, `${d.toFixed(1)} arcsec`);
  check("it is west and north of the centre... RA 269.424 < 269.446 means WEST (right of centre), Dec +0.06 deg means north (above)", wide[0].fx > 0.5 && wide[0].fy < 0.5, `fx ${wide[0].fx.toFixed(3)}, fy ${wide[0].fy.toFixed(3)}`);
  const pts = asteroidPoints(perFrame, { ...GEO, n: 49 });                  // a 5 arcmin field: half-width 152 arcsec, the body is 231 arcsec away
  check("a body outside the image is left out; a frame without an answer stays null", pts[0].length === 0 && pts[1] === null && pts[2].length === 0);
  check("the same body inside a 10 arcmin field is kept", asteroidPoints(perFrame, { ...GEO, n: 100 })[0].length === 1);
  const centre = asteroidPoints([[{ ...objects[0], ra: GEO.ra, dec: GEO.dec }]], GEO)[0];
  check("a body at the field centre is at (0.5, 0.5)", centre.length === 1 && Math.abs(centre[0].fx - 0.5) < 1e-6 && Math.abs(centre[0].fy - 0.5) < 1e-6);
  const unsure = asteroidPoints([[{ ...objects[0], ra: GEO.ra, dec: GEO.dec, errArcsec: MAX_POSITION_ERROR_ARCSEC + 1 }]], GEO)[0];
  check("a body whose position is uncertain by more than 30 arcsec is not drawn (it could not be matched)", unsure.length === 0);
}

// ---------------------------------------------------------------- does a candidate sit on a body?
{
  const at = (fx, fy) => ({ name: "A", fx, fy, vmag: 19, cls: "MB>Inner" });
  const points = [[at(0.50, 0.50)], [at(0.20, 0.80)], [at(0.505, 0.50), { ...at(0.9, 0.1), name: "B" }], [], null];
  const track = [{ fx: 0.5, fy: 0.5 }, { fx: 0.5, fy: 0.5 }, { fx: 0.5, fy: 0.5 }, { fx: 0.5, fy: 0.5 }, { fx: 0.5, fy: 0.5 }];
  const m = matchAsteroids(track, points, GEO, { radiusArcsec: 20 });
  check("a candidate on a body on two dates: 2 hits, the other body is not matched", m.length === 1 && m[0].name === "A" && m[0].hits === 2 && JSON.stringify(m[0].frames) === "[0,2]", JSON.stringify(m));
  check("nearest distance is reported (0.005 x 100 px x 6.2 = 3.1 arcsec)", Math.abs(m[0].nearestArcsec - 0) < 0.01 || m[0].nearestArcsec < 3.2, m[0].nearestArcsec.toFixed(2));
  check("with a 2 arcsec radius the 3.1 arcsec miss does not count", matchAsteroids(track, points, GEO, { radiusArcsec: 2 }).every((x) => x.hits === 1));
  check("nothing matches an empty sky", matchAsteroids(track, [[], [], [], [], null], GEO).length === 0);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
