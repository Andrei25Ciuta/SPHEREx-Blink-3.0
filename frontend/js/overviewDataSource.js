import { DATA_SOURCE, API_BASE, CAN_USE_LOCAL_BACKEND } from "./config.js";

const badge = document.getElementById("heroDataSource");
if (badge && DATA_SOURCE === "api") {
  if (!CAN_USE_LOCAL_BACKEND) {
    badge.textContent = "Backend selected · available locally";
    badge.title = "Open the workspace from the machine running the backend to load FITS data.";
  } else {
    badge.textContent = "Checking FITS backend…";
    try {
      const response = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      const health = await response.json();
      const count = Number.isFinite(health.indexedFiles) ? health.indexedFiles : 0;
      badge.textContent = count
        ? `Backend connected · ${count} FITS files indexed`
        : "Backend connected · no FITS files indexed";
      badge.title = "This reports backend availability and indexed files. The workspace identifies each field's data provenance.";
    } catch {
      badge.textContent = "FITS backend unavailable";
      badge.title = "The backend could not be reached. Start it to load FITS data; no synthetic fallback is automatic.";
    }
  }
}
