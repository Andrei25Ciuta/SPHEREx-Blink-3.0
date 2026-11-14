// skyContext.js – Aladin Lite sky map: the same spot in other surveys + SIMBAD objects,
// with the blink field drawn as a dashed square. Loaded from the CDN only on demand.
//
// Where the pictures come from (see SKY_TILES in config.js), first one that answers wins:
//   1. ESA's public mirror of the CDS surveys (skies.esac.esa.int, CORS open, no setup);
//   2. our backend, which relays IRSA's copies via /api/hips
//      (IRSA sends no CORS headers, and WebGL needs them);
//   3. the CDS originals (Strasbourg) directly - blocked on some networks,
//      in which case the map stays grey while the catalogue objects still show.
// Catalogue objects: SIMBAD via its Harvard mirror (TAP), which sends CORS headers.
// Older surveys are also handy for movers: a fast star sits somewhere ELSE in 2MASS (1999)!

import { SKY_TILES, API_BASE } from "../config.js";
import { WORLD_URL, decodeCountries, overheadAt } from "./skyGeo.js";
import { fieldCorners } from "./explorerGeometry.js";

const ALADIN_URL = "https://cdn.jsdelivr.net/npm/aladin-lite@3.6.5/dist/aladin.js";
const SIMBAD_TAP = "https://simbad.harvard.edu/simbad/sim-tap/sync";

const ESA_HIPS = "https://skies.esac.esa.int";   // same surveys as CDS (properties file says so)
const SURVEYS = {
  "2mass":   { cds: "P/2MASS/color",   esa: "2MASSColor",   irsa: "CDS/2MASS/Color" },
  "allwise": { cds: "P/allWISE/color", esa: "AllWISEColor", irsa: "CDS/AllWISE/RGB-W4-W2-W1" },
  "dss2":    { cds: "P/DSS2/color",    esa: "DSSColor",     irsa: "CDS/DSS2/color" },
};
const SOURCES = ["esa", "backend", "cds"];
const SOURCE_NOTE = {
  esa: "Sky images: ESA's mirror of the CDS surveys.",
  backend: "Sky images: IRSA (via our backend).",
  cds: "Sky images: CDS. If the map stays grey, your network may block CDS: start the backend (see the README), then press “Re-centre sky map”.",
};
// Where the pictures come from right now; decided again each time the map is opened.
let source = SOURCES.includes(SKY_TILES) ? SKY_TILES : "cds";
/** Survey key -> what Aladin should load (a CDS id or a full HiPS URL). */
function surveyRef(key) {
  const s = SURVEYS[key] || SURVEYS["2mass"];
  if (source === "esa") return `${ESA_HIPS}/${s.esa}`;
  if (source === "backend") return `${API_BASE}/api/hips/${s.irsa}`;
  return s.cds;
}

/** Does this URL answer quickly? (A blocked or slow host answers nothing.) */
async function answers(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", ""];
/**
 * A backend "on this machine" is only reachable from a page that is also on this machine.
 * On a public page (GitHub Pages) we must not poke at localhost: browsers may even ask the
 * visitor for permission to reach devices on their network.
 */
function backendMayExist() {
  let backendHost = location.hostname;                       // API_BASE = "" means the page's own server
  try { if (API_BASE) backendHost = new URL(API_BASE).hostname; } catch { /* keep the page's host */ }
  return !(LOCAL_HOSTS.includes(backendHost) && !LOCAL_HOSTS.includes(location.hostname));
}

/** First picture source that answers: ESA's mirror, then our backend (IRSA), then CDS. */
async function pickSource() {
  if (SKY_TILES !== "auto") return SOURCES.includes(SKY_TILES) ? SKY_TILES : "cds";
  if (await answers(`${ESA_HIPS}/DSSColor/properties`)) return "esa";
  if (backendMayExist() && await answers(`${API_BASE}/api/health`)) return "backend";
  return "cds";
}

/** SIMBAD objects in a circle, as a VOTable URL (ADQL on the Harvard TAP mirror). */
function simbadUrl(ra, dec, radiusDeg) {
  const adql = `SELECT TOP 300 main_id, ra, dec, otype, sp_type FROM basic
    WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra.toFixed(6)}, ${dec.toFixed(6)}, ${radiusDeg.toFixed(4)})) = 1`;
  return `${SIMBAD_TAP}?${new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "votable", QUERY: adql })}`;
}

let loadPromise = null;
/** The npm build is an ES module (`export default A`), so we import() it on demand. */
function loadAladin() {
  loadPromise ??= import(ALADIN_URL)
    .then(async (mod) => {
      const A = mod.default;
      await A.init;                       // loads the WebAssembly core; needs WebGL2
      return A;
    })
    .catch((err) => {
      loadPromise = null;
      const msg = String(err?.message || err);
      throw new Error(msg.includes("WebGL") ? "The sky map needs WebGL2, which this browser does not offer."
                                            : "Could not load Aladin Lite (offline?).");
    });
  return loadPromise;
}

const READOUT_HELP = "The country in brackets is the one this spot of the sky is straight above at this moment (worked out from the coordinates and the Earth's rotation). It is not where SPHEREx is.";
const GEO_NOTE = "In brackets: the country this spot of the sky is straight above right now, worked out from the sky coordinates and the Earth's rotation. The Earth turns, so it moves west about 15° an hour. It is not where SPHEREx is. Borders: Natural Earth, low resolution (small islands are missing), so near a border or a coast it can be off by tens of kilometres.";
const GEO_NOTE_FAILED = "The country names could not be loaded (offline?), so only the sky coordinates are shown.";

/** The world map for the country readout, loaded once (a few tens of kilobytes). Never throws: null when it could not be loaded. */
let worldPromise = null;
function loadWorld() {
  worldPromise ??= fetch(WORLD_URL, { signal: AbortSignal.timeout(8000) })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(decodeCountries)
    .catch((err) => { console.warn("World map for the country readout failed", err); worldPromise = null; return null; });
  return worldPromise;
}

export class SkyContext {
  constructor(container, statusEl, noteEl = null, { matchField = false } = {}) {
    this.container = container;
    this.statusEl = statusEl;
    this.matchField = matchField;
    this.noteEl = noteEl;               // the paragraph that explains the country in brackets
    this.aladin = null;
    this.A = null;
    this.query = null;
    this.candidateTrack = [];
    this.survey = "2mass";
    this.readout = null;                // the box in the corner: coordinates and, in brackets, the country overhead
    this.world = null;                  // countries (skyGeo.js), once loaded
    this.hovering = false;
    this.lastMove = 0;
    this.shown = null;                  // { ra, dec, label } of the readout, to redraw it when the world map arrives
  }

  /** Put coordinates (ICRS degrees) in the readout, with the country that sky point is straight above right now. */
  setReadout(ra, dec, label) {
    if (!this.readout) return;
    this.shown = { ra, dec, label };
    let text = `${label}: RA ${ra.toFixed(3)}°, Dec ${dec.toFixed(3)}°`;
    if (this.world) text += ` (overhead now: ${overheadAt(this.world, ra, dec, new Date()).text})`;
    this.readout.textContent = text;
  }
  /** The map's own centre, shown when the pointer is not over the map. */
  showCentre() {
    this.hovering = false;
    if (!this.aladin) return;
    const c = this.aladin.getRaDec();                                  // always ICRS, whatever frame the map shows
    if (Number.isFinite(c?.[0]) && Number.isFinite(c?.[1])) this.setReadout(c[0], c[1], "Centre");
  }
  onHover(e) {
    const now = performance.now();
    if (now - this.lastMove < 60) return;                              // a few updates per second are enough
    this.lastMove = now;
    const p = this.aladin.pix2world(e.x, e.y, "icrs");                 // the event's own ra/dec are in the frame being shown; this is always ICRS
    if (!Number.isFinite(p?.[0]) || !Number.isFinite(p?.[1])) return;
    this.hovering = true;
    this.setReadout(p[0], p[1], "Cursor");
  }
  /** Load the country map once and redraw the readout with it. */
  async ensureWorld() {
    if (this.world) return;
    this.world = await loadWorld();
    if (this.noteEl) this.noteEl.textContent = this.world ? GEO_NOTE : GEO_NOTE_FAILED;
    if (this.shown) this.setReadout(this.shown.ra, this.shown.dec, this.shown.label);
  }

  get isOpen() { return !!this.aladin; }

  async open(query, survey) {
    this.survey = survey || this.survey;
    this.container.hidden = false;
    this.statusEl.textContent = "Loading sky map…";
    let pictureSource;
    try {
      [this.A, pictureSource] = await Promise.all([loadAladin(), pickSource()]);
    } catch (err) {
      this.statusEl.textContent = err.message;
      this.container.hidden = true;
      return;
    }
    const before = source;
    source = pictureSource;
    if (!this.aladin) {
      this.aladin = this.A.aladin(this.container, {
        survey: surveyRef(this.survey),
        cooFrame: "ICRS",
        showReticle: true,
        showCooGridControl: true,
        showProjectionControl: false,
        showFullscreenControl: false,   // we have our own "Full screen" button (fullscreen.js)
        showLayersControl: true,
        showFrame: true,
        log: false,            // Aladin's default usage ping to CDS: off (it fails on networks that block CDS)
      });
      // Coordinates box in the corner (pointer = cursor position, otherwise the map centre). It does not catch the mouse.
      this.readout = document.createElement("div");
      this.readout.className = "sky-readout";
      this.readout.title = READOUT_HELP;
      this.container.appendChild(this.readout);
      this.aladin.on("mouseMove", (e) => this.onHover(e));
      this.aladin.on("positionChanged", () => { if (!this.hovering) this.showCentre(); });
      this.container.addEventListener("pointerleave", () => this.showCentre());
    }
    // The source can change between two openings (e.g. the backend was started meanwhile).
    else if (before !== source) this.setSurvey(this.survey);
    this.statusEl.textContent = SOURCE_NOTE[source];
    if (this.noteEl) { this.noteEl.hidden = false; this.noteEl.textContent = this.world ? GEO_NOTE : "Loading country names…"; }
    this.update(query);
    this.setCandidateTrack(this.candidateTrack);
    this.ensureWorld();                  // not awaited: the map works at once, the country appears when the borders have arrived
  }

  /** Draw the selected candidate's supporting detections, in observation order. */
  setCandidateTrack(points, onSelect = this.onCandidatePoint) {
    this.candidateTrack = points;
    this.onCandidatePoint = onSelect;
    if (!this.aladin) return;
    const { A, aladin } = this;
    if (!this.trackOverlay && points.length) {
      this.trackOverlay = A.graphicOverlay({ name: "Candidate trajectory", color: "#f0bf73", lineWidth: 2 });
      aladin.addOverlay(this.trackOverlay);
      this.trackCatalog = A.catalog({
        name: "Supporting detections", color: "#ffd693", shape: "circle", sourceSize: 10,
        onClick: source => this.onCandidatePoint?.(this.candidateTrack[source.data.index]),
      });
      aladin.addCatalog(this.trackCatalog);
    }
    this.trackOverlay?.removeAll();
    this.trackCatalog?.removeAll();
    if (points.length > 1) this.trackOverlay.add(A.polyline(points.map(({ ra, dec }) => [ra, dec])));
    if (points.length) this.trackCatalog.addSources(points.map(({ ra, dec }, index) => A.source(ra, dec, { index })));
  }

  setSurvey(key) {
    this.survey = key;
    if (!this.aladin) return;
    const ref = surveyRef(key);
    // API name changed between 3.x releases – support both.
    if (typeof this.aladin.setImageSurvey === "function") this.aladin.setImageSurvey(ref);
    else this.aladin.setBaseImageLayer(ref);
  }

  /** Re-centre on a new query and redraw the field square + SIMBAD objects. */
  update(query) {
    this.query = query;
    if (!this.aladin || !query) return;
    const { A, aladin } = this;
    const { ra, dec, fov } = query;
    aladin.gotoRaDec(ra, dec);
    aladin.setFoV((this.matchField ? fov : Math.max(fov * 3, 6)) / 60);
    this.hovering = false;
    this.setReadout(ra, dec, "Centre");

    if (this.overlay) this.overlay.removeAll();
    else {
      this.overlay = A.graphicOverlay({ color: "#22d3ee", lineWidth: 2, lineDash: [6, 4], name: "Blink field" });
      aladin.addOverlay(this.overlay);
    }
    this.overlay.add(A.polygon(fieldCorners(ra, dec, fov)));

    // SIMBAD objects: drop the previous catalogue, load the new circle.
    if (this.simbad) { try { this.simbad.removeAll(); this.simbad.hide(); } catch { /* ignore */ } }
    const fail = () => { this.statusEl.textContent = "SIMBAD objects could not be loaded – the sky image still works."; };
    try {
      this.simbad = A.catalogFromURL(simbadUrl(ra, dec, (fov * 1.5) / 60), {
        name: "SIMBAD", color: "#f5b942", sourceSize: 14, shape: "circle", onClick: "showPopup",
      }, null, fail, false);                    // false = no CDS proxy (we have CORS)
      aladin.addCatalog(this.simbad);
    } catch (err) {
      console.warn("SIMBAD overlay failed", err);
      fail();
    }
  }
}
