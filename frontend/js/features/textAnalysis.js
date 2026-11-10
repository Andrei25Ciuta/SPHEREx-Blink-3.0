// textAnalysis.js – the images, the dots and the candidates as plain tables: no canvas, no colour, nothing that needs sight (pure: no DOM, no network).
//
// The picture is one way to look at the data; this is another, for a screen reader, for a keyboard, and for anyone who wants to cite or check a number:
//   frameRows(frames)                   one row per image: date, detector, wavelength, share of flagged pixels, survey pass
//   sourceRows(perFrame, n, geo)        one row per dot of each image: position (pixel, RA, Dec), S/N, the error of the position, and what could make it unreliable
//   candidateRows(movers)               one row per candidate: motion, images, significance, chance lines, path support and its STATUS in words
//   provenanceLines(context)            what the data are (real or synthetic), where from, how many images, the pixel scale
//   toCsv(rows, columns, provenance)    the same table as a file whose first lines say what the data are
//
// The dots are the ones the search uses (movers.js detectSources); nothing is measured twice with another method. Flux in a physical unit is NOT in the table of dots: it is a separate
// aperture measurement (click a source in the picture for its spectrum); the table says so instead of leaving a column that looks like a measurement.

import { canvasToSky } from "../geometry.js";
import { formatRA, formatDec } from "../coords.js";
import { passIndices, coreIsCompromised } from "./movers.js";

export const EDGE_MARGIN_PX = 3;                 // a dot this close to the border of the cutout has half its surroundings missing
export const MANY_FLAGS = 0.01;                  // an image with more than 1 % flagged pixels (the limit of the timeline, "Skip frames with > 1 % flagged pixels")
export const SOURCE_LIMIT_PER_FRAME = 60;        // the table stays readable: the brightest dots of each image, and it says how many were left out

/** One row per image, in time order. */
export function frameRows(frames) {
  const sorted = [...frames].sort((a, b) => a.mjd - b.mjd), pass = passIndices(sorted.map((f) => f.mjd));
  return sorted.map((f, i) => {
    const share = f.flags && Number.isFinite(f.flags.fractionFlagged) ? f.flags.fractionFlagged : null;
    return {
      number: i + 1, id: `${f.detector}@${f.mjd}`, date: String(f.dateISO).slice(0, 10), time: String(f.dateISO).slice(11, 16), detector: f.detector, pass: pass[i] + 1,
      wavelength: Number.isFinite(f.wavelengthMinUm) && Number.isFinite(f.wavelengthMaxUm) ? `${f.wavelengthMinUm.toFixed(2)}–${f.wavelengthMaxUm.toFixed(2)}` : "unknown",
      flaggedPercent: share === null ? null : Math.round(share * 1000) / 10,
      note: share === null ? "flags not given" : share > MANY_FLAGS ? "more than 1 % of the pixels are flagged" : "",
      mjd: f.mjd,
    };
  });
}

/**
 * One row per dot. perFrame = [{ frame, sources: [{ x, y, snr, sigmaPx }], image, mask }] in time order; x, y are image-edge pixels (the centre of the first pixel is 0.5), as detectSources
 * gives them. -> { rows, left } where `left` is the number of dots not listed (the faintest of crowded images).
 */
export function sourceRows(perFrame, n, geo, { limitPerFrame = SOURCE_LIMIT_PER_FRAME } = {}) {
  const rows = [];
  let left = 0;
  perFrame.forEach(({ frame, sources, image = null, mask = null }, fi) => {
    const sorted = [...sources].sort((a, b) => b.snr - a.snr);
    left += Math.max(0, sorted.length - limitPerFrame);
    sorted.slice(0, limitPerFrame).forEach((s, k) => {
      const sky = canvasToSky(s.x / n, s.y / n, geo), flags = [];
      if (s.x < EDGE_MARGIN_PX || s.y < EDGE_MARGIN_PX || s.x > n - EDGE_MARGIN_PX || s.y > n - EDGE_MARGIN_PX) flags.push("near the edge");
      if (mask && image && coreIsCompromised(image, mask, n, Math.floor(s.x), Math.floor(s.y))) flags.push("flagged core (saturated or bad pixels: position fitted on the good ones)");
      rows.push({
        frame: fi + 1, id: `${frame.detector}@${frame.mjd}`, date: String(frame.dateISO).slice(0, 10), detector: frame.detector, rank: k + 1,
        x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100,
        ra: sky.ra, dec: sky.dec, raText: formatRA(sky.ra), decText: formatDec(sky.dec),
        snr: Math.round(s.snr * 10) / 10, sigmaArcsec: Math.round(s.sigmaPx * geo.scaleArcsec * 100) / 100, flags: flags.join("; "),
      });
    });
  });
  return { rows, left };
}

/** The candidates as rows. The status says what the candidate is and what it is not. */
export function candidateRows(movers) {
  return (movers ?? []).map((m, k) => {
    const support = m.support?.measurable ? `${m.support.supported} of ${m.support.measurable}` : "not measured";
    let status;
    if (m.known) status = `matches the catalogued ${m.known}: a known object, not a discovery`;
    else if (m.distant) status = "a Planet X candidate: a lead; compare it with the chance candidates of an empty field before believing it";
    else status = "no catalogue match found: a lead, never a discovery; check the catalogues, the images and the other detectors";
    if (m.asteroids?.length) status += `; an asteroid (${m.asteroids[0].name}) lies near its path`;
    return {
      label: m.label ?? `#${k + 1}`,
      motion: Number.isFinite(m.speedArcsecPerYear) ? `${m.speedArcsecPerYear.toFixed(1)}″/yr toward ${m.compass ?? "?"}` : "–",
      distance: m.distant ? `about ${Math.round(m.distanceAU)} AU (${m.distant.rangeText})` : "–",
      images: `${m.nDet} of ${m.nFrames}`,
      significance: Number.isFinite(m.significance) ? Math.round(m.significance) : null,
      chance: Number.isFinite(m.falseAlarm) ? (m.falseAlarm < 0.01 ? m.falseAlarm.toExponential(1) : m.falseAlarm.toPrecision(2)) : null,       // 5.0e-19, not 17 digits
      support,
      status,
    };
  });
}

/** What the data are, in sentences that go on top of every table and into every file. */
export function provenanceLines({ isReal, query, detector, frames, scaleArcsec, unit, when = new Date() }) {
  const dates = frames.map((f) => String(f.dateISO).slice(0, 10)).sort();
  return [
    isReal ? "Data: real SPHEREx images served by the backend (derived from observations)." : "Data: SYNTHETIC demo images generated in the browser. They are NOT observations.",
    `Field: RA ${formatRA(query.ra)}, Dec ${formatDec(query.dec)}, ${query.fov}′ square; detector ${detector}.`,
    `Images: ${frames.length}${frames.length ? `, ${dates[0]} to ${dates.at(-1)}` : ""}; pixel scale ${Number.isFinite(scaleArcsec) ? scaleArcsec.toFixed(2) : "?"}″${unit ? `; pixel unit ${unit}` : ""}.`,
    isReal ? "Positions use the world coordinate system the backend read from the file of each image; it was not re-checked here." : "Positions use the simulated sky of the demo.",
    `Dots: movers.js detectSources with its default threshold; the error of a position is the model of the app (movers.js ERROR_MODEL). Table made ${when.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
  ];
}

/** One sentence for a live region: what was built, and what was left out. */
export function analysisSummary({ frames, sources, left, candidates }) {
  return `Text analysis ready: ${frames} image${frames === 1 ? "" : "s"}, ${sources} dot${sources === 1 ? "" : "s"} listed${left ? ` (${left} fainter dot${left === 1 ? "" : "s"} left out of the table)` : ""}, `
    + `${candidates} candidate${candidates === 1 ? "" : "s"}${candidates ? "" : " (run Find movers to list candidates)"}.`;
}

const cell = (v) => {
  const t = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** A table as CSV, with the provenance as comment lines first (# ...). columns = [[key, header]...] */
export function toCsv(rows, columns, provenance = []) {
  return [...provenance.map((l) => `# ${l}`), columns.map(([, h]) => cell(h)).join(","), ...rows.map((r) => columns.map(([k]) => cell(r[k])).join(","))].join("\n") + "\n";
}

export const FRAME_COLUMNS = [["number", "Image"], ["date", "Date (UTC)"], ["time", "Time (UTC)"], ["detector", "Detector"], ["pass", "Survey pass"], ["wavelength", "Wavelength (µm)"], ["flaggedPercent", "Flagged pixels (%)"], ["note", "Note"]];
export const SOURCE_COLUMNS = [["frame", "Image"], ["date", "Date (UTC)"], ["detector", "Detector"], ["rank", "Rank by S/N"], ["x", "x (pixel)"], ["y", "y (pixel)"], ["raText", "RA"], ["decText", "Dec"], ["snr", "S/N"], ["sigmaArcsec", "Position error (″ per axis)"], ["flags", "Warnings"]];
export const CANDIDATE_COLUMNS = [["label", "Candidate"], ["motion", "Motion"], ["distance", "Distance"], ["images", "Seen in"], ["significance", "Significance (σ)"], ["chance", "Chance lines expected"], ["support", "Path supported in"], ["status", "Status"]];
