// Tests for the pure helpers of frontend/js/features/discoverPanel.js (texts, filters, sorting, stamps). The page part is checked in the browser.
// Run: node scratch/test_discover_panel.mjs
import { headline, subline, leadSentence, FILTERS, SORTS, pointsFor, pickStamps, stampPixels, medianFlux, explorerRow } from "../frontend/js/features/discoverPanel.js";
import { NEEDS_CHECKING_SCORE, CLASSES } from "../frontend/js/features/discovery.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

const base = {
  id: "SPX-S-269.4000+4.7000", kind: "static", class: "unknown", classLabel: CLASSES.unknown, ra: 269.4, dec: 4.7, nDet: 6, nFrames: 9, medianSnr: 12.4, support: 71, tags: [],
  motionIsReal: false, pmEast: null, pmNorth: null, flags: [], body: null, frames: [0, 1, 2, 3, 4, 5],
  catalogue: { matches: [], checked: ["SIMBAD", "Gaia DR3", "2MASS", "AllWISE"], notChecked: [] },
  photometry: Array.from({ length: 9 }, (_, k) => ({ frame: k, fluxMilliJy: 1 + k, flagged: false })),
  rawPositions: Array.from({ length: 9 }, (_, k) => ({ x: 20 + k * 0.1, y: 30 })),
};
const make = (over) => ({ ...base, ...over });

// ---------------------------------------------------------------- texts
{
  check("headline: an unexplained fixed source", headline(base) === "fixed source");
  check("headline: a one-pass source says so", headline(make({ tags: ["transient"] })) === "appears in one pass only");
  check("headline: a moving unknown source gives its speed", headline(make({ kind: "mover", motionIsReal: true, pmEast: 3, pmNorth: 4 })) === "moving source · moving 5.0″/yr");
  check("headline: a fast one has no decimals", headline(make({ kind: "mover", motionIsReal: true, pmEast: 30, pmNorth: 40 })).endsWith("moving 50″/yr"));
  check("headline: a parallax candidate is only 'possible'", headline(make({ kind: "distant" })) === "possible distant body");
  const longId = "Gaia DR3 4472835876142941952 plus a very long designation that must not break the layout";
  const h = headline(make({ class: "catalogued", catalogue: { ...base.catalogue, matches: [{ label: "Gaia DR3", id: longId, sepArcsec: 1.2 }] } }));
  check("headline: a catalogued source names the catalogue and shortens a very long id", h.startsWith("Gaia DR3: Gaia DR3 4472") && h.endsWith("…") && h.length < 50, h);
  check("headline: a Solar System body", headline(make({ class: "solar-system", body: { name: "2015 RW209", vmag: 22.6, cls: "MB>Outer" } })) === "2015 RW209 (V 22.6) · known MB>Outer");
  const sub = subline(make({ tags: ["moving", "very-red", "transient"] }));
  check("subline: position, images, S/N, support, and the tags in plain words (no 'moving': the headline has it)", sub.includes("RA 17h57m36.00s") && sub.includes("seen in 6 of 9 images") && sub.includes("S/N 12") && sub.includes("support 71/100") && sub.includes("very red") && sub.includes("one pass only") && !sub.includes("moving"), sub);
}
{
  const unknown = leadSentence(base);
  check("lead (unknown): names the catalogues that were checked, says a person must look, and that it is a lead not a discovery", unknown.includes("SIMBAD, Gaia DR3, 2MASS, AllWISE") && unknown.includes("needs a person") && unknown.includes("not a discovery"), unknown);
  check("lead (unknown): says what was NOT checked", leadSentence(make({ catalogue: { ...base.catalogue, checked: ["SIMBAD"], notChecked: ["Gaia DR3 (answer incomplete)"] } })).includes("not checked: Gaia DR3 (answer incomplete)"));
  const weak = leadSentence(make({ class: "unknown-weak", support: 41 }));
  check("lead (weak): gives the score and the threshold, and admits it may be noise", weak.includes("score 41") && weak.includes(`below ${NEEDS_CHECKING_SCORE}`) && weak.includes("noise"), weak);
  const art = leadSentence(make({ class: "artefact", flags: [{ code: "halo", severity: "warn" }, { code: "edge", severity: "warn" }, { code: "single-pass", severity: "info" }] }));
  check("lead (artefact): lists the warning flags but not the info ones", art.includes("halo, edge") && !art.includes("single-pass"), art);
  check("lead (not checked): does not claim anything about novelty", /nothing can be said about whether it is new/.test(leadSentence(make({ class: "unchecked", catalogue: { matches: [], checked: ["SIMBAD"], notChecked: ["Gaia DR3", "2MASS", "AllWISE"] } }))));
  const known = leadSentence(make({ class: "catalogued", catalogue: { ...base.catalogue, matches: [{ label: "2MASS", id: "2MASS J17574838+0446164", sepArcsec: 2.34, mag: "J 16.0, K 16.8", pm: null }] } }));
  check("lead (known): the match, its distance and magnitudes", known.includes("2MASS 2MASS J17574838+0446164, 2.3″ away (J 16.0, K 16.8)") && known.includes("known source"), known);
  const ast = leadSentence(make({ class: "solar-system", body: { name: "Ceres", cls: "MB>Inner", hits: 1 } }));
  check("lead (asteroid): singular 'image' for one hit", ast.includes("in 1 image.") && ast.includes("Ceres"), ast);
}

// ---------------------------------------------------------------- filters and sorting
{
  const list = [make({ class: "unknown" }), make({ class: "unknown-weak" }), make({ class: "artefact" }), make({ class: "catalogued", tags: ["moving"] }), make({ class: "solar-system" }), make({ class: "catalogued-moving", tags: ["moving", "red"] }), make({ class: "unchecked", tags: ["transient", "very-red"] })];
  const count = (k) => list.filter(FILTERS[k][1]).length;
  check("filters: everything / needs checking / not explained / known / artefacts", count("all") === 7 && count("check") === 1 && count("unknown") === 2 && count("known") === 3 && count("artefact") === 1);
  check("filters: moving, one pass only, red (red and very red)", count("moving") === 2 && count("transient") === 1 && count("red") === 2);
  check("filters: 'needs checking' is exactly the class that carries the flag in the pipeline", FILTERS.check[1](make({ class: "unknown" })) && !FILTERS.check[1](make({ class: "unknown-weak" })));
  const cs = [make({ id: "a", support: 50, ra: 3, photometry: base.photometry.map((p) => ({ ...p, fluxMilliJy: 1 })) }), make({ id: "b", support: 90, ra: 1, photometry: base.photometry.map((p) => ({ ...p, fluxMilliJy: 9 })) }), make({ id: "c", support: 70, ra: 2, photometry: base.photometry.map((p) => ({ ...p, fluxMilliJy: NaN })) })];
  const order = (k) => [...cs].sort(SORTS[k][1]).map((c) => c.id).join("");
  check("sorting: by support, by position, by flux (a source without a flux goes last)", order("support") === "bca" && order("ra") === "bca" && order("flux") === "bac", `${order("support")} ${order("ra")} ${order("flux")}`);
  check("sorting: 'most interesting first' keeps the pipeline's order (no comparator)", SORTS.best[1] === null);
  const phot = [{ frame: 0, fluxMilliJy: 1, flagged: false }, { frame: 1, fluxMilliJy: 100, flagged: true }, { frame: 2, fluxMilliJy: 3, flagged: false }, { frame: 3, fluxMilliJy: 1000, flagged: false }];
  check("median flux counts only images where it was detected and not flagged (1 and 3 -> 2)", medianFlux(make({ frames: [0, 1, 2], photometry: phot })) === 2);
}

// ---------------------------------------------------------------- highlighting on the player
{
  const frames = [0, 1, 2, 3].map((k) => ({ id: `D2@${k}`, mjd: 100 + k }));
  const run = { frames, n: 50 };
  const playerFrames = [{ detector: "D2", mjd: 1 }, { detector: "D2", mjd: 3 }];          // a subset of the searched images (one detector of several)
  const frameId = (f) => `${f.detector}@${f.mjd}`;
  const c = make({ rawPositions: [{ x: 10, y: 20 }, { x: 11, y: 21 }, { x: 12, y: 22 }, { x: 13, y: 23 }] });
  const pts = pointsFor(c, run, playerFrames, frameId);
  check("highlight: one point per image of the player, found by the image's id, as fractions of the picture", pts.length === 2 && Math.abs(pts[0].fx - 11 / 50) < 1e-9 && Math.abs(pts[1].fy - 23 / 50) < 1e-9, JSON.stringify(pts));
  const asteroid = make({ rawPositions: [null, null, { x: 25, y: 5 }, null] });
  const pa = pointsFor(asteroid, run, [{ detector: "D2", mjd: 0 }, { detector: "D2", mjd: 2 }, { detector: "D2", mjd: 7 }], frameId);
  check("highlight: an image without a position uses the nearest one in time (seen in one image only)", pa.every((p) => Math.abs(p.fx - 0.5) < 1e-9 && Math.abs(p.fy - 0.1) < 1e-9), JSON.stringify(pa));
}

// ---------------------------------------------------------------- stamps
{
  const wl = (g) => 0.75 + g * 0.3;
  const frames = Array.from({ length: 14 }, (_, g) => ({ wavelengthUm: wl(g) }));
  const seen = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const c = make({ frames: seen, rawPositions: frames.map(() => ({ x: 10, y: 10 })) });
  const picks = pickStamps(c, frames, 8);
  check("stamps: at most 8, in order of wavelength, no image twice", picks.length === 8 && new Set(picks.map((p) => p.g)).size === 8 && picks.every((p, i) => i === 0 || p.g > picks[i - 1].g));
  check("stamps: shows images where it was NOT seen too, so that absence is visible", picks.some((p) => !p.detected) && picks.some((p) => p.detected), JSON.stringify(picks.map((p) => p.g + (p.detected ? "+" : "-"))));
  const few = pickStamps(make({ frames: [2, 3], rawPositions: frames.map(() => ({ x: 1, y: 1 })) }), frames.slice(0, 4), 8);
  check("stamps: fewer images than the limit: all of them", few.length === 4 && few.filter((p) => p.detected).length === 2);
  const allSeen = pickStamps(make({ frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] }), frames, 8);
  check("stamps: a source seen everywhere is shown by 8 images spread over the wavelengths", allSeen.length === 8 && allSeen[0].g === 0 && allSeen.at(-1).g === 13);
}
{
  const size = 24, values = new Float32Array(size * size);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let i = 0; i < values.length; i++) values[i] = rnd() * 0.01;
  const noiseOnly = stampPixels({ size, values });
  const maxNoise = Math.max(...Array.from({ length: size * size }, (_, i) => noiseOnly[4 * i]));
  values[12 * size + 12] = 5;                                              // a star: 500 sigma
  const withStar = stampPixels({ size, values });
  check("stamp pixels: a pure-noise stamp is not stretched to full white-on-black contrast beyond its own range, a bright star is white and the background dark",
    withStar[4 * (12 * size + 12)] === 255 && withStar[4 * 5] < 90 && maxNoise > 0, `star ${withStar[4 * (12 * size + 12)]}, background ${withStar[4 * 5]}`);
  check("stamp pixels: a faint 6-sigma bump on noise stays visibly dimmer than the same stamp with a 500-sigma star", (() => {
    const faint = new Float32Array(values); faint[12 * size + 12] = 0.06;
    return stampPixels({ size, values: faint })[4 * (12 * size + 12)] > 120 && stampPixels({ size, values: faint })[4 * (12 * size + 12)] <= 255;
  })());
  const nan = new Float32Array(values); nan[0] = NaN;
  const px = stampPixels({ size, values: nan });
  check("stamp pixels: a missing pixel (outside the image) is drawn dark and see-through", px[0] === 0 && px[3] < 255 && px[7] === 255);
  check("stamp pixels: an all-equal stamp does not divide by zero", stampPixels({ size: 2, values: new Float32Array(4) }).every((v) => Number.isFinite(v)));
}

// ---------------------------------------------------------------- the row of the table (candidateExplorer.js)
{
  const r = explorerRow(base);
  check("explorerRow: id, class, headline, position, seen-in, S/N, support and a tag copy", r.id === base.id && r.class === "unknown" && r.classLabel === base.classLabel && r.headline === "fixed source" && r.ra === 269.4 && r.dec === 4.7
    && r.nDet === 6 && r.nFrames === 9 && r.snr === 12.4 && r.support === 71 && Array.isArray(r.tags) && r.tags !== base.tags);
  check("explorerRow: no motion when it is not significant; the median flux of the images where it was found (1..6 -> 3.5); no match is an empty text", r.motion === null && r.fluxMilliJy === 3.5 && r.match === "");
  const moving = explorerRow(make({ kind: "mover", motionIsReal: true, pmEast: 3, pmNorth: 4, catalogue: { ...base.catalogue, matches: [{ label: "Gaia DR3", id: "4472", sepArcsec: 1.2 }] } }));
  check("explorerRow: a significant motion is the speed in arcsec/yr, a match is 'catalogue id'", moving.motion === 5 && moving.match === "Gaia DR3 4472");
  check("explorerRow: a Solar System body is the match; a flux or S/N that cannot be measured is null, never NaN or 0",
    explorerRow(make({ class: "solar-system", body: { name: "Ceres", cls: "MB>Inner", hits: 2 } })).match === "Ceres"
    && explorerRow(make({ medianSnr: NaN, frames: [0], photometry: [{ frame: 0, fluxMilliJy: NaN, flagged: false }] })).snr === null
    && explorerRow(make({ frames: [0], photometry: [{ frame: 0, fluxMilliJy: NaN, flagged: false }] })).fluxMilliJy === null);
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
