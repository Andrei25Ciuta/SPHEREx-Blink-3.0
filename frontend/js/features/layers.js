// layers.js – the layers drawn on top of the image: their names, their colours and how many objects each holds.
// Pure (no DOM): the colours are used by player.js to draw AND by viewerControls.js to paint the swatches of the layer list, so the key
// next to a checkbox can never drift from what is on the canvas. The images are dark grey in every colour theme, so these are fixed colours
// chosen for contrast on grey (the CSS theme tokens are for the page, not for the picture).

export const OVERLAY_COLORS = {
  flags: "#FF283C",                 // bad pixels: red, on a transparent PNG made by the backend
  tracks: "#FBE9D0",                // predicted places of the test objects: cream
  catalogue: "#90AEAD",             // catalogue stars (SIMBAD): pale teal
  asteroids: "#F2A93B",             // known asteroids (SkyBoT): amber
  candidates: "#EA4F39",            // movers found by the search: orange
  candidateSelected: "#F4806A",     // the one picked in the list
  marker: "#FFFF29",                // the measuring circle: yellow (hsl(55 100% 60%))
  grid: "#8FB2E0",                  // the coordinate grid: pale blue, drawn thin and see-through so it never hides a dot
  scalebar: "#FBE9D0",
};

/**
 * One entry per layer. `checkbox` = id of the checkbox in index.html, `swatch` = how the key is drawn.
 * `needsData` = true when the layer has to be fetched or computed first (the checkbox can only show it once there is something).
 */
export const LAYERS = [
  { id: "flags", label: "Flagged pixels", checkbox: "show-flags", color: OVERLAY_COLORS.flags, swatch: "square", needsData: false },
  { id: "tracks", label: "Predicted positions", checkbox: "show-track", color: OVERLAY_COLORS.tracks, swatch: "ring", needsData: true },
  { id: "catalogue", label: "Catalogue stars (SIMBAD)", checkbox: "show-catalogue", color: OVERLAY_COLORS.catalogue, swatch: "ring", needsData: true },
  { id: "asteroids", label: "Known asteroids (SkyBoT)", checkbox: "show-asteroids", color: OVERLAY_COLORS.asteroids, swatch: "diamond", needsData: true },
  { id: "candidates", label: "Movers found", checkbox: "show-candidates", color: OVERLAY_COLORS.candidates, swatch: "ring", needsData: true },
  { id: "marker", label: "Measuring circle", checkbox: "show-marker", color: OVERLAY_COLORS.marker, swatch: "ring", needsData: true },
  { id: "grid", label: "Coordinate grid (RA, Dec)", checkbox: "show-grid", color: OVERLAY_COLORS.grid, swatch: "cross", needsData: false },
  { id: "scalebar", label: "Scale bar", checkbox: "show-scalebar", color: OVERLAY_COLORS.scalebar, swatch: "bar", needsData: false },
];

/** The order the layers are drawn in, back to front: what player.js always did, and where the list of layers starts. */
export const DRAW_ORDER = ["flags", "grid", "tracks", "catalogue", "asteroids", "candidates", "marker", "scalebar"];

/** An opacity from the slider or from anywhere: a number from 0 to 1; anything else (NaN, text, missing) is 1 = fully opaque. */
export function clampOpacity(v) {
  const x = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 1;
}

/** True when `order` holds every layer exactly once. */
export const isDrawOrder = (order) => Array.isArray(order) && order.length === LAYERS.length && LAYERS.every((l) => order.filter((id) => id === l.id).length === 1);

/** A usable order: the one given when it is complete, the default otherwise. */
export const normaliseOrder = (order) => (isDrawOrder(order) ? [...order] : [...DRAW_ORDER]);

/**
 * Move one layer one place toward the front ("front") or toward the back ("back") in a back-to-front order. The ends stay where they are.
 * Returns a new array; an unknown layer changes nothing.
 */
export function moveLayer(order, id, toward) {
  const list = normaliseOrder(order);
  const i = list.indexOf(id);
  const j = toward === "front" ? i + 1 : toward === "back" ? i - 1 : i;
  if (i < 0 || j < 0 || j >= list.length || j === i) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

/** The percent for a label: 0.7 -> "70 %". */
export const opacityLabel = (v) => `${Math.round(clampOpacity(v) * 100)} %`;

/**
 * How many objects each layer holds right now. null = this layer has no count (flags, scale bar).
 * `state` = { tracks, catalogue, asteroids, candidates, marker, isAnimated, index }, as kept by the player.
 */
export function layerCounts(state) {
  const { tracks = [], catalogue = [], asteroids = [], candidates = [], marker = null, isAnimated = true, index = 0 } = state;
  // One asteroid is a different dot on every date: on screen in the animated modes = those of this date; otherwise every body once.
  const bodies = isAnimated
    ? (asteroids[index] ?? []).length
    : new Set(asteroids.flatMap((list) => (list ?? []).map((a) => a.name))).size;
  return { flags: null, tracks: tracks.length, catalogue: catalogue.length, asteroids: bodies, candidates: candidates.length, marker: marker ? 1 : 0, grid: null, scalebar: null };
}
