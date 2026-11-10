// bundle.js – a reproducibility bundle: a small JSON file that says how an analysis was made and lets someone else check it (pure: no DOM, no network; the hash function is injected).
//
// It holds: what the data are (real or synthetic), the query (field, detector), the version of every algorithm, the settings the search used, a SHA-256 hash of the pixels of every image, the images'
// dates and wavelengths, the results (the candidates) and how to replay it. The hashes say "this is the same data" without publishing a pixel: a hash is not the image. It holds NO pixel, NO file path,
// NO address of this computer (validateBundle refuses a bundle that does).
//
// What it cannot say: the IRSA product (planeid) of each image. The backend serves cutouts and does not report which archive product each came from, so `productId` is null and the file says why.
// Replaying: the link restores the workspace (field, detector, mode); `node scratch/replay_bundle.mjs FILE --api URL` reads the same images from a backend, compares the hashes and runs the same search.

import { TOOL, dataLabel, imageIdOf } from "./provenance.js";
import { frameRows, candidateRows } from "./textAnalysis.js";

export const SCHEMA = "spherex-blink-bundle-1";
export const FORBIDDEN_KEYS = /^(dataUrl|maskUrl|imageUrl|flagsUrl|path|file|fileName|filename|uri|url)$/i;
const PIXEL_KEY = /^pixels?$/i;                                // a DESCRIPTION of the pixels is fine ("float32 ..."); a list of numbers or a long string is a dump
export const FORBIDDEN_TEXT = /localhost|127\.0\.0\.1|\[::1\]|[A-Za-z]:\\|\\\\|\/Users\/|\/home\/|\.fits\b|data:image|base64/i;
const HEX64 = /^[0-9a-f]{64}$/;

/** SHA-256 of the bytes of a typed array, as 64 hex digits. `digest(bytes)` -> ArrayBuffer (crypto.subtle.digest bound to "SHA-256"). */
export async function hashArray(array, digest) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  return [...new Uint8Array(await digest(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The link that restores the workspace: the field, the detector and the mode, never the address of a backend (it would be an address of the author's computer). */
export function replayLink({ href, query, detector, mode = "blink" }) {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  for (const [k, v] of [["ra", query.ra.toFixed(5)], ["dec", query.dec.toFixed(5)], ["fov", String(query.fov)], ["det", detector], ["mode", mode]]) url.searchParams.set(k, v);
  return url.href;
}

/**
 * Build the manifest.
 *   context   { isReal, query: { ra, dec, fov }, detector, frames, geo: { scaleArcsec }, unit, n, href, mode }
 *   hashes    { [imageId]: hex }   from hashArray, one per image
 *   pixelKind "float32 (the file's own unit)" | "8-bit grey (synthetic demo)"
 *   versions  { movers: "movers-2", ... }   run   the provenance record of the last search (or null)   candidates   the candidates on screen
 */
export function buildBundle({ context, hashes, pixelKind, versions, run = null, candidates = [], now = new Date(), apiHint = "http://localhost:8003" }) {
  const rows = frameRows(context.frames);
  const images = rows.map((r) => {
    const f = context.frames.find((x) => `${x.detector}@${x.mjd}` === r.id);
    return { id: imageIdOf(f), date: r.date, time: r.time, mjd: Number(f.mjd.toFixed(6)), detector: r.detector, pass: r.pass, wavelengthUm: [f.wavelengthMinUm, f.wavelengthMaxUm], flaggedPercent: r.flaggedPercent,
      sha256: hashes[r.id] ?? null, productId: null };
  });
  const link = replayLink({ href: context.href, query: context.query, detector: context.detector, mode: context.mode });
  return {
    schema: SCHEMA, tool: TOOL, created: now.toISOString(),
    data: { kind: context.isReal ? "real" : "synthetic", label: dataLabel(context.isReal) },
    software: { app: "SPHEREx Blink 2.0 (branch blink-2.0)", algorithms: versions },
    query: { ra: context.query.ra, dec: context.query.dec, fovArcmin: context.query.fov, detector: context.detector, detectors: [...new Set(context.frames.map((f) => f.detector))].sort() },
    pixels: { kind: pixelKind, size: context.n, scaleArcsec: context.geo.scaleArcsec, unit: context.unit ?? null, hash: "SHA-256 of the bytes of the array of each image, as served (little-endian float32 or 8-bit)" },
    archive: { name: context.isReal ? "IRSA (the SPHEREx archive), through the project's backend" : "none: images invented in the browser", productIds: null,
      note: "The backend serves cutouts and does not report which archive product (planeid) each came from, so productId is null. /api/survey lists the survey's images at a position; the link between a cutout and a plane is not made here." },
    images,
    searches: run ? [{ ...run, permalink: link }] : [],            // the record carries the address of the page it ran on (this computer, maybe): the replay link replaces it
    results: { candidates: candidateRows(candidates), note: "A candidate is a lead, never a discovery." },
    replay: {
      link,
      command: context.isReal ? `node scratch/replay_bundle.mjs <this file> --api ${apiHint}` : null,
      note: context.isReal ? "The link restores the workspace; press Find movers to run the search. The command reads the same images from a backend on the real files, compares the hashes and runs the same search."
        : "These data are synthetic: the link regenerates them in the browser; the search is run by pressing Find movers.",
    },
  };
}

/** What is wrong with a bundle (an empty list: nothing). A bundle must have no pixel, path or local address, and every hash must be 64 hex digits. */
export function validateBundle(b) {
  const problems = [];
  if (!b || typeof b !== "object") return ["not an object"];
  if (b.schema !== SCHEMA) problems.push(`schema is ${JSON.stringify(b.schema)}, not ${SCHEMA}`);
  for (const k of ["tool", "created", "data", "software", "query", "pixels", "archive", "images", "searches", "results", "replay"]) if (!(k in b)) problems.push(`missing ${k}`);
  if (!Number.isFinite(Date.parse(b.created))) problems.push("created is not a date");
  if (!["real", "synthetic"].includes(b.data?.kind)) problems.push("data.kind must be real or synthetic");
  else if (b.data.kind === "synthetic" && !/SYNTHETIC/.test(b.data.label ?? "")) problems.push("a synthetic bundle must say SYNTHETIC in its label");
  if (!Array.isArray(b.images) || !b.images.length) problems.push("no images");
  else for (const im of b.images) if (!HEX64.test(im.sha256 ?? "")) problems.push(`image ${im.id}: sha256 is not 64 hex digits`);
  const walk = (o, where) => {
    if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) {
        if (FORBIDDEN_KEYS.test(k) || (PIXEL_KEY.test(k) && (Array.isArray(v) || ArrayBuffer.isView(v) || (typeof v === "string" && v.length > 200)))) problems.push(`${where}.${k}: a key that could hold a pixel, a path or an address`);
        walk(v, `${where}.${k}`);
      }
    else if (typeof o === "string" && FORBIDDEN_TEXT.test(o) && where !== "$.replay.command" && o !== b.replay?.link) problems.push(`${where}: text with a local address, a path or a file name`);
  };
  walk(b, "$");
  if (b.replay?.link && /[?&](data|api)=/.test(b.replay.link)) problems.push("the replay link carries the address of a backend");
  return problems;
}

/** A short signature of the candidates (motion, images, significance), so that a replay can say "reproduced" or what differs. */
export function candidateSignature(rows) {
  return rows.map((r) => `${r.motion}|${r.images}|${r.significance}`).join(";");
}
