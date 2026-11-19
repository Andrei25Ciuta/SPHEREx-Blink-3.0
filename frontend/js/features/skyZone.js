// Draft controls for the sky map. The map and inputs never submit a request.
import { parseRA, parseDec } from "../coords.js";
import { MIN_FOV_ARCMIN, REAL_DATA_MAX_FOV_ARCMIN } from "./fieldLimits.js";
import { BROWSE_START } from "./skyBrowse.js";

const FOV_ERROR = `Field of view must be between ${MIN_FOV_ARCMIN} and ${REAL_DATA_MAX_FOV_ARCMIN} arcmin.`;
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

export function parseSkyZone({ ra, dec, fov }) {
  const r = parseZoneCoordinate(ra, parseRA), d = parseZoneCoordinate(dec, parseDec);
  const width = Number(fov);
  const errors = {
    ra: r.ok ? "" : `RA: ${r.error}`,
    dec: d.ok ? "" : `Dec: ${d.error}`,
    fov: Number.isFinite(width) && width >= MIN_FOV_ARCMIN && width <= REAL_DATA_MAX_FOV_ARCMIN ? "" : FOV_ERROR,
  };
  const centre = r.ok && d.ok ? normalizeZoneCentre(r.deg, d.deg) : null;
  const size = errors.fov ? null : rounded(width, 4);
  return { centre, size, errors, query: centre && size !== null ? { ...centre, fov: size } : null };
}

const sameCentre = (a, b) => a?.ra === b?.ra && a?.dec === b?.dec;

export function setupSkyZone({ els, map, submit, unavailable = "" }) {
  const { root, ra, dec, fov, button, error, status } = els;
  if (![root, ra, dec, fov, button, error, status].every(Boolean)) return null;
  const inputs = { ra, dec, fov };
  const fields = Object.keys(inputs);
  const errors = { ra: "", dec: "", fov: "" };
  let centre = null;
  let editingCentre = false; // retain the pair while either coordinate has an unapplied edit
  let active = false;
  let pending = false;
  status.textContent = unavailable;
  button.disabled = true;

  const readDraft = () => parseSkyZone({ ra: ra.value, dec: dec.value, fov: fov.value });
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
    const { size } = readDraft();
    map.setBrowseZone(centre && size !== null ? { ...centre, fov: size } : null);
  }
  function syncCentre(position) {
    if (!active || editingCentre || ra.matches(":focus") || dec.matches(":focus")) return;
    const next = position && normalizeZoneCentre(position.ra, position.dec);
    if (!next || sameCentre(centre, next)) return;
    centre = next;
    ra.value = String(centre.ra);
    dec.value = String(centre.dec);
    drawOutline();
  }
  function applyCoordinates() {
    if (!editingCentre) return;
    const draft = readDraft();
    showErrors({ ra: draft.errors.ra, dec: draft.errors.dec });
    if (!draft.centre) return;
    centre = draft.centre;
    // Keep the edit guard up through gotoRaDec: Aladin can notify synchronously
    // as well as asynchronously. Neither notification should replace typed text.
    map.centreBrowseAt(centre);
    drawOutline();
    editingCentre = false;
  }

  for (const input of [ra, dec]) {
    input.addEventListener("input", () => {
      editingCentre = true;
      showErrors({ [input === ra ? "ra" : "dec"]: "" });
    });
    input.addEventListener("change", applyCoordinates);
    input.addEventListener("blur", () => syncCentre(map.getBrowseCentre()));
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
    status.textContent = "Sending SPHEREx zone request…";
    try {
      applyCoordinates();
      await submit(query);
    } finally {
      pending = false;
      button.disabled = Boolean(unavailable);
    }
  });

  return {
    open(initialQuery) {
      active = true;
      button.disabled = Boolean(unavailable);
      root.hidden = false;
      const position = map.getBrowseCentre();
      // Seed a linked zone only at initial map opening, not when any request or
      // detector updates. Don't undo a pan made while the survey was loading.
      if (initialQuery && position && sameCentre(normalizeZoneCentre(position.ra, position.dec), BROWSE_START)) {
        fov.value = String(initialQuery.fov);
        map.centreBrowseAt(initialQuery);
      }
      syncCentre(map.getBrowseCentre());
    },
    setStatus(message) { status.textContent = message; },
    setUnavailable(message) {
      unavailable = message;
      button.disabled = !active || pending || Boolean(message);
      status.textContent = message;
    },
    syncCentre,
  };
}
