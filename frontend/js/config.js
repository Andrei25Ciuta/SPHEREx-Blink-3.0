// config.js – the ONLY place you change to switch between fake and real data.
//
//   "mock" -> synthetic star fields generated in the browser (js/data/mockSource.js)
//   "api"  -> our own Python backend (backend/app.py, step 7) via js/data/apiSource.js
//
// Without editing this file: add  ?data=api  to the page address to use the backend
// Add &api=https://<cloud-service> for a prepared backend, or HTTP localhost for local use.
import { backendAddress } from "./data/backendAddress.js";
const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);   // Node tests have no location
export const DATA_SOURCE = params.get("data") === "api" ? "api" : "mock";
// Opt-in, browse-only pilot. No dependency on a configured Blink acquisition API.
export const SKY_BROWSE = DATA_SOURCE === "api" && params.get("sky_browse") === "1";
// Set only on links to a prepared legacy API that cannot receive the new POST acquisition trigger.
export const LEGACY_API_READ_ONLY = params.get("legacy_api") === "1";

// Base URL of our backend (used when DATA_SOURCE === "api", and by the sky map's tile proxy).
// No explicit address defaults to localhost, which public pages are not allowed to contact.
const apiParam = params.get("api") || "";
const backend = backendAddress(apiParam, typeof location === "undefined" ? "localhost" : location.hostname);
export const API_BASE = backend.base;
export const CAN_USE_BACKEND = backend.allowed;
export const BACKEND_ERROR = backend.error;
export const IS_REMOTE_BACKEND = backend.remote;
// Companion tools still require the local backend's catalogue/survey/HiPS endpoints.
export const CAN_USE_LOCAL_BACKEND = typeof location === "undefined" ||
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

// Where the sky map (Aladin) gets its survey pictures:
//   "auto"    -> try IRSA directly, then ESA, the local relay and CDS
//   "irsa"    -> IRSA’s public HiPS archive
//   "esa"     -> ESA's public mirror of the CDS surveys (skies.esac.esa.int)
//   "backend" -> our backend's relay of IRSA's copies (needs the backend running)
//   "cds"     -> CDS (Strasbourg) directly; may be blocked on some networks
export const SKY_TILES = "auto";

// The shared Discovery Pin Board (features/pinSync.js): a Supabase table everyone can read and add to, nobody can change or delete from the site.
// The publishable key is meant to be public; access is limited by the table's row-level security (docs/PIN_BOARD_SETUP.md). Empty = pins stay in each browser.
export const PIN_BOARD_URL = "https://xmxhtkcmaijmapfyuwcg.supabase.co";
export const PIN_BOARD_KEY = "sb_publishable_JT4A-xKALCWAKcyF9SfOxg_HVvJGbTY";
