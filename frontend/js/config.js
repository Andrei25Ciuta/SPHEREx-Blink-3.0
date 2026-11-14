// config.js – the ONLY place you change to switch between fake and real data.
//
//   "mock" -> synthetic star fields generated in the browser (js/data/mockSource.js)
//   "api"  -> our own Python backend (backend/app.py, step 7) via js/data/apiSource.js
//
// Without editing this file: add  ?data=api  to the page address to use the backend
// (and  &api=http://localhost:8002  if it runs on another port; only localhost is accepted).
const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);   // Node tests have no location
export const DATA_SOURCE = params.get("data") === "api" ? "api" : "mock";

// Base URL of our backend (used when DATA_SOURCE === "api", and by the sky map's tile proxy).
// Empty string = same origin as the page (e.g. FastAPI also serves the frontend).
const apiParam = params.get("api") || "";
export const API_BASE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiParam) ? apiParam : "http://localhost:8001";
// A public static page must not request a visitor's loopback server. The backend is local-only.
export const CAN_USE_LOCAL_BACKEND = typeof location === "undefined" ||
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

// Where the sky map (Aladin) gets its survey pictures:
//   "auto"    -> the first of these that answers within 2.5 s: "esa", then "backend", then "cds"
//   "esa"     -> ESA's public mirror of the CDS surveys (skies.esac.esa.int)
//   "backend" -> our backend's relay of IRSA's copies (needs the backend running)
//   "cds"     -> CDS (Strasbourg) directly; may be blocked on some networks
export const SKY_TILES = "auto";

// The shared Discovery Pin Board (features/pinSync.js): a Supabase table everyone can read and add to, nobody can change or delete from the site.
// The publishable key is meant to be public; access is limited by the table's row-level security (docs/PIN_BOARD_SETUP.md). Empty = pins stay in each browser.
export const PIN_BOARD_URL = "https://xmxhtkcmaijmapfyuwcg.supabase.co";
export const PIN_BOARD_KEY = "sb_publishable_JT4A-xKALCWAKcyF9SfOxg_HVvJGbTY";
