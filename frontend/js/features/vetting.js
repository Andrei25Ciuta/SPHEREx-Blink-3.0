// vetting.js – is a detection real, or an artefact? Quality flags and a "support" score for one candidate.
//
// Real SPHEREx cutouts hold more than stars: halos and ghosts of bright stars (the FITS headers count ghosts, halos and
// snowballs), flagged pixels, and edges where half of the aperture is missing. docs/VALIDATION.md section 13: 21 of 60 dots of
// one real image were in neither 2MASS nor AllWISE, and four of those were known fast stars; many of the rest were bright or at
// the image edge. So before a dot is called "unknown" it has to pass these checks.
//
// The SUPPORT score (0-100) says how well the detection is supported by the images: how many detections, in how many survey
// passes, how bright, how well they agree on a position, how unlikely a chance alignment is, minus penalties for the flags. It
// does NOT say how interesting or how new the object is: that is the class (discovery.js). The score is a sum of documented terms,
// not a probability; its threshold for "needs checking" was set from empty-sky copies of real fields (docs/VALIDATION.md §14).
// Pure functions (no DOM).

export const FLAGS = {
  edge: "Within a few pixels of the image edge (part of the measuring aperture may be missing).",
  "flagged-core": "The pixels at its centre carry bad-pixel flags (overflow, transient, ...), so its brightness and position are less reliable.",
  halo: "A much brighter source is close by in most of the images where it was seen: it may be a halo or ghost of that star.",
  blend: "Another source lies within about 2.5 pixels in many of the images: the two may be blended.",
  scattered: "Its positions in different images disagree by more than 0.8 pixel (rms).",
  "few-detections": "Seen in fewer than 3 images: not enough to rule out a noise peak.",
  "single-pass": "All its detections are from one survey pass (about 2 weeks): it cannot be checked against other epochs.",
  "motion-disagrees": "A catalogue source sits at its place, but the motion measured here differs from that source's own motion: probably a chance line of dots through a fixed star.",
};

const EDGE_PX = 6;
const HALO_RADIUS_PX = 14, HALO_RATIO = 20, HALO_MIN_SNR = 200;
const BLEND_RADIUS_PX = 2.5, BLEND_MIN_PX = 0.8;
const CORE_FLAGGED_PIXELS = 6;

export const edgeDistance = (x, y, n) => Math.min(x, y, n - x, n - y);

/** Flagged pixels among the 25 around (x, y). */
export function coreFlaggedCount(mask, n, x, y) {
  if (!mask) return 0;
  const ix = Math.floor(x), iy = Math.floor(y);
  let bad = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const xx = ix + dx, yy = iy + dy;
    if (xx >= 0 && yy >= 0 && xx < n && yy < n && mask[yy * n + xx]) bad++;
  }
  return bad;
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

/**
 * Flags for one candidate.
 * detections: [{ frame, x, y, snr }] its dots (pixels of the image they were found in);
 * dotsPerFrame: [[{ x, y, snr }]] every dot of every image (to see neighbours); masks: [Uint8Array|null] per image; n: image size;
 * nPasses / passes: survey passes in the data / with a detection.
 * Returns [{ code, severity: "info" | "warn" | "severe", text }].
 */
export function vetCandidate({ detections, dotsPerFrame, masks, n, nPasses = 1, passes = 1, rmsPx = 0 }) {
  const out = [];
  const add = (code, severity) => out.push({ code, severity, text: FLAGS[code] });
  const nDet = detections.length;
  const snr = median(detections.map((d) => d.snr ?? 0));

  if (nDet < 3) add("few-detections", "severe");
  if (median(detections.map((d) => edgeDistance(d.x, d.y, n))) < EDGE_PX) add("edge", "warn");

  const flaggedShare = detections.filter((d) => coreFlaggedCount(masks?.[d.frame], n, d.x, d.y) >= CORE_FLAGGED_PIXELS).length / Math.max(1, nDet);
  if (flaggedShare >= 0.5) add("flagged-core", snr >= 100 ? "info" : "warn");        // a bright star's core is often flagged and the star is still real

  let halo = 0, blend = 0;
  for (const d of detections) {
    let isHalo = false, isBlend = false;
    for (const o of dotsPerFrame?.[d.frame] ?? []) {
      const dist = Math.hypot(o.x - d.x, o.y - d.y);
      if (dist < 0.5) continue;                                                      // the detection itself
      if (dist <= HALO_RADIUS_PX && (o.snr ?? 0) >= Math.max(HALO_MIN_SNR, HALO_RATIO * (d.snr ?? 0))) isHalo = true;
      if (dist >= BLEND_MIN_PX && dist <= BLEND_RADIUS_PX) isBlend = true;
    }
    if (isHalo) halo++;
    if (isBlend) blend++;
  }
  if (halo / Math.max(1, nDet) >= 0.5) add("halo", "warn");
  if (blend / Math.max(1, nDet) >= 1 / 3) add("blend", "warn");
  if (rmsPx > 0.8) add("scattered", "warn");
  if (passes < 2 && nPasses >= 2) add("single-pass", "info");
  return out;
}

/** Is it more likely an artefact than a source? A halo, or two or more warnings together. */
export function looksLikeArtefact(flags) {
  const codes = new Set(flags.filter((f) => f.severity !== "info").map((f) => f.code));
  return codes.has("halo") || [...codes].filter((c) => c !== "few-detections").length >= 2;
}

/**
 * The support score of a candidate and how it came about.
 * c: { nDet, passes, medianSnr (detector S/N of its dots), rmsPx, falseAlarm (movers; chance lines expected in the field), kind,
 *      persistence: { fraction } (share of the images of its passes where it is also 3 sigma in the aperture; 1 if unknown) }
 * Points: a fixed source gets detections 25, passes 20, brightness 10, agreement 5, persistence 25, isolation 15; a moving one gets
 * detections 20, passes 15, brightness 10, agreement 5, persistence 15, and 35 for how unlikely a chance line is.
 */
export function supportScore(c, flags) {
  const has = (code) => flags.some((f) => f.code === code && f.severity !== "info");
  // Persistence: of the images of the survey passes in which it was detected, the share where the flux at its place is also at least
  // 3 sigma. A real source is there in most of them (a transient only in its own pass, and that is what is looked at); a chance
  // alignment of three unrelated dots is there only where it caught them. (Found with empty-sky copies of real fields, VALIDATION.md §14:
  // without it, three bright stars that happened to line up in 3 of 18 images scored 57-66.)
  const persistence = Math.min(Math.max(c.persistence?.fraction ?? 1, 0), 1);
  const movingLine = c.kind === "mover" || c.kind === "distant";
  // movers: how unlikely a chance line is (1 chance line expected = 0 points, one in a million = full marks); static sources: no neighbour spoils the measurement
  const chance = Math.min(Math.max(-Math.log10(Math.max(c.falseAlarm ?? 1, 1e-12)), 0) / 6, 1);
  const parts = movingLine
    ? { detections: 20 * Math.min(c.nDet, 8) / 8, passes: 15 * Math.min(c.passes ?? 1, 4) / 4, brightness: 10 * Math.min((c.medianSnr ?? 0) / 20, 1),
        agreement: 5 * (1 - Math.min((c.rmsPx ?? 0) / 0.8, 1)), persistence: 15 * persistence, isolation: 35 * chance }
    : { detections: 25 * Math.min(c.nDet, 8) / 8, passes: 20 * Math.min(c.passes ?? 1, 4) / 4, brightness: 10 * Math.min((c.medianSnr ?? 0) / 20, 1),
        agreement: 5 * (1 - Math.min((c.rmsPx ?? 0) / 0.8, 1)), persistence: 25 * persistence, isolation: 15 * (has("halo") || has("blend") ? 0 : 1) };
  const penalties = { halo: 30, edge: 15, "flagged-core": 10, blend: 10, scattered: 10, "motion-disagrees": 20 };
  const lost = Object.entries(penalties).filter(([code]) => has(code)).map(([code, p]) => [code, p]);
  let score = Object.values(parts).reduce((s, v) => s + v, 0) - lost.reduce((s, [, p]) => s + p, 0);
  if (flags.some((f) => f.code === "few-detections")) score = Math.min(score, 20);
  return { score: Math.round(Math.max(0, Math.min(100, score))), parts, penalties: lost };
}
