// pinSync.js – the SHARED pin board: pins are kept in a Supabase table that everyone can read and add to, but nobody can change or delete
// from the site (row-level security: a select policy and an insert policy, no update/delete policy; docs/PIN_BOARD_SETUP.md).
// Visitors need no account. Pure: `fetch` is injectable, so Node can test it. Every remote pin is checked against its own SHA-256 before it is shown.

import { verifyPin, PIN_VERSION } from "./pinBoard.js";

/** { url, key } of the shared board, or null when it is not configured. Only https://<ref>.supabase.co and a publishable/anon key are accepted. */
export function sharedConfig(url, key) {
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url ?? "")) return null;
  if (!/^(sb_publishable_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(key ?? "")) return null;
  if (/^sb_secret_/.test(key)) return null;                         // a secret key must never be in a web page
  return { url, key };
}

const headers = (cfg, extra = {}) => ({ apikey: cfg.key, ...(cfg.key.startsWith("eyJ") ? { Authorization: `Bearer ${cfg.key}` } : {}), ...extra });

/** The table row for a pin (the full pin goes in `record`; the columns repeat what the database checks). */
export function pinToRow(pin) {
  return { id: pin.id, hash: pin.hash, observer: pin.observer, ra: pin.ra, dec: pin.dec, found_at: pin.foundAt, data_kind: pin.dataKind, record: pin };
}

/** Read the shared pins, newest first. Rows whose record does not match its hash, or whose columns disagree with the record, are dropped. */
export async function fetchSharedPins(cfg, { fetchFn = fetch, subtle, limit = 500 } = {}) {
  const res = await fetchFn(`${cfg.url}/rest/v1/pins?select=record,hash&order=created_at.desc&limit=${limit}`, { headers: headers(cfg) });
  if (!res.ok) throw new Error(`The shared board answered ${res.status}.`);
  const rows = await res.json();
  const good = [];
  let dropped = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const p = r?.record;
    const ok = p && p.version === PIN_VERSION && p.hash === r.hash && Number.isFinite(p.ra) && Number.isFinite(p.dec) && await verifyPin(p, subtle);
    if (ok) good.push({ ...p, shared: true }); else dropped++;
  }
  return { pins: good, dropped };
}

/** Add one pin. A pin already there (same hash) counts as success. */
export async function pushSharedPin(cfg, pin, { fetchFn = fetch } = {}) {
  const { shared, pending, ...clean } = pin;
  const res = await fetchFn(`${cfg.url}/rest/v1/pins`, {
    method: "POST",
    headers: headers(cfg, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(pinToRow(clean)),
  });
  if (res.ok || res.status === 409) return true;
  throw new Error(`The shared board refused the pin (${res.status}).`);
}

/** Merge the shared pins with this browser's own: one pin per hash, shared copy wins, newest first. */
export function mergePins(local, shared) {
  const byHash = new Map();
  for (const p of local) byHash.set(p.hash, p);
  for (const p of shared) byHash.set(p.hash, { ...p, pending: false });
  return [...byHash.values()].sort((a, b) => Date.parse(b.foundAt) - Date.parse(a.foundAt));
}
