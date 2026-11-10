// Tests for the timeline of the images (js/features/timeline.js): survey passes, where each image goes on the plot, the filter, and stepping through the
// images that pass it. Run: node scratch/test_timeline.mjs
import {
  midWavelength, wavelengthRange, surveyPasses, layoutTimeline, activeIndices, isFiltered, stepActive, describeFrame, timelineSummary, hasManyFlags, FLAGGED_LIMIT,
} from "../frontend/js/features/timeline.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// 18 synthetic D2 images: four survey passes about 180 days apart (4, 5, 5 and 4 images), each pass sweeping the filter from 1.09 µm upwards
const SIZES = [4, 5, 5, 4], STARTS = [60900, 61080, 61260, 61440];
const frames = [];
SIZES.forEach((n, p) => {
  for (let k = 0; k < n; k++) {
    const wl = 1.09 + 0.032 * (k * 4 + p);                                  // 1.09 ... about 1.68
    const mjd = STARTS[p] + k * 0.6;                                        // a pass lasts a few days
    const d = new Date(Date.UTC(1858, 10, 17) + mjd * 86400000).toISOString();
    frames.push({ mjd, dateISO: d.slice(0, 19) + "Z", detector: "D2", wavelengthMinUm: wl - 0.015, wavelengthMaxUm: wl + 0.015, flags: { anyFlagged: k === 2 && p === 1, fractionFlagged: k === 2 && p === 1 ? 0.032 : 0 } });
  }
});

// ---------------------------------------------------------------- wavelengths and passes
{
  check("midWavelength is the middle of the band", near(midWavelength({ wavelengthMinUm: 1.5, wavelengthMaxUm: 1.53 }), 1.515));
  const r = wavelengthRange(frames);
  check("wavelengthRange: the smallest and the largest middle wavelength", near(r.min, 1.09) && r.max > 1.6 && r.max < 1.7, `${r.min.toFixed(3)}–${r.max.toFixed(3)}`);
  check("wavelengthRange: nothing usable gives null", wavelengthRange([]) === null && wavelengthRange([{ wavelengthMinUm: NaN, wavelengthMaxUm: NaN }]) === null);
  const passes = surveyPasses(frames);
  check("surveyPasses: four passes of 4, 5, 5 and 4 images, in order", passes.map((p) => p.indices.length).join() === "4,5,5,4" && passes.map((p) => p.label).join() === "Pass 1,Pass 2,Pass 3,Pass 4");
  check("surveyPasses: every image is in exactly one pass, and the passes keep time order", passes.flatMap((p) => p.indices).join() === frames.map((_, i) => i).join());
  check("surveyPasses: the dates of a pass", /^\d{4}-\d\d-\d\d$/.test(passes[0].first) && passes[0].when.includes("→") && passes[0].first <= passes[0].last && passes[1].first > passes[0].last, passes[0].when);
  check("surveyPasses: no images, no passes; one image, one pass", surveyPasses([]).length === 0 && surveyPasses([frames[0]]).length === 1);
}

// ---------------------------------------------------------------- the layout
{
  const L = layoutTimeline(frames);
  check("layout: one point per image, x and y inside 0..1", L.points.length === 18 && L.points.every((p, i) => p.index === i && p.x > 0 && p.x < 1 && p.y >= 0 && p.y <= 1));
  check("layout: x grows with time (the images are in time order)", L.points.every((p, i, a) => i === 0 || p.x > a[i - 1].x));
  const inside = L.points[1].x - L.points[0].x, across = L.points[4].x - L.points[3].x;
  check("layout: the space between two passes is wider than the space between two images of a pass", across > inside * 1.5, `${across.toFixed(4)} vs ${inside.toFixed(4)}`);
  check("layout: the shortest wavelength is at the bottom (y = 0) and the longest at the top (y = 1)", near(Math.min(...L.points.map((p) => p.y)), 0) && near(Math.max(...L.points.map((p) => p.y)), 1));
  check("layout: a longer wavelength is higher", (() => { const wl = frames.map(midWavelength); return L.points.every((p, i) => L.points.every((q, j) => (wl[i] < wl[j]) === (p.y < q.y) || near(wl[i], wl[j]))); })());
  check("layout: each pass has a span that contains its points and does not touch the next", L.passes.length === 4
    && L.passes.every((s, k) => L.points.filter((p) => p.pass === k).every((p) => p.x > s.x0 && p.x < s.x1)) && L.passes.every((s, k, a) => k === 0 || s.x0 > a[k - 1].x1));
  check("layout: the first span starts at 0 and the last ends at 1", near(L.passes[0].x0, 0) && near(L.passes.at(-1).x1, 1));
  const one = layoutTimeline([frames[0]]);
  check("layout: one image sits in the middle of the plot", near(one.points[0].x, 0.5) && near(one.points[0].y, 0.5));
  const flat = layoutTimeline(frames.slice(0, 3).map((f) => ({ ...f, wavelengthMinUm: 1.5, wavelengthMaxUm: 1.53 })));
  check("layout: images of one wavelength are drawn half way up (no division by zero)", flat.points.every((p) => near(p.y, 0.5)));
  check("layout: no images, no points", layoutTimeline([]).points.length === 0);
}

// ---------------------------------------------------------------- the filter
{
  const all = frames.map((_, i) => i);
  check("filter: nothing set keeps every image", activeIndices(frames).join() === all.join() && activeIndices(frames, {}).join() === all.join());
  const win = activeIndices(frames, { wlMin: 1.2, wlMax: 1.4 });
  check("filter: a wavelength window keeps the images inside it (inclusive)", win.length > 0 && win.length < 18 && win.every((i) => { const w = midWavelength(frames[i]); return w >= 1.2 - 1e-6 && w <= 1.4 + 1e-6; })
    && all.filter((i) => !win.includes(i)).every((i) => { const w = midWavelength(frames[i]); return w < 1.2 || w > 1.4; }), `${win.length} of 18`);
  const exact = midWavelength(frames[7]);
  check("filter: a bound exactly on an image keeps it", activeIndices(frames, { wlMin: exact, wlMax: exact }).join() === "7");
  const noP2 = activeIndices(frames, { offPasses: [1] });
  check("filter: switching a pass off removes exactly its images", noP2.length === 13 && !noP2.some((i) => surveyPasses(frames)[1].indices.includes(i)));
  check("filter: a Set works as well as an array", activeIndices(frames, { offPasses: new Set([0, 3]) }).length === 10);
  const both = activeIndices(frames, { wlMin: 1.2, wlMax: 1.4, offPasses: [0] });
  check("filter: window and passes combine (both must allow the image)", both.every((i) => win.includes(i) && i >= 4) && both.length < win.length);
  check("filter: everything switched off gives no image, not an error", activeIndices(frames, { offPasses: [0, 1, 2, 3] }).length === 0 && activeIndices(frames, { wlMin: 9, wlMax: 10 }).length === 0);
  check("isFiltered says when something is left out", isFiltered(win, 18) && !isFiltered(all, 18));
}

// ---------------------------------------------------------------- stepping
{
  const active = [2, 5, 6, 11];
  check("stepActive: forward visits only the active images and wraps round", stepActive(2, active, 1) === 5 && stepActive(6, active, 1) === 11 && stepActive(11, active, 1) === 2);
  check("stepActive: backward does the same the other way", stepActive(11, active, -1) === 6 && stepActive(5, active, -1) === 2 && stepActive(2, active, -1) === 11);
  check("stepActive: from an image that is switched off, next is the first active one after it, previous the last one before it",
    stepActive(3, active, 1) === 5 && stepActive(3, active, -1) === 2 && stepActive(0, active, 1) === 2 && stepActive(0, active, -1) === 11 && stepActive(14, active, 1) === 2);
  check("stepActive: one active image stays itself; none stays where it is", stepActive(5, [5], 1) === 5 && stepActive(5, [5], -1) === 5 && stepActive(4, [], 1) === 4);
  // a full lap forward visits every active image exactly once
  let at = 2; const seen = [];
  for (let k = 0; k < active.length; k++) { seen.push(at); at = stepActive(at, active, 1); }
  check("stepActive: one lap forward visits each active image once and ends where it began", seen.join() === active.join() && at === 2);
}

// ---------------------------------------------------------------- badly flagged images
{
  check("hasManyFlags: only the image with 3.2 % flagged is marked (the limit is 1 %)", FLAGGED_LIMIT === 0.01 && frames.filter(hasManyFlags).length === 1 && hasManyFlags(frames[6]));
  check("hasManyFlags: exactly 1 % is not 'more than 1 %'; unknown flags are not marked", !hasManyFlags({ flags: { anyFlagged: true, fractionFlagged: 0.01 } }) && hasManyFlags({ flags: { anyFlagged: true, fractionFlagged: 0.0101 } }) && !hasManyFlags({ flags: null }));
}

// ---------------------------------------------------------------- texts
{
  const text = describeFrame(frames[6], 6, 18);                           // the one flagged image (pass 2, third image)
  check("describeFrame: number, date, detector, band and flags", text.startsWith("Image 7 of 18 · ") && text.includes(" UTC · D2 · ") && text.includes(" µm · ") && text.endsWith("3.2 % of pixels flagged"), text);
  check("describeFrame: clean and unknown flags are said as such", describeFrame(frames[0], 0, 18).endsWith("no flagged pixels") && describeFrame({ ...frames[0], flags: null }, 0, 1).endsWith("flags not known"));
  const all = frames.map((_, i) => i);
  check("timelineSummary: detector, images, passes, wavelength range", /^D2 · 18 images · 4 survey passes · 1\.09–1\.\d\d µm$/.test(timelineSummary(frames, all)), timelineSummary(frames, all));
  check("timelineSummary: says how many are shown when a filter is on, and 'image' for one", timelineSummary(frames, [1, 2]).endsWith("showing 2 of 18") && timelineSummary([frames[0]], [0]).includes("1 image ·") && timelineSummary([], []) === "");
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
