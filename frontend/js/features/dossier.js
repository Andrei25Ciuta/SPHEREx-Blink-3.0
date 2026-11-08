// dossier.js – the evidence file of one candidate, and the exports of all of them.
//
// A candidate is only worth showing with what supports it: where and when, how it moves, in how many images it was seen, its
// spectrum, what the catalogues say, what is wrong with it, and what a person should check next. This turns the objects of
// discovery.js into plain text (Markdown for reading), JSON and CSV (for tools), and a per-image position list ("tracklet") for
// moving candidates. Every file says whether its data is real SPHEREx or synthetic, and how to reproduce it.
//
// NO ADES file: the Minor Planet Center's format needs an observatory code and the spacecraft's position for a space telescope,
// neither of which could be checked here; a file that looked like ADES and was not valid would mislead. The tracklet CSV has the
// quantities ADES asks for (time, RA, Dec, uncertainty, magnitude) per image, for someone who knows the MPC rules to convert.
// Pure functions (no DOM).

import { VERSION, CLASSES } from "./discovery.js";
import { dataLabel, provenanceColumns, provenanceText, PROVENANCE_CSV_COLUMNS } from "./provenance.js";

const MJD_UNIX_EPOCH = 40587;
export const mjdToIso = (mjd) => new Date((mjd - MJD_UNIX_EPOCH) * 86400000).toISOString().replace(/\.\d+Z$/, "Z");

/** 269.4462 -> "17h57m47.09s" */
export function degToHms(deg) {
  const total = (((deg % 360) + 360) % 360) / 15 * 3600;
  let h = Math.floor(total / 3600), m = Math.floor((total - h * 3600) / 60), s = Math.round((total - h * 3600 - m * 60) * 100) / 100;
  if (s >= 60) { s -= 60; m++; } if (m >= 60) { m -= 60; h++; }
  return `${String(h % 24).padStart(2, "0")}h${String(m).padStart(2, "0")}m${s.toFixed(2).padStart(5, "0")}s`;
}
/** 4.769 -> "+04d46m08.4s" */
export function degToDms(deg) {
  const sign = deg < 0 ? "-" : "+", a = Math.abs(deg) * 3600;
  let d = Math.floor(a / 3600), m = Math.floor((a - d * 3600) / 60), s = Math.round((a - d * 3600 - m * 60) * 10) / 10;
  if (s >= 60) { s -= 60; m++; } if (m >= 60) { m -= 60; d++; }
  return `${sign}${String(d).padStart(2, "0")}d${String(m).padStart(2, "0")}m${s.toFixed(1).padStart(4, "0")}s`;
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

/** What a person should do next, from what the candidate is and what is wrong with it. */
export function whatToCheck(c) {
  const t = [];
  if (c.class === "unknown") {
    t.push("Look at the small images (stamps) in every image where it was seen: a real source is a round dot at the same place each time; a halo, a ghost or a streak is not.");
    t.push("Look at it in the other SPHEREx detectors and survey passes, and in the 2MASS, AllWISE and DSS pictures of the sky map (it may be a faint star the catalogues lack).");
  }
  if (c.class === "artefact") t.push("Flags suggest an artefact: check whether a bright star lies just outside the picture, and whether the flagged pixels cover the dot.");
  if (c.tags.includes("moving")) t.push("Its motion is significant: compare it with the proper motions in SIMBAD and Gaia for this position and with SkyBoT and the Minor Planet Center's checker for the dates of the images.");
  if (c.tags.includes("transient")) t.push("It appears in one survey pass only: look for it in other surveys at the same epoch, and rule out an asteroid (SkyBoT, MPC checker) and a detector artefact.");
  if (c.tags.includes("very-red") || c.tags.includes("red")) t.push("Its colour is red (brighter at long wavelengths): a cold brown dwarf or a warm body would look like this; check WISE W1-W2 and the spectrum smoothness. The hint cannot tell an M dwarf from an early T dwarf.");
  if (c.kind === "distant") t.push("A parallax candidate is a lead, never a planet: its dots may be a chance combination (an empty field gives about 30). Look for the same path in other detectors and more images.");
  if (c.catalogue?.notChecked?.length) t.push(`These catalogues were not checked: ${c.catalogue.notChecked.join(", ")}.`);
  if (!t.length) t.push("Nothing special: it is a known source.");
  return t;
}

/**
 * One candidate as a plain object.
 * ctx = { isReal, detector, query: { ra, dec, fov }, permalink, frames: [{ id, dateISO }], generated }
 */
export function candidateDossier(c, ctx) {
  const dateOf = (k) => ctx.frames?.[k]?.dateISO ?? mjdToIso(c.photometry[k].mjd);
  const speed = c.pmEast !== null && c.pmEast !== undefined ? Math.hypot(c.pmEast, c.pmNorth) : null;
  return {
    id: c.id, kind: c.kind, class: c.class, classLabel: c.classLabel ?? CLASSES[c.class], needsChecking: Boolean(c.needsChecking), tags: [...c.tags],
    support: { score: c.support, parts: Object.fromEntries(Object.entries(c.supportParts).map(([k, v]) => [k, round(v, 1)])), penalties: Object.fromEntries(c.supportPenalties ?? []),
      meaning: "How well the images support the detection (0-100): detections, survey passes, brightness, agreement of the positions, unlikeliness of a chance line, minus penalties for the flags. It is not a probability and it does not say how new the object is." },
    position: { raDeg: round(c.ra, 6), decDeg: round(c.dec, 6), ra: degToHms(c.ra), dec: degToDms(c.dec), epochMjd: round(c.epochMjd, 3), epoch: mjdToIso(c.epochMjd), errArcsec: round(c.posErrArcsec, 2),
      note: "Position relative to the reference image of the registration (pointing errors of up to ~0.7 pixel between exposures are removed on the field stars)." },
    motion: speed === null ? null : { pmEastArcsecPerYr: round(c.pmEast, 3), pmNorthArcsecPerYr: round(c.pmNorth, 3), speedArcsecPerYr: round(speed, 3), errArcsecPerYr: round(c.pmErr, 3), significant: Boolean(c.motionIsReal) },
    distance: c.kind === "distant" ? { au: round(c.distanceAU, 0), rangeAu: c.distanceRangeAU?.map((v) => round(v, 0)) } : null,
    detections: { n: c.nDet, images: c.nFrames, survey_passes: c.passes, passes_in_data: c.nPasses, medianDetectorSnr: round(c.medianSnr, 1), rmsPx: round(c.rmsPx, 3), chanceLinesExpected: Number.isFinite(c.falseAlarm) ? Number(c.falseAlarm.toPrecision(2)) : null,
      persistence: c.persistence ? { imagesLookedAt: c.persistence.images, imagesShowingIt: c.persistence.present, fraction: round(c.persistence.fraction, 2) } : null },
    spectrum: c.photometry.map((p) => ({ image: p.frame + 1, date: dateOf(p.frame), detector: p.detector, wavelengthUm: round(p.wavelengthUm, 3), snr: round(p.snr, 1), fluxMilliJy: round(p.fluxMilliJy, 4), flagged: p.flagged, detected: c.frames.includes(p.frame), measured: p.measured })),
    colour: c.colour ? { kind: c.colour.kind, ratio: round(c.colour.ratio, 3), text: c.colour.text } : null,
    catalogue: { matches: c.catalogue.matches.map((m) => ({ catalogue: m.label, id: m.id, separationArcsec: round(m.sepArcsec, 2), searchRadiusArcsec: round(m.radiusArcsec, 1), magnitudes: m.mag, type: m.type, properMotionArcsecPerYr: round(m.pm, 3) })), checked: c.catalogue.checked, notChecked: c.catalogue.notChecked },
    solarSystemBody: c.body ? { name: c.body.name, vmag: c.body.vmag, class: c.body.cls, imagesMatched: c.body.hits } : null,
    flags: c.flags.map((f) => ({ code: f.code, severity: f.severity, text: f.text })),
    whatToCheck: whatToCheck(c),
    provenance: {
      tool: "SPHEREx Blink (NASA Space Apps 2026)", pipeline: VERSION, data: dataLabel(ctx.isReal), detector: ctx.detector,
      field: { raDeg: ctx.query.ra, decDeg: ctx.query.dec, fovArcmin: ctx.query.fov }, permalink: ctx.permalink ?? "", generated: ctx.generated ?? new Date().toISOString(),
      run: ctx.provenance ?? null,                 // how the search was run: input, settings, algorithm version, time of the run (provenance.js)
      note: "A candidate is a lead with its evidence, not a discovery: it needs independent confirmation.",
    },
  };
}

/** The dossier as Markdown text for people. */
export function dossierMarkdown(d) {
  const L = [];
  L.push(`# ${d.id}: ${d.classLabel}`, "");
  L.push(`**Data:** ${d.provenance.data}. **Support score:** ${d.support.score}/100. ${d.needsChecking ? "**Needs checking.**" : ""}`, "");
  L.push(`- Position (ICRS, epoch ${d.position.epoch}): RA ${d.position.ra} (${d.position.raDeg}°), Dec ${d.position.dec} (${d.position.decDeg}°), uncertainty about ${d.position.errArcsec}″.`);
  if (d.motion) L.push(`- Motion: ${d.motion.pmEastArcsecPerYr}″/yr east, ${d.motion.pmNorthArcsecPerYr}″/yr north (${d.motion.speedArcsecPerYr}″/yr, ± ${d.motion.errArcsecPerYr}); ${d.motion.significant ? "significant" : "not significant: treated as not moving"}.`);
  if (d.distance) L.push(`- Distance from the Earth's parallax: ${d.distance.au} AU (${d.distance.rangeAu?.join("-")}). A lead, not a planet.`);
  L.push(`- Seen in ${d.detections.n} of ${d.detections.images} images, in ${d.detections.survey_passes} of ${d.detections.passes_in_data} survey passes; median detector S/N ${d.detections.medianDetectorSnr}; rms about its path ${d.detections.rmsPx} px${d.detections.chanceLinesExpected !== null ? `; chance lines like it expected in the field: ${d.detections.chanceLinesExpected}` : ""}.`);
  if (d.detections.persistence) L.push(`- Persistence: in the images of the survey passes where it was detected, ${d.detections.persistence.imagesShowingIt} of ${d.detections.persistence.imagesLookedAt} show flux of at least 3 sigma at its place (a real source is in most of them; a chance alignment only where it caught its dots).`);
  if (d.tags.length) L.push(`- Tags: ${d.tags.join(", ")}.`);
  L.push("", "## Catalogues", "");
  if (d.solarSystemBody) L.push(`- Solar System: **${d.solarSystemBody.name}** (${d.solarSystemBody.class}${d.solarSystemBody.vmag !== null ? `, V ${d.solarSystemBody.vmag}` : ""}) at its place in ${d.solarSystemBody.imagesMatched} image(s) (SkyBoT).`);
  if (d.catalogue.matches.length) for (const m of d.catalogue.matches) L.push(`- ${m.catalogue}: ${m.id} ${m.type ? `(${m.type}) ` : ""}${m.magnitudes ? `[${m.magnitudes}] ` : ""}${m.separationArcsec}″ away (search radius ${m.searchRadiusArcsec}″)${m.properMotionArcsecPerYr !== null ? `, proper motion ${m.properMotionArcsecPerYr}″/yr` : ""}.`);
  else if (!d.solarSystemBody) L.push(`- **No match** in ${d.catalogue.checked.length ? d.catalogue.checked.join(", ") : "any catalogue (none was checked)"}.`);
  if (d.catalogue.notChecked.length) L.push(`- Not checked: ${d.catalogue.notChecked.join(", ")}.`);
  L.push("", "## Flags", "");
  L.push(...(d.flags.length ? d.flags.map((f) => `- **${f.code}** (${f.severity}): ${f.text}`) : ["- None."]));
  L.push("", "## Spectrum, image by image", "", "| image | date (UTC) | detector | wavelength µm | S/N | flux mJy | detected | flagged |", "|---|---|---|---|---|---|---|---|");
  for (const s of d.spectrum) L.push(`| ${s.image} | ${s.date} | ${s.detector ?? ""} | ${s.wavelengthUm ?? ""} | ${s.snr ?? ""} | ${s.fluxMilliJy ?? ""} | ${s.detected ? "yes" : "no"} | ${s.flagged ? "yes" : ""} |`);
  if (d.colour) L.push("", d.colour.text);
  L.push("", "## How the support score came about", "", Object.entries(d.support.parts).map(([k, v]) => `${k} ${v}`).join(", ") + (Object.keys(d.support.penalties).length ? `; penalties: ${Object.entries(d.support.penalties).map(([k, v]) => `${k} -${v}`).join(", ")}` : "") + ".", d.support.meaning);
  L.push("", "## What to check next", "", ...d.whatToCheck.map((t) => `- ${t}`));
  L.push("", "## Provenance", "", `${d.provenance.tool}, ${d.provenance.pipeline}. Field RA ${d.provenance.field.raDeg}°, Dec ${d.provenance.field.decDeg}°, ${d.provenance.field.fovArcmin}′, detector ${d.provenance.detector}. ${d.provenance.permalink ? `Reopen: ${d.provenance.permalink}. ` : ""}Generated ${d.provenance.generated}. ${d.provenance.note}`, "");
  if (d.provenance.run) L.push("### How the search was run", "", provenanceText(d.provenance.run), "");
  return L.join("\n");
}

// ---------------------------------------------------------------- tables for tools

export const CSV_COLUMNS = ["id", "class", "needs_checking", "support", "kind", "ra_deg", "dec_deg", "epoch_mjd", "pos_err_arcsec", "pm_east_arcsec_per_yr", "pm_north_arcsec_per_yr", "pm_err_arcsec_per_yr",
  "detections", "images", "survey_passes", "median_detector_snr", "rms_px", "persistence", "chance_lines_expected", "tags", "flags", "best_catalogue", "best_match", "best_match_sep_arcsec",
  "solar_system_body", "colour_ratio", "colour_kind", "median_flux_mjy", "data", "permalink", ...PROVENANCE_CSV_COLUMNS];

/** One CSV cell (a text starting with = + - @ would run as a spreadsheet formula: it gets a leading apostrophe). */
function cell(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const median = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

export function candidateRows(candidates, ctx) {
  return candidates.map((c) => {
    const best = c.catalogue.matches[0];
    return {
      id: c.id, class: c.classLabel, needs_checking: c.needsChecking, support: c.support, kind: c.kind, ra_deg: round(c.ra, 6), dec_deg: round(c.dec, 6), epoch_mjd: round(c.epochMjd, 3),
      pos_err_arcsec: round(c.posErrArcsec, 2), pm_east_arcsec_per_yr: round(c.pmEast, 3), pm_north_arcsec_per_yr: round(c.pmNorth, 3), pm_err_arcsec_per_yr: round(c.pmErr, 3),
      detections: c.nDet, images: c.nFrames, survey_passes: c.passes, median_detector_snr: round(c.medianSnr, 1), rms_px: round(c.rmsPx, 3), persistence: round(c.persistence?.fraction, 2),
      chance_lines_expected: Number.isFinite(c.falseAlarm) ? Number(c.falseAlarm.toPrecision(2)) : null, tags: c.tags.join(";"), flags: c.flags.map((f) => f.code).join(";"),
      best_catalogue: best?.label ?? "", best_match: best?.id ?? "", best_match_sep_arcsec: best ? round(best.sepArcsec, 2) : null, solar_system_body: c.body?.name ?? "",
      colour_ratio: round(c.colour?.ratio, 3), colour_kind: c.colour?.kind ?? "", median_flux_mjy: round(median(c.photometry.filter((p) => c.frames.includes(p.frame)).map((p) => p.fluxMilliJy)), 4),
      data: dataLabel(ctx.isReal), permalink: ctx.permalink ?? "",
      ...(ctx.provenance ? provenanceColumns(ctx.provenance) : Object.fromEntries(PROVENANCE_CSV_COLUMNS.map((k) => [k, ""]))),
    };
  });
}

export function candidatesToCsv(candidates, ctx) {
  return [CSV_COLUMNS.join(","), ...candidateRows(candidates, ctx).map((r) => CSV_COLUMNS.map((k) => cell(r[k])).join(","))].join("\r\n") + "\r\n";
}

export function candidatesToJson(candidates, ctx) {
  return JSON.stringify({
    tool: "SPHEREx Blink (NASA Space Apps 2026)", pipeline: VERSION, generated: ctx.generated ?? new Date().toISOString(), data: dataLabel(ctx.isReal),
    field: { ra_deg: ctx.query.ra, dec_deg: ctx.query.dec, fov_arcmin: ctx.query.fov, detector: ctx.detector }, permalink: ctx.permalink ?? "",
    provenance: ctx.provenance ?? null,
    note: "Candidates are leads with their evidence, not discoveries.", candidates: candidates.map((c) => candidateDossier(c, ctx)),
  }, null, 2) + "\n";
}

/**
 * Position of a candidate in every image where it was seen: the quantities an astrometry report asks for (time, RA, Dec, uncertainty, flux).
 * Not ADES (see the top of this file).
 */
export function trackletCsv(c, ctx) {
  const header = ["candidate", "image", "obs_time_utc", "mjd", "ra_deg", "dec_deg", "pos_err_arcsec", "detector", "wavelength_um", "flux_mjy", "snr", "data"];
  const rows = (c.trackSky ?? []).map((p) => {
    const ph = c.photometry[p.frame];
    return [c.id, p.frame + 1, mjdToIso(p.mjd), round(p.mjd, 5), round(p.ra, 6), round(p.dec, 6), round(c.posErrArcsec, 2), ph.detector, round(ph.wavelengthUm, 3), round(ph.fluxMilliJy, 4), round(ph.snr, 1), dataLabel(ctx.isReal)];
  });
  return [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}

export const dossierFileName = (c, ctx, extension) => `spherex-blink_${c.id}${ctx.isReal ? "" : "_synthetic"}.${extension}`;
export const listFileName = (ctx, extension) => `spherex-blink_sources_${ctx.query.ra.toFixed(4)}_${ctx.query.dec.toFixed(4)}_${ctx.detector}${ctx.isReal ? "" : "_synthetic"}.${extension}`;
