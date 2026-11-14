// workspace.js – the layout of the workspace page: three panels (search | picture | inspector) on a wide screen, two or one on a narrower one.
//
// Pure (no DOM, no storage access), so scratch/test_workspace.mjs tests it with Node. workspaceView.js is the DOM part: it reads the width
// of the window, keeps the choice of which side panels are open, moves the details of a selected candidate into the inspector and back.
//
// What is a "side panel": the search panel on the left (section 1) and the inspector on the right. Closing one gives its room to the picture;
// the picture panel never closes. The choice is a per-viewer convenience (localStorage, may be missing), never part of the shared link.

/** From this width (CSS px) the inspector has a column of its own. */
export const BREAKPOINT_THREE = 1180;
/** From this width the search panel sits beside the picture (styles.css puts everything in one column up to 860 px). */
export const BREAKPOINT_TWO = 861;

/** "three" | "two" | "one": how many columns the workspace has at this window width. */
export const layoutFor = (width) => (width >= BREAKPOINT_THREE ? "three" : width >= BREAKPOINT_TWO ? "two" : "one");

export const SIDES = ["left", "right"];
/** true = open. */
export const DEFAULT_PANELS = { left: true, right: true };
export const STORAGE_KEY = "blink.panels";

/** The saved choice, from the text in storage. Anything that is not exactly two booleans falls back to "open" for that side. */
export function parsePanels(raw) {
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  const pick = (side) => (data && typeof data === "object" && typeof data[side] === "boolean" ? data[side] : DEFAULT_PANELS[side]);
  return { left: pick("left"), right: pick("right") };
}

export const serialisePanels = (state) => JSON.stringify({ left: Boolean(state.left), right: Boolean(state.right) });

/** The state with one side flipped; an unknown side changes nothing. */
export function togglePanel(state, side) {
  if (!SIDES.includes(side)) return { ...state };
  return { ...state, [side]: !state[side] };
}

/** The key that flips a side: [ for the search panel, ] for the inspector. null for any other key. */
export const sideForKey = (key) => (key === "[" ? "left" : key === "]" ? "right" : null);

/** Where the details of a selected candidate are shown: in the inspector on a three-panel screen, under their list otherwise. */
export const detailsHome = (layout) => (layout === "three" ? "inspector" : "list");

const NAMES = { left: "the search panel", right: "the inspector" };
const KEYS = { left: "[", right: "]" };

/** The words of a side panel's button: what it does now (hide or show), as a label and as a tooltip with the key. */
export function toggleWords(side, open) {
  const label = `${open ? "Hide" : "Show"} ${NAMES[side]}`;
  return { label, title: `${label} (${KEYS[side]})` };
}

/** What the inspector says while no candidate is selected; it depends on where the details would appear. */
export function emptyHint(layout) {
  return detailsHome(layout) === "inspector"
    ? "Press a candidate in a list (Find movers, Find everything) and its description, pictures and measurements appear here."
    : "Press a candidate in a list and its description appears under that list.";
}

export const MARK_IDLE = "Click the picture to mark a position. It is described here, with measurements below the viewer.";

/** One line for the marked position from the parts of readout.js (pixel, sky, offset, value); parts that are empty are left out. */
export const markText = (parts) => [parts.pixel, parts.sky, parts.offset, parts.value].filter(Boolean).join(" · ");
