// compare.js – "Compare": subtract or add two images (or two whole survey passes) of your choice.
//
// The other modes use fixed rules (Difference = image minus the median of the other passes,
// Stack = everything). Here YOU pick A and B, e.g. "Pass 3 − Pass 1" or "10 Mar − 21 Aug":
//   A − B   orange = brighter in A, blue = fainter in A. A mover shows up as an orange dot (where it
//           is in A) next to a blue dot (where it was in B); still stars cancel out.
//   A + B   the average of both: a deeper picture (more light, less noise).
// Pure functions (no DOM), so they also run in Node tests.

import { passIndices } from "./movers.js";      // the same meaning of "survey pass" as in Find movers

export const OPERATIONS = { sub: "A − B", add: "A + B", wipe: "A / B" };
const GAIN = 2.2;                               // same boost as the Difference mode: makes small changes visible

const day = (f) => f.dateISO.slice(0, 10);

/**
 * What the A and B menus offer: whole survey passes (averaged) and single images.
 * Returns { passes, singles }, each item { value, label, members: [frame indices] }.
 */
export function compareChoices(frames) {
  const pass = passIndices(frames.map((f) => f.mjd));
  const passes = [];
  for (let p = 0; frames.length && p <= pass.at(-1); p++) {
    const members = frames.map((_, i) => i).filter((i) => pass[i] === p);
    const first = day(frames[members[0]]), last = day(frames[members.at(-1)]);
    const when = first === last ? first : `${first} → ${last}`;
    passes.push({ value: `p${p}`, members, label: `Pass ${p + 1} · ${when} · ${members.length} image${members.length === 1 ? "" : "s"}, average` });
  }
  const singles = frames.map((f, i) => ({
    value: `f${i}`, members: [i],
    label: `${f.dateISO.slice(0, 16).replace("T", " ")} · ${f.wavelengthMinUm.toFixed(2)}–${f.wavelengthMaxUm.toFixed(2)} µm`,
  }));
  return { passes, singles };
}

/** Frame indices behind a menu value ("p2" or "f7"); [] if unknown. */
export function membersFor(value, choices) {
  return [...choices.passes, ...choices.singles].find((c) => c.value === value)?.members ?? [];
}

/** A sensible start: the latest pass minus the earliest one (what changed over time). */
export function defaultChoice(choices) {
  const list = choices.passes.length >= 2 ? choices.passes : choices.singles;
  return { a: list.at(-1)?.value ?? "", b: list[0]?.value ?? "" };
}

/** Short name for the info line: "Pass 3" or "2026-03-15". */
export function shortLabel(value, frames) {
  if (value.startsWith("p")) return `Pass ${Number(value.slice(1)) + 1}`;
  const f = frames[Number(value.slice(1))];
  return f ? day(f) : "?";
}

/**
 * A, B = grey values (0..255) of the same size. Returns RGBA pixels (Uint8ClampedArray).
 * op "sub": diverging colours on black (orange: A brighter, blue: A fainter). op "add": grey average.
 */
export function combine(a, b, op = "sub") {
  const rgba = new Uint8ClampedArray(a.length * 4);
  for (let i = 0; i < a.length; i++) {
    if (op === "add") {
      const v = (a[i] + b[i]) / 2;
      rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = v;
    } else {
      const d = (a[i] - b[i]) * GAIN;
      const m = Math.min(255, Math.abs(d));
      if (d >= 0) { rgba[4 * i] = m; rgba[4 * i + 1] = m * 0.62; rgba[4 * i + 2] = m * 0.2; }
      else { rgba[4 * i] = m * 0.25; rgba[4 * i + 1] = m * 0.62; rgba[4 * i + 2] = m; }
    }
    rgba[4 * i + 3] = 255;
  }
  return rgba;
}
