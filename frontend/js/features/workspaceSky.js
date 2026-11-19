// The ordinary Workspace map is independent of the legacy Sky Context and viewer.
import { BROWSE_START } from "./skyBrowse.js";

export function skyRequestAvailability({ dataSource, legacyReadOnly, canUseBackend, remoteBackend, explicitBackend }) {
  if (dataSource !== "api") return "Observed SPHEREx requests are unavailable with Synthetic demo selected.";
  if (legacyReadOnly) return "This data-service link is read-only. Zone requests are unavailable.";
  if (!canUseBackend) return "No eligible SPHEREx data service is configured. Map browsing is read-only.";
  if (!remoteBackend && !explicitBackend) return "Map browsing is read-only with the default local FITS backend.";
  return "";
}

export function setupWorkspaceSky({ getElement, createMap, setupZone, submit, unavailable, autoOpen, dataSource = "api" }) {
  const root = getElement("workspace-sky");
  const container = getElement("workspace-sky-map");
  const surface = getElement("workspace-sky-surface");
  const status = getElement("workspace-sky-status");
  const scale = getElement("workspace-sky-scale");
  const button = getElement("workspace-sky-reset");
  if (![root, container, surface, status, scale, button].every(Boolean)) return null;

  const synthetic = dataSource !== "api";
  let fov = getElement("workspace-sky-zone-fov");
  if (synthetic) {
    const slot = getElement("workspace-sky-synthetic-fov");
    const apiLabel = getElement("workspace-sky-api-fov");
    const wrapper = getElement("workspace-legacy-fov");
    fov = getElement("fov-input");
    if (![slot, apiLabel, wrapper, fov].every(Boolean)) return null;
    slot.append(wrapper);
    slot.hidden = false;
    apiLabel.hidden = true;
    fov.setAttribute("aria-describedby", "workspace-sky-zone-error");
  }

  const map = createMap(container, status, surface, scale);
  const zoneElement = (suffix) => getElement(`workspace-sky-zone-${suffix}`);
  const zone = setupZone({
    els: {
      root: zoneElement("controls"), ra: zoneElement("ra"), dec: zoneElement("dec"), fov,
      button: zoneElement("request"), error: zoneElement("error"), status: zoneElement("status"),
    },
    map, submit, unavailable, dataSource,
  });
  let initialDraft, opening = false;
  function labelButton(label) {
    button.textContent = label;
    button.setAttribute("aria-label", label);
  }
  async function open() {
    if (opening) return;
    if (map.browseSurvey) { map.centreBrowse(); return; }
    opening = true;
    button.disabled = true;
    try {
      if (await map.openBrowse({ onCentre: zone?.syncCentre })) {
        if (synthetic) zone?.connectMap();
        else zone?.open(initialDraft);
        initialDraft = null;
      } else if (unavailable) status.textContent = `${status.textContent} ${unavailable}`;
    } finally {
      opening = false;
      button.disabled = false;
      labelButton(map.browseSurvey ? "Re-centre survey map" : "Retry survey map");
    }
  }
  button.addEventListener("click", () => void open());
  return {
    synthetic,
    start(draft) {
      initialDraft = draft;
      root.hidden = false;
      button.hidden = false;
      labelButton("Open survey map");
      if (synthetic) zone?.open(draft ?? { ...BROWSE_START, fov: Number(fov.value) }, { offline: true });
      if (!synthetic && autoOpen) void open();
      else status.textContent = ["Survey imagery is optional. Select Open survey map to browse it.", unavailable].filter(Boolean).join(" ");
    },
    syncSyntheticField(query) {
      if (synthetic) zone?.setDraft(query);
    },
    setStatus(message) {
      if (zone) zone.setStatus(message);
      else status.textContent = message;
    },
    setUnavailable(message) { zone?.setUnavailable(message); },
  };
}

/** This local path shares playback, not the observed request lifecycle. */
export async function openSyntheticZone(query, { writeUrl, load, report, handoff }) {
  writeUrl({ ...query, dateFrom: null, dateTo: null, request_id: null });
  const loaded = await load(query);
  if (loaded === true) {
    report(`Synthetic demo ready: RA ${query.ra}°, Dec ${query.dec}°, ${query.fov}′ field.`);
    handoff();
  } else if (loaded === false) { // A superseded load reports nothing.
    report("Could not open synthetic demo images. Try requesting the zone again.");
  }
}

// An implicit Enter in another field can synthesize a trusted click on the
// default button. Require a pointer click or keyboard activation on the button.
export function explicitLoadActivation(event, button, activeElement) {
  return event.isTrusted && (event.detail === 1 || (event.detail === 0 && activeElement === button));
}

export function moveToPhotoViewer(viewer, reducedMotion) {
  viewer?.focus({ preventScroll: true });
  viewer?.scrollIntoView({ block: "start", behavior: reducedMotion ? "instant" : "smooth" });
}
