// Pure coordinate helpers for Aladin Lite's Sky Context mouse events.
// pix2world returns ICRS positions even if a different frame is displayed.
export function aladinSkyAt(aladin, event) {
  if (!aladin || !event) return null;
  let coordinates = null;
  if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
    try { coordinates = aladin.pix2world(event.x, event.y, "icrs"); }
    catch { return null; }
  }
  if (!coordinates && Number.isFinite(event.ra) && Number.isFinite(event.dec) &&
      (!event.frame || /^(icrs|equatorial)$/i.test(event.frame))) {
    coordinates = [event.ra, event.dec];
  }
  if (!Array.isArray(coordinates) || !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1]) || Math.abs(coordinates[1]) > 90) return null;
  return { ra: ((coordinates[0] % 360) + 360) % 360, dec: coordinates[1] };
}

export function selectionText({ ra, dec }) {
  const raText = (Number(ra.toFixed(5)) % 360).toFixed(5);
  const decText = dec.toFixed(5);
  return { raText, decText, clipboardText: `RA ${raText}°, Dec ${decText}°` };
}

// Called synchronously inside the Aladin click callback to keep clipboard permissions
// tied to a direct gesture. The field loader must not wait for clipboard permissions.
export function copySkySelection(text, { clipboard = globalThis.navigator?.clipboard,
    document: doc = globalThis.document } = {}) {
  const fallback = () => {
    if (!doc?.createElement || !doc?.body) return false;
    const input = doc.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    doc.body.appendChild(input);
    input.select();
    let copied = false;
    try { copied = Boolean(doc.execCommand?.("copy")); } catch {}
    input.remove();
    return copied;
  };
  if (clipboard?.writeText) {
    try { return Promise.resolve(clipboard.writeText(text)).then(() => true, fallback); }
    catch { return Promise.resolve(fallback()); }
  }
  return Promise.resolve(fallback());
}
