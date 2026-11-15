import { dataLabel } from "./export.js";

const inRange = (x, low, high) => Number.isFinite(x) && x >= low && x <= high;
const isDetector = (x) => /^D[1-6]$/.test(x) || x === "all";   // "all": a search over every detector at once (the workspace exports it so)
const isText = (x) => typeof x === "string" && x.trim().length > 0 && x.length <= 512;
const optionalNumber = x => x == null || Number.isFinite(x);
const count = x => Number.isSafeInteger(x) && x >= 0;

export function fieldLink(field, real) {
  if (!field || !Number.isFinite(field.ra_deg) || !Number.isFinite(field.dec_deg) || !Number.isFinite(field.fov_arcmin)) return "";
  const params = new URLSearchParams({ ra: field.ra_deg, dec: field.dec_deg, fov: field.fov_arcmin });
  if (field.detector && field.detector !== "all") params.set("det", field.detector);
  if (real) params.set("data", "api");
  return `index.html?${params}#workspace`;
}

function fact(label, value, key, unit = "") {
  if (value == null || value === "") return null;
  return { label, value: String(value) + (unit ? " " + unit : ""), key };
}

export function archiveDataset(data) {
  // Field centers and 5 arcmin extraction are from the locked validation commands in docs/VALIDATION.md.
  const fields = { barnard: [269.4462, 4.769], eps: [331.0965, -56.8006] };
  const rows = data.movers.runs.map((r, index) => {
    const [object, detector] = String(r.id).split("-");
    const [ra, dec] = fields[object] ?? [null, null];                       // a run of a field this list does not know has no link to the workspace
    const field = { ra_deg: ra, dec_deg: dec, fov_arcmin: 5, detector: detector === "all" ? null : String(detector ?? "").toUpperCase() };
    return {
      id: r.id, label: r.label, detector: field.detector || "D2 + D6", motion: Math.hypot(...r.measured), kind: "mover (straight line)",
      ra, dec, sigma: r.sigma, chance: r.chanceLines, difference: r.difference,
      detections: r.seen[0], images: r.seen[1], pointer: `/movers/runs/${index}`, link: fieldLink(field, true),
      facts: [
        fact("Measured motion (east, north)", r.measured.join(", "), "measured", "arcsec/yr"),
        fact("Catalogue motion (east, north)", r.catalogue.join(", "), "catalogue", "arcsec/yr"),
        fact("Motion difference", r.difference, "difference", "arcsec/yr"),
        fact("Detections / images", r.seen.join(" / "), "seen"),
        fact("Motion significance", r.sigma, "sigma", "σ"),
        fact("Expected chance lines", r.chanceLines, "chanceLines"),
      ],
    };
  });
  return { label: "Archived mover validation", provenance: "Real SPHEREx cutouts · historical validation",
    source: "data/real_results.json", date: data.measuredOn, rows,
    limitation: "Several runs reuse the same images. The detector rule was tuned on these fields. An independent field is needed to assess generalization." };
}

const measurements = [
  ["ra_deg", "Right ascension", "deg"], ["dec_deg", "Declination", "deg"], ["epoch_mjd", "Reference epoch", "MJD"],
  ["speed_arcsec_per_yr", "Angular speed", "arcsec/yr"], ["pm_east_arcsec_per_yr", "Eastward motion", "arcsec/yr"],
  ["pm_north_arcsec_per_yr", "Northward motion", "arcsec/yr"], ["position_angle_deg", "Position angle", "deg"],
  ["detections", "Detections"], ["images", "Images searched"], ["significance_sigma", "Motion significance", "σ"],
  ["false_alarm_expected", "Expected chance lines"], ["rms_px", "Fit RMS", "px"],
  ["path_support_images", "Supported path samples"], ["path_images", "Measurable path samples"],
  ["distance_au", "Fitted distance", "AU"], ["distance_range_lo_au", "Distance range, lower", "AU"],
  ["distance_range_hi_au", "Distance range, upper", "AU"], ["own_velocity_kms", "Own velocity", "km/s"],
  ["asteroid_dates", "Asteroid match dates"],
  ["mean_source_snr", "Mean detection S/N"],
];

function centroidSamples(record) {
  if (record.fit_centroids === undefined && record.search_frames === undefined) return [];
  if (!Array.isArray(record.fit_centroids) || !Array.isArray(record.search_frames)
      || record.fit_centroids.length !== record.detections) throw Error("Invalid fit centroid count.");
  return record.fit_centroids.map(p => {
    if (!p || !count(p.frame_index) || p.frame_index >= record.search_frames.length
        || !Number.isFinite(p.x_px) || !Number.isFinite(p.y_px)) throw Error("Invalid fit centroid.");
    const key = record.search_frames[p.frame_index];
    const parts = typeof key === "string" && key.match(/^(D[1-6])@(-?\d+(?:\.\d+)?)$/);
    if (!parts || !Number.isFinite(Number(parts[2]))) throw Error("Invalid detector/time frame key.");
    return { key, detector: parts[1], mjd: Number(parts[2]), x: p.x_px, y: p.y_px };
  });
}

export function importDataset(document, filename) {
  if (!document || !Array.isArray(document.candidates)
      || ![dataLabel(true), dataLabel(false), dataLabel("synthetic"), dataLabel("unverified"),
        "real SPHEREx data (served by the project's backend)"].includes(document.data)
      || !isText(document.generated) || !Number.isFinite(Date.parse(document.generated))
      || !document.tool?.startsWith?.("SPHEREx Blink")) throw Error("Choose a SPHEREx Blink candidate JSON export.");
  const field = document.field;
  if (!field || !inRange(field.ra_deg, 0, 360) || !inRange(field.dec_deg, -90, 90)
      || !inRange(field.fov_arcmin, 1, 30) || !isDetector(field.detector)) throw Error("The export has invalid field coordinates or detector.");
  const real = document.data !== dataLabel(false);
  const rows = document.candidates.map((r, i) => {
    if (!r || !isText(r.candidate) || !isText(r.kind) || !isDetector(r.detector) || r.data !== document.data
        || !count(r.detections) || !count(r.images)
        || !measurements.every(([key]) => optionalNumber(r[key]))
        || ![r.known_object, r.asteroid_match].every(x => x == null || x === "" || isText(x))
        || (r.ra_deg != null && !inRange(r.ra_deg, 0, 360)) || (r.dec_deg != null && !inRange(r.dec_deg, -90, 90))) {
      throw Error(`Candidate ${i + 1} has missing, inconsistent or invalid measurements.`);
    }
    const samples = centroidSamples(r);
    const detectors = [...new Set(samples.map(p => p.detector))].sort();
    const detector = detectors.length ? detectors.join(" + ") : r.detector;
    const parallax = r.kind === "distant body (parallax)";
    return {
      id: String(i), label: r.candidate, detector, motion: r.speed_arcsec_per_yr, detections: r.detections, images: r.images,
      kind: r.kind, ra: r.ra_deg ?? null, dec: r.dec_deg ?? null, sigma: r.significance_sigma ?? null, chance: r.false_alarm_expected ?? null,
      rms: r.rms_px ?? null, snr: r.mean_source_snr ?? null, distanceAU: r.distance_au ?? null,
      samples, match: r.known_object || "", pointer: `/candidates/${i}`, link: fieldLink(field, real),
      facts: [
        fact("Fit model", r.kind, "kind"),
        ...measurements.map(([key, label, unit]) => {
          if (parallax && key === "images") label = "Distinct dates searched";
          if (parallax && key === "significance_sigma") label = "Parallax significance";
          return fact(label, r[key], key, unit);
        }),
        fact("Reported object association", r.known_object, "known_object"),
        fact("SkyBoT check", r.asteroid_match, "asteroid_match"),
      ].filter(Boolean),
    };
  });
  return { label: filename, source: filename, provenance: document.data, date: document.generated, rows,
    limitation: "The export documents fitted candidates. Catalogue associations and chance-line estimates require independent checks. Missing measurements are omitted." };
}

/** The sort orders of the table: [label, function that gives the value to sort by (bigger first), the row key that must exist for the order to make sense]. */
export const SORTS = {
  original: ["Source order", null, null],
  speed: ["Fastest first", (r) => r.motion, "motion"],
  detections: ["Most detections", (r) => r.detections, "detections"],
  sigma: ["Most significant", (r) => r.sigma, "sigma"],
  snr: ["Highest signal-to-noise", (r) => r.snr, "snr"],
  support: ["Best supported", (r) => r.support, "support"],
};

export function selectRows(rows, query, detector, sort, kind = "") {
  const term = query.trim().toLowerCase();
  const out = rows.filter(r => (!detector || r.detector === detector) && (!kind || (r.classLabel ?? r.kind) === kind)
    && [r.label, r.detector, r.match, r.id, r.field, r.classLabel].some(s => String(s ?? "").toLowerCase().includes(term)));
  const by = SORTS[sort]?.[1];
  // a row without the number goes last, whichever way the table is sorted
  if (by) out.sort((a, b) => (Number.isFinite(by(b)) ? by(b) : -Infinity) - (Number.isFinite(by(a)) ? by(a) : -Infinity));
  return out;
}

// Half-open bins avoid double-counting values exactly on a bin edge.
export function speedHistogram(rows) {
  const edges = [0, 1, 5, 10, 50, Infinity];
  const bins = edges.slice(1).map((hi, i) => ({
    label: Number.isFinite(hi) ? `${edges[i]} to < ${hi}` : `≥ ${edges[i]}`, count: 0,
  }));
  for (const row of rows) {
    if (Number.isFinite(row.motion) && row.motion >= 0) {
      const i = edges.findIndex(edge => edge > row.motion) - 1;
      bins[i].count++;
    }
  }
  return bins;
}

export function evidenceReport(dataset, row, facts = row.facts) {
  return [row.label, dataset.provenance, `Source: ${dataset.source}#${row.pointer}`, `Recorded: ${dataset.date}`, "",
    ...facts.map(f => `${f.label}: ${f.value} [${row.pointer}/${f.key}]`), "", dataset.limitation].join("\n");
}

// The model may choose evidence keys. All displayed text and values come from the selected record.
export async function assistedReport(model, question, dataset, row, signal) {
  const keys = row.facts.map(f => f.key);
  const session = await model.create({ signal });
  try {
    const schema = { type: "array", items: { type: "string", enum: keys }, minItems: 1, maxItems: keys.length };
    const prompt = `Select the evidence keys most relevant to this question, ordered by relevance. Return JSON only.\nQuestion: ${question}\nEvidence: ${JSON.stringify(row.facts)}`;
    const selected = JSON.parse(await session.prompt(prompt, { responseConstraint: schema, signal }));
    if (!Array.isArray(selected) || !selected.length || selected.length > keys.length || !selected.every(k => keys.includes(k))) {
      throw Error("The model returned invalid evidence references.");
    }
    return evidenceReport(dataset, row, [...new Set(selected)].map(k => row.facts.find(f => f.key === k)));
  } finally {
    session.destroy();
  }
}
