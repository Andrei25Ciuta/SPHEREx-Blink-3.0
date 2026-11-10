// Tests for frontend/js/features/catalogueRelay.js (the four catalogues of the cross-match, failures tolerated). No network: fetch is replaced.
// Run: node scratch/test_catalogue_relay.mjs
import { radiiFor, relayUrl, fetchRelayRows, fetchAllCatalogues, FAST_PM_MAS, MAX_RADIUS_ARCMIN } from "../frontend/js/features/catalogueRelay.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

const API = "http://localhost:8001";
const SIMBAD_CSV = 'main_id,ra,dec,pmra,pmdec,otype,sp_type\n"* Barnard Star",269.452,4.693,-798.6,10328.1,PM*,M4V\n';
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => (typeof body === "string" ? JSON.parse(body) : body) });
const row = (id, ra, dec, extra = {}) => ({ id, ra, dec, pmra: null, pmdec: null, epochMjd: 55355, mags: { W1: 15 }, ...extra });

/** A fake fetch that records every call and how many were in flight at the same time. */
function fakeNetwork(handlers = {}) {
  const calls = [];
  let inFlight = 0, maxInFlight = 0;
  const fetchFn = async (url) => {
    const u = new URL(url);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    try {
      if (u.hostname.includes("simbad")) { calls.push({ cat: "simbad" }); return handlers.simbad ? handlers.simbad() : reply(200, SIMBAD_CSV); }
      const cat = u.searchParams.get("cat"), minpm = Number(u.searchParams.get("minpm") ?? 0), radius = Number(u.searchParams.get("radius"));
      calls.push({ cat, minpm, radius });
      const h = handlers[minpm > 0 ? `${cat}-fast` : cat];
      return h ? h() : reply(200, { rows: [row(`${cat} 1`, 269.4, 4.7)], truncated: false });
    } finally { inFlight--; }
  };
  return { fetchFn, calls, maxInFlight: () => maxInFlight };
}

// ---------------------------------------------------------------- circles and URLs
{
  const r = radiiFor(5);
  check("circles: the field circle is a bit more than half the diagonal (0.707 x 5 = 3.5 arcmin)", Math.abs(r.field - 4.25) < 1e-9, String(r.field));
  check("circles: 2MASS/AllWISE reach 4 arcmin beyond (a candidate is carried back to 1999 / 2010), Gaia's fast stars 6", Math.abs(r.backInTime - 7.75) < 1e-9 && Math.abs(r.fastStars - 9.75) < 1e-9);
  const big = radiiFor(30);
  check("circles: never above what the backend accepts", big.field <= MAX_RADIUS_ARCMIN && big.backInTime === MAX_RADIUS_ARCMIN && big.fastStars === MAX_RADIUS_ARCMIN, JSON.stringify(big));
  const url = new URL(relayUrl(API, "gaia", 269.4462, 4.769, 9.75, 500));
  check("URL: the backend's endpoint with catalogue, position, radius and the proper-motion filter", url.origin + url.pathname === API + "/api/catalogue" && url.searchParams.get("cat") === "gaia"
    && url.searchParams.get("ra") === "269.446200" && url.searchParams.get("radius") === "9.750" && url.searchParams.get("minpm") === "500");
  check("URL: no filter parameter when none is wanted", !new URL(relayUrl(API, "2mass", 1, 2, 3)).searchParams.has("minpm"));
}

// ---------------------------------------------------------------- one answer
{
  const net = fakeNetwork({ "2mass": () => reply(200, { rows: [row("a", 1, 2)], truncated: true }) });
  const a = await fetchRelayRows(API, "2mass", 269.4, 4.7, 5, { fetchFn: net.fetchFn });
  check("one answer: rows and the truncated flag", a.rows.length === 1 && a.truncated === true);
  const err = async (handlers) => { try { await fetchRelayRows(API, "gaia", 1, 2, 3, { fetchFn: fakeNetwork(handlers).fetchFn }); return ""; } catch (e) { return e.message; } };
  check("an error answer reports the server's own explanation", (await err({ gaia: () => reply(502, { detail: "gaia service unreachable" }) })) === "HTTP 502: gaia service unreachable");
  check("an answer that is not a table is an error, not an empty list", (await err({ gaia: () => reply(200, { nothing: 1 }) })) === "unexpected answer");
  const refused = async () => { throw new TypeError("fetch failed"); };
  let message = "";
  try { await fetchRelayRows(API, "gaia", 1, 2, 3, { fetchFn: refused }); } catch (e) { message = e.message; }
  check("no backend: a readable message", message === "the backend did not answer", message);
  const slow = async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; };
  try { await fetchRelayRows(API, "gaia", 1, 2, 3, { fetchFn: slow }); } catch (e) { message = e.message; }
  check("a timeout is called a timeout", message === "too slow", message);
}

// ---------------------------------------------------------------- all catalogues
{
  const net = fakeNetwork({
    gaia: () => reply(200, { rows: [row("g1", 269.4, 4.7, { pmra: -5, pmdec: 3, epochMjd: 57388.5 }), row("g2", 269.41, 4.71)], truncated: false }),
    "gaia-fast": () => reply(200, { rows: [row("g2", 269.41, 4.71), row("barnard", 269.45, 4.69, { pmra: -798, pmdec: 10328, epochMjd: 57388.5 })], truncated: false }),
  });
  const res = await fetchAllCatalogues({ ra: 269.4462, dec: 4.769, fovArcmin: 5, apiBase: API, fetchFn: net.fetchFn });
  check("all four catalogues come back", ["simbad", "gaia", "2mass", "allwise"].every((k) => Array.isArray(res.catalogues[k])) && res.failed.length === 0 && res.notes.length === 0, JSON.stringify(res.notes));
  check("Gaia: the field's stars and the fast stars of the wider circle, each once", res.catalogues.gaia.length === 3 && new Set(res.catalogues.gaia.map((o) => o.id)).size === 3);
  const g = res.catalogues.gaia.find((o) => o.id === "barnard");
  check("Gaia: proper motion in arcsec/yr, at Gaia's epoch", Math.abs(g.pmNorth - 10.328) < 1e-9 && g.epochMjd === 57388.5);
  const gaiaCalls = net.calls.filter((c) => c.cat === "gaia");
  check("Gaia is asked twice: everything in the field, then only the fast stars (> 500 mas/yr) in the wider circle",
    gaiaCalls.length === 2 && gaiaCalls[0].minpm === 0 && gaiaCalls[1].minpm === FAST_PM_MAS && gaiaCalls[1].radius > gaiaCalls[0].radius, JSON.stringify(gaiaCalls));
  check("2MASS and AllWISE: the wider 'carried back' circle", net.calls.filter((c) => c.cat === "2mass" || c.cat === "allwise").every((c) => Math.abs(c.radius - 7.75) < 1e-9));
  check("SIMBAD answered with the star's proper motion converted", Math.abs(res.catalogues.simbad[0].pmNorth - 10.3281) < 1e-9);
  check("the queries go one at a time (IRSA drops parallel connections)", net.maxInFlight() === 1, String(net.maxInFlight()));
}

// ---------------------------------------------------------------- failures are tolerated
{
  const net = fakeNetwork({ allwise: () => reply(502, { detail: "allwise service unreachable" }) });
  const res = await fetchAllCatalogues({ ra: 1, dec: 2, fovArcmin: 5, apiBase: API, fetchFn: net.fetchFn });
  check("one catalogue down: the others still arrive", res.failed.join() === "allwise" && ["simbad", "gaia", "2mass"].every((k) => Array.isArray(res.catalogues[k])) && !res.catalogues.allwise);
  check("the note says which and why", res.notes.some((t) => t.startsWith("AllWISE:") && t.includes("unreachable")), res.notes.join(" | "));
}
{
  const net = fakeNetwork({ "gaia-fast": () => reply(502, { detail: "slow" }) });
  const res = await fetchAllCatalogues({ ra: 1, dec: 2, fovArcmin: 5, apiBase: API, fetchFn: net.fetchFn });
  check("fast-star question failed: Gaia is kept but the gap is admitted", Array.isArray(res.catalogues.gaia) && !res.failed.includes("gaia") && res.notes.some((t) => t.includes("fast star")), res.notes.join(" | "));
}
{
  const net = fakeNetwork({ simbad: () => reply(500, "boom") });
  const res = await fetchAllCatalogues({ ra: 1, dec: 2, fovArcmin: 5, apiBase: API, fetchFn: net.fetchFn });
  check("SIMBAD down: the backend catalogues are still asked", res.failed.join() === "simbad" && Array.isArray(res.catalogues.gaia) && Array.isArray(res.catalogues["2mass"]));
}
{
  const net = fakeNetwork({ "2mass": () => reply(200, { rows: [row("x", 1, 2)], truncated: true }) });
  const res = await fetchAllCatalogues({ ra: 1, dec: 2, fovArcmin: 5, apiBase: API, fetchFn: net.fetchFn });
  check("a cut-short answer is marked on the list, with a note", res.catalogues["2mass"].truncated === true && res.notes.some((t) => t.startsWith("2MASS") && t.includes("cut short")), res.notes.join(" | "));
  check("a complete list carries no such mark", !res.catalogues.allwise.truncated);
}
{
  const net = fakeNetwork();
  const res = await fetchAllCatalogues({ ra: 1, dec: 2, fovArcmin: 5, apiBase: "", fetchFn: net.fetchFn });
  check("without a backend only SIMBAD is asked, and the note says that it cannot call a source new",
    net.calls.length === 1 && Object.keys(res.catalogues).join() === "simbad" && res.notes.some((t) => t.includes("backend") && t.includes("new")), res.notes.join(" | "));
}
{
  const net = fakeNetwork();
  let asked = 0;
  const res = await fetchAllCatalogues({ ra: 1, dec: 2, fovArcmin: 5, apiBase: API, fetchFn: net.fetchFn, shouldStop: () => asked++ >= 1 });
  check("a new field loaded meanwhile stops further questions", net.calls.length < 5 && !res.catalogues.gaia, `${net.calls.length} calls`);
  const seen = [];
  await fetchAllCatalogues({ ra: 1, dec: 2, fovArcmin: 5, apiBase: API, fetchFn: fakeNetwork().fetchFn, onProgress: (t) => seen.push(t) });
  check("progress names each catalogue in turn", seen.join() === "SIMBAD,2MASS,AllWISE,Gaia DR3", seen.join());
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
