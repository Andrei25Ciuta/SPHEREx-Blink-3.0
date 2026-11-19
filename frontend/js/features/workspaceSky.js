// The ordinary Workspace map is independent of the legacy Sky Context and viewer.
export function skyRequestAvailability({ dataSource, legacyReadOnly, canUseBackend, remoteBackend, explicitBackend }) {
  if (dataSource !== "api") return "Map browsing is read-only with Synthetic demo selected. Choose a SPHEREx data service in Settings to request images.";
  if (legacyReadOnly) return "This data-service link is read-only. Zone requests are unavailable.";
  if (!canUseBackend) return "No eligible SPHEREx data service is configured. Map browsing is read-only.";
  if (!remoteBackend && !explicitBackend) return "Map browsing is read-only with the default local FITS backend.";
  return "";
}

export function setupWorkspaceSky({ getElement, createMap, setupZone, submit, unavailable, autoOpen }) {
  const root = getElement("workspace-sky");
  const container = getElement("workspace-sky-map");
  const surface = getElement("workspace-sky-surface");
  const status = getElement("workspace-sky-status");
  const scale = getElement("workspace-sky-scale");
  const button = getElement("workspace-sky-reset");
  if (![root, container, surface, status, scale, button].every(Boolean)) return null;

  const map = createMap(container, status, surface, scale);
  const zoneElement = (suffix) => getElement(`workspace-sky-zone-${suffix}`);
  const zone = setupZone({
    els: {
      root: zoneElement("controls"), ra: zoneElement("ra"), dec: zoneElement("dec"), fov: zoneElement("fov"),
      button: zoneElement("request"), error: zoneElement("error"), status: zoneElement("status"),
    },
    map, submit, unavailable,
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
        zone?.open(initialDraft);
        initialDraft = null;
      } else if (unavailable) status.textContent = `${status.textContent} ${unavailable}`;
    } finally {
      opening = false;
      button.disabled = false;
      labelButton(map.browseSurvey ? "Re-centre sky map" : "Retry sky map");
    }
  }
  button.addEventListener("click", () => void open());
  return {
    start(draft) {
      initialDraft = draft;
      root.hidden = false;
      button.hidden = false;
      labelButton("Show sky map");
      if (autoOpen) void open();
      else status.textContent = ["Sky map not loaded. Select Show sky map to browse public survey images.", unavailable].filter(Boolean).join(" ");
    },
    setStatus(message) {
      if (zone) zone.setStatus(message);
      else status.textContent = message;
    },
    setUnavailable(message) { zone?.setUnavailable(message); },
  };
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
