// Tests for the reproducibility bundle (features/bundle.js, bundleView.js, scratch/replay_bundle.mjs).   Run: node scratch/test_bundle.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { hashArray, replayLink, buildBundle, validateBundle, candidateSignature, SCHEMA } from "../frontend/js/features/bundle.js";
import { buildProvenance } from "../frontend/js/features/provenance.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const digest = (bytes) => globalThis.crypto.subtle.digest("SHA-256", bytes);
const sha = (a) => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");

// ---------------------------------------------------------------- the hash
{
  check("hash: SHA-256 of the bytes 'abc' is the published test vector", (await hashArray(new Uint8Array([97, 98, 99]), digest)) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const f = new Float32Array([1.5, -2.25, 1e-9, 3000]);
  check("hash: of a float array it is the hash of its bytes, the same as Node's crypto (what the replay script computes), and a changed value changes it", (await hashArray(f, digest)) === sha(f) && (await hashArray(new Float32Array([1.5, -2.25, 1e-9, 3001]), digest)) !== sha(f));
  const view = new Float32Array(new Float32Array([9, 1.5, -2.25, 1e-9, 3000]).buffer, 4, 4);
  check("hash: an array that is a view into a larger buffer hashes only its own bytes", (await hashArray(view, digest)) === sha(f));
}

// ---------------------------------------------------------------- the manifest
const fr = (mjd, det = "D2") => ({ mjd, detector: det, dateISO: new Date((mjd - 40587) * 86400000).toISOString().slice(0, 19) + "Z", wavelengthMinUm: 1.1, wavelengthMaxUm: 1.6, flags: { fractionFlagged: 0.004 }, dataUrl: "http://localhost:8003/cutouts/x.f32", imageUrl: "http://localhost:8003/cutouts/x.png" });
const frames = [fr(60900.5), fr(61000.25), fr(61200.75)];
const hashes = Object.fromEntries(await Promise.all(frames.map(async (f, k) => [`${f.detector}@${f.mjd}`, await hashArray(new Float32Array([k, k + 1]), digest)])));
const ctx = (isReal) => ({ isReal, query: { ra: 269.4462, dec: 4.769, fov: 5 }, detector: "D2", frames, geo: { scaleArcsec: 6.14 }, unit: "MJy / sr", n: 49, href: "http://localhost:8765/index.html?data=api&api=http%3A%2F%2Flocalhost%3A8003&ra=1&dec=2&theme=light#frame", mode: "blink" });
const run = buildProvenance({ analysis: "find-movers", algorithm: { version: "movers-2" }, ctx: { ...ctx(true), permalink: "http://localhost:8765/index.html?x=1" }, frames, settings: { minDetectionFraction: 0.6, sigmaFloor: 1e-9, allDetectors: false } });
const cand = [{ label: "#1", known: "Barnard's star", nDet: 3, nFrames: 3, significance: 20.4, falseAlarm: 5e-19, speedArcsecPerYear: 10.1, compass: "N", support: { supported: 3, measurable: 3 } }];
const real = buildBundle({ context: ctx(true), hashes, pixelKind: "float32 (the file's own unit)", versions: { movers: "movers-2", parallax: "parallax-1" }, run, candidates: cand, now: new Date("2026-11-10T08:00:00Z") });
const synth = buildBundle({ context: ctx(false), hashes, pixelKind: "8-bit grey (synthetic demo)", versions: { movers: "movers-2" }, run: null, candidates: [], now: new Date("2026-11-10T08:00:00Z") });
{
  check("manifest: the schema, the tool, the date, the field and detector, the versions of the algorithms, and what the data are", real.schema === SCHEMA && /^SPHEREx Blink/.test(real.tool) && real.created === "2026-11-10T08:00:00.000Z" && real.query.ra === 269.4462 && real.query.fovArcmin === 5 && real.query.detector === "D2" && real.query.detectors.join() === "D2"
    && real.software.algorithms.movers === "movers-2" && real.software.algorithms.parallax === "parallax-1" && real.data.kind === "real" && /real SPHEREx data/.test(real.data.label));
  check("manifest: every image has its id, date, wavelength range, pass and a 64-digit hash, and a product id of null with the reason said (the backend does not report it)", real.images.length === 3 && real.images.every((i) => /^[0-9a-f]{64}$/.test(i.sha256) && i.productId === null && i.wavelengthUm.length === 2) && real.images[0].id === "D2@60900.5000" && real.images[2].pass === 3
    && real.archive.productIds === null && /does not report which archive product/.test(real.archive.note));
  check("manifest: the settings and the version of the last search come from its provenance record; no search yet is an empty list", real.searches.length === 1 && real.searches[0].settings.minDetectionFraction === 0.6 && real.searches[0].algorithm.version === "movers-2" && synth.searches.length === 0);
  check("manifest: the candidates are the same rows as the text analysis, with a status in words", real.results.candidates.length === 1 && /known object, not a discovery/.test(real.results.candidates[0].status) && /never a discovery/.test(real.results.note));
  check("manifest: a synthetic bundle says SYNTHETIC in capitals, says its pixels are 8-bit, and has no command (no backend to replay on)", /SYNTHETIC/.test(synth.data.label) && synth.data.kind === "synthetic" && synth.pixels.kind.startsWith("8-bit") && synth.replay.command === null && /synthetic/.test(synth.replay.note));
}

// ---------------------------------------------------------------- what must never be in it
{
  check("validate: a good real bundle and a good synthetic bundle have no problem", validateBundle(real).length === 0 && validateBundle(synth).length === 0, JSON.stringify([...validateBundle(real), ...validateBundle(synth)]));
  const text = JSON.stringify({ ...real, replay: { ...real.replay, command: null, link: null }, searches: real.searches.map((s) => ({ ...s, permalink: null })) });       // the link (and the permalink, which is the same link) are the address of the page: checked separately
  check("privacy: no pixel, no file name, no path and no address of this computer anywhere in the bundle (apart from the command and the link, which are checked below)", !/localhost|127\.0\.0\.1|\.fits|\.f32|\.png|dataUrl|imageUrl|base64/i.test(text), (text.match(/localhost|127\.0\.0\.1|\.fits|\.f32|\.png|dataUrl|imageUrl/i) ?? [""])[0]);
  check("privacy: the permalink of the search record (which was the address of the page) is replaced by the replay link, and the replay link has no 'data' or 'api' parameter and no hash", !/localhost/.test(real.searches[0].permalink) || real.searches[0].permalink === real.replay.link ? real.searches[0].permalink === real.replay.link && !/[?&](data|api)=/.test(real.replay.link) && !real.replay.link.includes("#") : false, real.replay.link);
  check("replay link: the field, the detector and the mode only, five decimals, in a fixed order", real.replay.link === "http://localhost:8765/index.html?ra=269.44620&dec=4.76900&fov=5&det=D2&mode=blink", real.replay.link);
  check("replay: a real bundle gives the command with the script; its address is the one to change", /^node scratch\/replay_bundle\.mjs <this file> --api http:\/\/localhost:8003$/.test(real.replay.command));
  const bad = (mut) => { const b = structuredClone(real); mut(b); return validateBundle(b); };
  check("validate refuses: a wrong schema, a missing part, a hash that is not 64 hex digits, no images", bad((b) => { b.schema = "x"; }).length > 0 && bad((b) => { delete b.replay; }).some((p) => /missing replay/.test(p)) && bad((b) => { b.images[0].sha256 = "abc"; }).some((p) => /sha256/.test(p)) && bad((b) => { b.images = []; }).some((p) => /no images/.test(p)));
  check("validate refuses: a key that could hold a pixel, a path or an address (dataUrl, file ..., or pixels holding a list of numbers or a long string), anywhere; a text description of the pixels is allowed", bad((b) => { b.images[0].dataUrl = "x"; }).length > 0 && bad((b) => { b.pixels.pixels = [1, 2]; }).length > 0 && bad((b) => { b.pixels.pixels = "x".repeat(300); }).length > 0 && validateBundle(real).length === 0 && bad((b) => { b.searches[0].file = "a"; }).length > 0);
  check("validate refuses: text with an address of this computer, a Windows or a Unix home path, or a FITS file name; but not the command", bad((b) => { b.software.note = "http://localhost:9"; }).length > 0 && bad((b) => { b.software.note = "C:\\Users\\admin\\x"; }).length > 0 && bad((b) => { b.software.note = "/home/me/x"; }).length > 0 && bad((b) => { b.software.note = "a_l2b.fits"; }).length > 0 && validateBundle(real).length === 0);
  check("validate refuses: a synthetic bundle that does not say SYNTHETIC, a replay link that carries a backend, a date that is not a date", bad((b) => { b.data = { kind: "synthetic", label: "demo" }; }).some((p) => /SYNTHETIC/.test(p)) && bad((b) => { b.replay.link += "&api=x"; }).some((p) => /backend/.test(p)) && bad((b) => { b.created = "yesterday"; }).some((p) => /date/.test(p)));
  check("replayLink: drops everything but the field; hash and other parameters are not kept", replayLink({ href: "https://x.github.io/SPHEREx/?theme=light&data=api&api=http%3A%2F%2Fa#z", query: { ra: 1, dec: -2, fov: 30 }, detector: "D5", mode: "diff" }) === "https://x.github.io/SPHEREx/?ra=1.00000&dec=-2.00000&fov=30&det=D5&mode=diff");
  check("signature: motion, images and significance of each candidate, so a replay can compare", candidateSignature(real.results.candidates) === "10.1″/yr toward N|3 of 3|20");
}

// ---------------------------------------------------------------- the page and the replay script
{
  const HTML = read("../frontend/index.html"), MAIN = read("../frontend/js/main.js"), VIEW = read("../frontend/js/features/bundleView.js").replace(/\/\/.*$/gm, ""), REPLAY = read("./replay_bundle.mjs");
  const ids = ["bundle-btn", "bundle-error", "bundle-status", "bundle-replay"];
  check("page: the elements of the bundle are in index.html once, in section 9 (text analysis), with a live status and an alert", ids.every((id) => (HTML.match(new RegExp(`id="${id}"`, "g")) || []).length === 1) && HTML.indexOf('id="bundle-btn"') > HTML.indexOf('id="text-analysis"') && /id="bundle-status" role="status" aria-live="polite"/.test(HTML) && /id="bundle-error" role="alert"/.test(HTML));
  check("page: main.js wires it with the images, the pixels the searches use, the candidates and the last search record, the versions, and the download", /setupBundle\(\{/.test(MAIN) && /getRun: \(\) => moversRun/.test(MAIN) && /setupBundle\(\{[\s\S]{0,400}frames: searchFrames\(\)/.test(MAIN) && /versions: \{ movers: MOVERS_VERSION, parallax: PARALLAX_VERSION \}/.test(MAIN) && /getPixels: \(frames\) => detectionPixels\(frames\)/.test(MAIN));
  check("page: a bundle that fails its own check is not saved (the error is shown), and a page without a secure context says that the hashes cannot be computed", /validateBundle\(bundle\)/.test(VIEW) && /was not saved/.test(VIEW) && /secure page/.test(VIEW) && /crypto\?\.subtle/.test(VIEW));
  check("replay script: checks the bundle first, compares the hash of every image, runs the same search with the settings of the bundle, and says REPRODUCED or what differs (exit 0 / 1 / 2)",
    /validateBundle\(bundle\)/.test(REPLAY) && /createHash\("sha256"\)/.test(REPLAY) && /REPRODUCED/.test(REPLAY) && /DIFFERS/.test(REPLAY) && /process\.exit\(verdict \? 0 : 1\)/.test(REPLAY) && /process\.exit\(2\)/.test(REPLAY) && /k in DEFAULTS/.test(REPLAY));
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
