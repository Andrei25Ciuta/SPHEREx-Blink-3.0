import { DATA_SOURCE, API_BASE, CAN_USE_BACKEND, IS_REMOTE_BACKEND } from "./config.js?v=1";

const badge = document.getElementById("heroDataSource");
if (badge && DATA_SOURCE === "api") {
  if (!CAN_USE_BACKEND) {
    badge.textContent = "Data service unavailable";
    badge.title = "No permitted backend address is configured for this page.";
  } else {
    badge.textContent = IS_REMOTE_BACKEND ? "Checking cloud data service…" : "Checking FITS backend…";
    try {
      const response = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      const health = await response.json();
      if (health.source === "cloud") {
        badge.textContent = "Cloud data service connected";
        badge.title = "The cloud service is available. The workspace identifies the provenance of each loaded field.";
      } else {
        const count = Number.isFinite(health.indexedFiles) ? health.indexedFiles : 0;
        badge.textContent = count ? `FITS backend · ${count} files indexed` : "FITS backend · no files indexed";
        badge.title = "This reports backend availability and indexed files. The workspace identifies the provenance of each loaded field.";
      }
    } catch {
      badge.textContent = IS_REMOTE_BACKEND ? "Cloud data service unavailable" : "FITS backend unavailable";
      badge.title = "The backend could not be reached. No synthetic fallback is automatic.";
    }
  }
}
