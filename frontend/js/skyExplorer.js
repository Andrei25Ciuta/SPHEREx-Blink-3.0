import { parseRA, parseDec } from "./coords.js";
import { API_BASE, CAN_USE_LOCAL_BACKEND } from "./config.js";
import { tangentPoint } from "./features/explorerGeometry.js";
import { TARGETS, positionAtEpoch } from "./targets.js";

const $ = id => document.getElementById(id);
$("workspace").hidden = !CAN_USE_LOCAL_BACKEND;
$("workspace-help").hidden = CAN_USE_LOCAL_BACKEND;
$("search").querySelector('button[type="submit"]').disabled = !CAN_USE_LOCAL_BACKEND;
if (!CAN_USE_LOCAL_BACKEND) $("live-search-help").textContent =
  "Live IRSA search requires the local Blink backend. Explore the saved QR2 field below.";
let map;
const params = new URLSearchParams(location.search);
const stateKeys = ["ra", "dec", "fov", "collection"];
let current, selected, overlay, request;

function projectAtlas(ra, dec) {
  // A deliberately simple whole-sky orientation projection. It is not used for
  // measurements or coverage; the archive query always receives the exact coordinates.
  return [450 + ((180 - ra + 540) % 360 - 180) * 2.25, 240 - dec * 2.05];
}

function setupAtlas() {
  const svg = $("sky-atlas-map");
  const group = $("atlas-targets");
  const choices = $("atlas-target-list");
  if (!svg || !group || !choices) return;
  const selectTarget = new Map();
  const ns = svg.namespaceURI;
  for (const [index, target] of TARGETS.entries()) {
    const { ra, dec } = positionAtEpoch(target);
    const [x, y] = projectAtlas(ra, dec);
    const marker = document.createElementNS(ns, "g");
    marker.classList.add("atlas-marker");
    marker.style.setProperty("--target-color", ["#ffcf70", "#70e1dc", "#ff8ab1", "#b4a0ff", "#a7ef9d"][index % 5]);
    marker.innerHTML = `<circle cx="${x}" cy="${y}" r="7"></circle><text x="${x + 12}" y="${y + 5}">${target.label}</text>`;
    const choose = () => {
      $("ra").value = ra.toFixed(7); $("dec").value = dec.toFixed(7);
      updateWorkspacePreview();
      $("atlas-selected").textContent = target.label;
      $("atlas-detail").textContent = `${target.kind}. Coordinates were propagated from its documented J2000 position to the Blink reference epoch; adjust the field diameter, then search IRSA.`;
      $("atlas-search").hidden = false;
      group.querySelectorAll(".is-selected").forEach(item => item.classList.remove("is-selected")); marker.classList.add("is-selected");
      choices.querySelectorAll("[aria-pressed]").forEach(item => item.setAttribute("aria-pressed", String(item === choice)));
      document.dispatchEvent(new CustomEvent("sky-target-selected", { detail: { id: target.id } }));
    };
    marker.addEventListener("click", choose);
    const choice = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-small", textContent: target.label });
    choice.setAttribute("aria-pressed", "false"); choice.addEventListener("click", choose);
    selectTarget.set(target.id, choose);
    group.append(marker);
    choices.append(choice);
  }
  document.addEventListener("sky-target-select", event => selectTarget.get(event.detail?.id)?.());
}

function readQuery() {
  const ra = parseRA($("ra").value), dec = parseDec($("dec").value);
  if (!ra.ok || !dec.ok || !$("search").reportValidity()) {
    $("status").textContent = ra.error || dec.error || "Enter a valid search diameter.";
    return null;
  }
  return {ra: ra.deg, dec: dec.deg, fov: $("fov").valueAsNumber, collection: $("collection").value};
}

function updateWorkspacePreview() {
  const ra = parseRA($("ra").value), dec = parseDec($("dec").value);
  const fov = $("fov").valueAsNumber;
  const link = $("preview-workspace");
  if (!ra.ok || !dec.ok || !Number.isInteger(fov) || fov < 1 || fov > 30) {
    link.hidden = true;
    $("preview-field").textContent = "Enter valid coordinates and a whole-number field width from 1 to 30 arcmin.";
    return;
  }
  const url = new URL("index.html", location.href);
  url.search = new URLSearchParams({ ra: ra.deg, dec: dec.deg, fov, data: "mock" });
  url.hash = "workspace";
  link.href = url.href;
  link.hidden = false;
  $("preview-field").textContent = `${fov}′ field · synthetic images`;
}

function validArchiveResponse(body) {
  return body && Array.isArray(body.records) && body.query &&
    stateKeys.every(key => body.query[key] !== undefined) &&
    typeof body.source === "string" && typeof body.retrieved === "string" &&
    body.records.every(record => record && typeof record.id === "string" &&
      (record.detector === null || typeof record.detector === "string") &&
      (record.startMjd === null || Number.isFinite(record.startMjd)) &&
      (record.productUrl === null || typeof record.productUrl === "string") &&
      (record.footprint === null || Array.isArray(record.footprint) &&
        record.footprint.every(point => Array.isArray(point) && point.length === 2 &&
          point.every(Number.isFinite))));
}

function plot(records) {
  const { ra, dec } = current.query;
  const polygons = records.map(record => record.footprint?.map(([a, d]) => tangentPoint(a, d, ra, dec)));
  let limit = 0.01;
  for (const polygon of polygons) {
    if (polygon?.every(Boolean)) for (const [x, y] of polygon) limit = Math.max(limit, Math.abs(x), Math.abs(y));
  }
  const scale = 164 / limit;
  const svg = $("footprints");
  svg.replaceChildren();
  function shape(tag, attrs, content) {
    const element = document.createElementNS(svg.namespaceURI, tag);
    for (const [key,value] of Object.entries(attrs)) element.setAttribute(key, value);
    element.textContent = content || "";
    svg.append(element);
  }
  shape("path", { d: "M200 25V375M25 200H375", class: "axis" });
  shape("text", { x: 207, y: 23 }, "N"); shape("text", {x: 8, y: 193}, "E");
  const draw = (points, cls) => shape("polygon", {points: points.map(([x,y]) => [200 - x*scale, 200 - y*scale].join(",")).join(" "), class: cls});
  polygons.forEach(points => { if (points?.every(Boolean)) draw(points, "coverage"); });
  const active = polygons[records.indexOf(selected)];
  if (active?.every(Boolean)) draw(active, "active");
  $("scale").textContent = `Tangent-plane width ${(400 / scale).toFixed(2)}° · ${polygons.filter(p => p?.every(Boolean)).length} outlines. The selected product has a thicker outline.`;
}

function workspaceUrl() {
  const url = new URL("index.html", location.href);
  const {ra, dec, fov} = current.query;
  url.search = new URLSearchParams({ra, dec, fov, data:"api", det:selected?.detector || $("detector").value});
  if (params.has("api") && params.get("api") === API_BASE) url.searchParams.set("api", API_BASE);
  url.hash = "workspace";
  return url;
}

function drawMapOverlay() {
  if (!map?.isOpen) return;
  if (!overlay) {
    overlay = map.A.graphicOverlay({name:"Selected IRSA product", color:"#f5b942", lineWidth:3});
    map.aladin.addOverlay(overlay);
  }
  overlay.removeAll();
  if (selected?.footprint) overlay.add(map.A.polygon(selected.footprint));
}

function renderProducts() {
  const records = current.records.filter(r => $("detector").value === "all" || r.detector === $("detector").value);
  if (!records.includes(selected)) selected = records[0];
  $("empty-products").hidden = records.length > 0;
  $("workspace").hidden = !CAN_USE_LOCAL_BACKEND || !selected;
  const rows = $("rows");
  function select(record, button) {
    selected = record;
    for (const control of rows.querySelectorAll("button")) control.setAttribute("aria-pressed", String(control === button));
    plot(records);
    drawMapOverlay();
    $("workspace").href = workspaceUrl();
  }
  plot(records); drawMapOverlay();
  rows.replaceChildren(...records.map(record => {
    const tr = document.createElement("tr");
    const button = Object.assign(document.createElement("button"), {type:"button", className:"btn btn-small", textContent:record.id});
    button.setAttribute("aria-pressed", String(record === selected));
    button.addEventListener("click", () => select(record, button));
    tr.insertCell().append(button);
    tr.insertCell().textContent = record.detector ?? "Unknown";
    tr.insertCell().textContent = record.startMjd?.toFixed(6) ?? "Unavailable";
    const file = tr.insertCell();
    if (record.productUrl) file.append(Object.assign(document.createElement("a"), {href:record.productUrl,textContent:"FITS"}));
    else file.textContent = "Unavailable";
    return tr;
  }));
  if (selected) $("workspace").href = workspaceUrl();
  else $("workspace").removeAttribute("href");
}

async function search(saved) {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  if (!saved && !CAN_USE_LOCAL_BACKEND) {
    $("status").textContent = "Live archive search requires the local Blink backend. Load the saved QR2 field instead.";
    return;
  }
  const query = saved ? null : readQuery();
  if (!saved && !query) return;
  $("products").hidden = true;
  selected = null;
  drawMapOverlay();
  const base = API_BASE && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API_BASE) &&
    !["localhost","127.0.0.1","[::1]"].includes(location.hostname) ? location.origin : API_BASE;
  const url = saved ? "data/sky-example.json" : base + "/api/observations?" + new URLSearchParams(query);
  $("status").textContent = saved ? "Reading the saved IRSA field…" : "Querying IRSA…";
  try {
    const response = await fetch(url, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])});
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      throw new Error(typeof problem?.detail === "string" ? problem.detail : `HTTP ${response.status}`);
    }
    const body = await response.json();
    if (controller.signal.aborted) return;
    if (!validArchiveResponse(body))
      throw new Error("Invalid archive metadata response.");
    current = body;
    for (const key of stateKeys) $(key).value = current.query[key];
    updateWorkspacePreview();
    selected = null;
    const detectors = [...new Set(current.records.map(r => r.detector).filter(Boolean))].sort();
    $("detector").replaceChildren(new Option("All detectors","all"), ...detectors.map(d => new Option(d,d)));
    $("source").href = current.source;
    $("provenance").textContent = `${saved ? "Saved" : "Live"} IRSA SIA2 response · ${current.query.collection} · retrieved ${current.retrieved.slice(0,19).replace("T"," ")} UTC.`;
    $("status").textContent = `${current.records.length} image products${current.truncated ? " shown (response limited to 100)" : " found"}.`;
    $("products").hidden = false;
    if (map?.isOpen) map.update(current.query);
    renderProducts();
    const next = new URL(location.href);
    for (const key of stateKeys) saved ? next.searchParams.delete(key) : next.searchParams.set(key, current.query[key]);
    history.replaceState(null, "", next);
  } catch (error) {
    if (controller.signal.aborted) return;
    $("status").textContent = saved ? "The saved field could not be loaded." :
      `Live archive search unavailable. Run the Blink backend and retry, or load the saved QR2 field. (${error.message})`;
  }
}

$("search").addEventListener("submit", event => { event.preventDefault(); search(false); });
$("example").addEventListener("click", () => search(true));
$("detector").addEventListener("change", renderProducts);
$("survey").addEventListener("change", () => map?.setSurvey($("survey").value));
$("map-start").addEventListener("click", async () => {
  const query = readQuery();
  if (!query) return;
  $("map-start").disabled = true;
  try {
    if (!map) {
      $("map-status").textContent = "Loading the survey map…";
      const { SkyContext } = await import("./features/skyContext.js");
      map = new SkyContext($("aladin-box"), $("map-status"));
    }
    await map.open(query, $("survey").value);
    if (map.isOpen) { map.aladin.setFoV(query.fov / 60); drawMapOverlay(); }
    $("use-centre").disabled = !map.isOpen;
  } catch { $("map-status").textContent = "Sky map unavailable. Check WebGL2 support and network access."; }
  finally { $("map-start").disabled = false; }
});
$("use-centre").addEventListener("click", () => {
  const [ra, dec] = map.aladin.getRaDec();
  $("ra").value = ra.toFixed(7); $("dec").value = dec.toFixed(7);
  updateWorkspacePreview();
  $("status").textContent = "Map centre copied. Search IRSA to update the products.";
});
for (const key of stateKeys) if (params.has(key)) $(key).value = params.get(key);
$("search").addEventListener("input", updateWorkspacePreview);
setupAtlas();
updateWorkspacePreview();
if (!stateKeys.some(key => params.has(key))) search(true);
else if (CAN_USE_LOCAL_BACKEND) search(false);
