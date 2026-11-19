// Draft controls for the sky map. The map and inputs never submit a request.
import { parseRA, parseDec } from "../coords.js";
import { MIN_FOV_ARCMIN, maxFovForDataSource } from "./fieldLimits.js";
import { BROWSE_START } from "./skyBrowse.js";

const rounded = (value, digits) => Number(value.toFixed(digits)) || 0;
const COLON_NUMBER = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+−-]?\d+)?$/i;

function parseZoneCoordinate(input, parse) {
  // The shared parser discards empty components and accepts signed numbers
  // after stripping the first sign. Refuse these ambiguities before acquisition.
  const magnitude = String(input).trim().replace(/^[+−-]\s*/, "");
  const withoutExponentSigns = magnitude.replace(/([\d.,]e)[+−-](?=\d)/gi, "$1");
  if (/[+−-]/.test(withoutExponentSigns)) {
    return { ok: false, error: "Use at most one sign, at the start of the coordinate." };
  }
  if (magnitude.includes(":") && magnitude.split(":").some(part => !COLON_NUMBER.test(part.trim()))) {
    return { ok: false, error: "Enter a number in every colon-separated component." };
  }
  return parse(input);
}

// Match the acquisition API's precision. Rounding a valid RA just below 360°
// must produce 0°, not an out-of-range 360° in the request or the URL.
export function normalizeZoneCentre(ra, dec) {
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || Math.abs(dec) > 90) return null;
  const wrap = ra % 360;
  const lon = rounded(wrap < 0 ? wrap + 360 : wrap, 8);
  return { ra: lon === 360 ? 0 : lon, dec: rounded(dec, 8) };
}

export function parseSkyZone({ ra, dec, fov }, { dataSource = "api" } = {}) {
  const r = parseZoneCoordinate(ra, parseRA), d = parseZoneCoordinate(dec, parseDec);
  const width = Number(fov);
  const maxFov = maxFovForDataSource(dataSource);
  const errors = {
    ra: r.ok ? "" : `RA: ${r.error}`,
    dec: d.ok ? "" : `Dec: ${d.error}`,
    fov: !Number.isFinite(width) || width < MIN_FOV_ARCMIN || width > maxFov
      ? `Field of view must be between ${MIN_FOV_ARCMIN} and ${maxFov} arcmin.`
      : dataSource !== "api" && !Number.isInteger(width) ? "Use a whole number of arcminutes." : "",
  };
  const centre = r.ok && d.ok ? normalizeZoneCentre(r.deg, d.deg) : null;
  const size = errors.fov ? null : rounded(width, 4);
  return { centre, size, errors, query: centre && size !== null ? { ...centre, fov: size } : null };
}

const sameCentre = (a, b) => a?.ra === b?.ra && a?.dec === b?.dec;

export function setupSkyZone({ els, map, submit, unavailable = "", dataSource = "api" }) {
  const { root, ra, dec, fov, button, error, status } = els;
  if (![root, ra, dec, fov, button, error, status].every(Boolean)) return null;
  const inputs = { ra, dec, fov };
  const fields = Object.keys(inputs);
  const errors = { ra: "", dec: "", fov: "" };
  let centre = null;
  let editingCentre = false; // retain the pair while either coordinate has an unapplied edit
  let active = false;
  let mapReady = false;
  let pending = false;
  status.textContent = unavailable;
  button.disabled = true;

  const readDraft = () => parseSkyZone({ ra: ra.value, dec: dec.value, fov: fov.value }, { dataSource });
  function showErrors(updates) {
    Object.assign(errors, updates);
    for (const key of fields) {
      if (errors[key]) inputs[key].setAttribute("aria-invalid", "true");
      else inputs[key].removeAttribute("aria-invalid");
    }
    const message = fields.map(key => errors[key]).filter(Boolean).join(" ");
    if (error.textContent !== message) error.textContent = message;
  }
  function drawOutline() {
    if (!mapReady) return;
    const { size } = readDraft();
    map.setBrowseZone(centre && size !== null ? { ...centre, fov: size } : null);
  }
  function syncCentre(position) {
    if (!mapReady || editingCentre || ra.matches(":focus") || dec.matches(":focus")) return;
    const next = position && normalizeZoneCentre(position.ra, position.dec);
    if (!next || sameCentre(centre, next)) return;
    centre = next;
    ra.value = String(centre.ra);
    dec.value = String(centre.dec);
    drawOutline();
  }
  function centreMap() {
    if (!mapReady || !centre) return;
    // Aladin can notify synchronously as well as asynchronously. Neither
    // notification should replace typed text on a programmatic recenter.
    const wasEditing = editingCentre;
    editingCentre = true;
    try { map.centreBrowseAt(centre); }
    finally { editingCentre = wasEditing; }
  }
  function setDraft(query) {
    const next = normalizeZoneCentre(query.ra, query.dec);
    if (!next) return;
    centre = next;
    ra.value = String(query.ra);
    dec.value = String(query.dec);
    fov.value = String(query.fov);
    editingCentre = false;
    showErrors({ ra: "", dec: "", fov: "" });
    centreMap();
    fov.dispatchEvent(new Event("input")); // update the shared slider label and outline
  }
  function applyCoordinates() {
    if (!editingCentre) return;
    const draft = readDraft();
    showErrors({ ra: draft.errors.ra, dec: draft.errors.dec });
    if (!draft.centre) return;
    centre = draft.centre;
    centreMap();
    drawOutline();
    editingCentre = false;
  }

  for (const input of [ra, dec]) {
    input.addEventListener("input", () => {
      editingCentre = true;
      showErrors({ [input === ra ? "ra" : "dec"]: "" });
    });
    input.addEventListener("change", applyCoordinates);
    input.addEventListener("blur", () => { if (mapReady) syncCentre(map.getBrowseCentre()); });
  }
  fov.addEventListener("input", () => {
    showErrors({ fov: "" });
    if (active) drawOutline();
  });
  function applySize() {
    showErrors({ fov: readDraft().errors.fov });
    if (active) drawOutline();
  }
  fov.addEventListener("change", applySize);
  for (const input of Object.values(inputs)) {
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      if (input === fov) applySize();
      else applyCoordinates();
    });
  }

  // The native button handles pointer, Enter and Space activation. Do not
  // submit from a form, a repeated keydown, or the second click of a double-click.
  button.form?.addEventListener("submit", event => event.preventDefault());
  button.addEventListener("keydown", event => {
    if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
  });
  button.addEventListener("click", async event => {
    if (!active || unavailable || pending || !event.isTrusted || event.detail > 1) return;
    const { query, errors: invalid } = readDraft();
    showErrors(invalid);
    if (!query) {
      inputs[fields.find(key => invalid[key])]?.focus({ preventScroll: true });
      return;
    }

    pending = true;
    button.disabled = true;
    status.textContent = dataSource === "api" ? "Sending SPHEREx zone request…" : "Opening synthetic demo images…";
    try {
      applyCoordinates();
      await submit(query);
    } finally {
      pending = false;
      button.disabled = Boolean(unavailable);
    }
  });

  return {
    open(initialQuery, { offline = false } = {}) {
      active = true;
      button.disabled = pending || Boolean(unavailable);
      root.hidden = false;
      if (offline) {
        setDraft(initialQuery);
        return;
      }
      mapReady = true;
      const position = map.getBrowseCentre();
      // Seed a linked zone only at initial map opening, not when any request or
      // detector updates. Don't undo a pan made while the survey was loading.
      if (initialQuery && position && sameCentre(normalizeZoneCentre(position.ra, position.dec), BROWSE_START)) {
        fov.value = String(initialQuery.fov);
        map.centreBrowseAt(initialQuery);
      }
      syncCentre(map.getBrowseCentre());
    },
    connectMap() {
      mapReady = true;
      // Use the live draft (including edits made while the optional map was
      // loading), not the startup URL or Aladin's default position.
      centre = readDraft().centre ?? centre;
      centreMap();
      drawOutline();
    },
    setDraft,
    setStatus(message) { status.textContent = message; },
    setUnavailable(message) {
      unavailable = message;
      button.disabled = !active || pending || Boolean(message);
      status.textContent = message;
    },
    syncCentre,
  };
}
