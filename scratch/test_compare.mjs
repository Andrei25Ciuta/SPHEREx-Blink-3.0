// Tests for frontend/js/features/compare.js ("Compare": A - B and A + B).  Run: node scratch/test_compare.mjs
import { compareChoices, membersFor, defaultChoice, shortLabel, combine, OPERATIONS } from "../frontend/js/features/compare.js";
import { BlinkPlayer } from "../frontend/js/player.js";
import { mulberry32, renderPixels, stretchAsinh } from "../frontend/js/data/mockSource.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const frame = (mjd, wl = [1.0, 1.1]) => ({
  mjd, dateISO: new Date((mjd - 40587) * 86400000).toISOString(), wavelengthMinUm: wl[0], wavelengthMaxUm: wl[1],
});

// ---------------------------------------------------------------- menus
const frames = [60800.2, 60801.9, 60983.0, 60984.7, 60986.2, 61165.4].map((m) => frame(m));   // 3 passes: 2, 3, 1 images
const choices = compareChoices(frames);
check("one menu entry per survey pass and per image", choices.passes.length === 3 && choices.singles.length === 6);
check("passes group the images that are close in time",
  JSON.stringify(choices.passes.map((p) => p.members)) === JSON.stringify([[0, 1], [2, 3, 4], [5]]));
check("a pass label says which pass, when and how many images",
  /^Pass 2 · 2025-11-0\d → 2025-11-\d\d · 3 images, average$/.test(choices.passes[1].label), choices.passes[1].label);
check("a single-image pass says '1 image'", choices.passes[2].label.endsWith("· 1 image, average"), choices.passes[2].label);
check("single images show date, time and wavelength", /^2025-05-05 \d\d:\d\d · 1\.00–1\.10 µm$/.test(choices.singles[0].label), choices.singles[0].label);
check("a menu value maps back to its frames", JSON.stringify(membersFor("p1", choices)) === "[2,3,4]" && JSON.stringify(membersFor("f5", choices)) === "[5]");
check("an unknown value maps to nothing", membersFor("p9", choices).length === 0 && membersFor("", choices).length === 0);
const start = defaultChoice(choices);
check("the start is 'latest pass − earliest pass'", start.a === "p2" && start.b === "p0", JSON.stringify(start));
const onePass = compareChoices(frames.slice(0, 2));
check("with one pass the start is 'last image − first image'", JSON.stringify(defaultChoice(onePass)) === '{"a":"f1","b":"f0"}');
check("short names for the info line", shortLabel("p2", frames) === "Pass 3" && shortLabel("f0", frames) === "2025-05-05" && shortLabel("f99", frames) === "?");
check("no frames gives empty menus and no crash", compareChoices([]).passes.length === 0 && defaultChoice(compareChoices([])).a === "");
check("both operations have a label", OPERATIONS.sub === "A − B" && OPERATIONS.add === "A + B");

// ---------------------------------------------------------------- the maths
const px = (rgba, i) => [rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2], rgba[4 * i + 3]];
{
  const a = Uint8ClampedArray.from([200, 100, 100, 0]);
  const b = Uint8ClampedArray.from([100, 200, 100, 0]);
  const d = combine(a, b, "sub");
  const [r0, , b0] = px(d, 0), [r1, , b1] = px(d, 1), same = px(d, 2);
  check("A brighter than B is orange (red > blue)", r0 > 150 && b0 < r0 * 0.4, `rgb(${px(d, 0).slice(0, 3).map(Math.round)})`);
  check("A fainter than B is blue (blue > red)", b1 > 150 && r1 < b1 * 0.4, `rgb(${px(d, 1).slice(0, 3).map(Math.round)})`);
  check("equal pixels are black and opaque", same[0] === 0 && same[1] === 0 && same[2] === 0 && same[3] === 255);
  const swapped = combine(b, a, "sub");
  check("swapping A and B swaps orange and blue", px(swapped, 0)[2] > px(swapped, 0)[0] && px(swapped, 1)[0] > px(swapped, 1)[2]);
  check("the difference saturates instead of overflowing", px(combine(Uint8ClampedArray.from([255]), Uint8ClampedArray.from([0]), "sub"), 0)[0] === 255);
  const s = combine(a, b, "add");
  check("A + B is the grey average", px(s, 0)[0] === 150 && px(s, 0)[1] === 150 && px(s, 0)[2] === 150 && px(s, 3)[0] === 0 && px(s, 0)[3] === 255);
}

// A mover seen at two dates: late - early = orange where it is now, blue where it was.
{
  const size = 64;
  const field = { stars: [{ x: 20, y: 40, flux: 300 }], variable: { x: 0, y: 0, flux: 0, periodDays: 100 }, mover: { x0: 32, y0: 32, vx: 20, vy: 0, flux: 200 } };
  const early = stretchAsinh(renderPixels(field, size, 60800, -0.5, 4, mulberry32(1)));    // mover at x = 22
  const late = stretchAsinh(renderPixels(field, size, 61165, 0.5, 4, mulberry32(2)));      // mover at x = 42
  const rgba = combine(late, early, "sub");
  const at = (x, y) => px(rgba, y * size + x);
  const now = at(42, 32), before = at(22, 32), star = at(20, 40);
  check("a mover is ORANGE where it is in A", now[0] > 100 && now[0] > now[2] * 2, `rgb(${now.slice(0, 3).map(Math.round)})`);
  check("... and BLUE where it was in B", before[2] > 100 && before[2] > before[0] * 2, `rgb(${before.slice(0, 3).map(Math.round)})`);
  check("a still star cancels out", star[0] < 60 && star[2] < 60, `rgb(${star.slice(0, 3).map(Math.round)})`);
}

// The canvas crop and zoom belong to the blit, while the split clips in screen coordinates.
{
  const calls = [];
  const split = {
    canvas: { width: 512, height: 512 },
    ctx: {
      save() {}, restore() {}, beginPath() {}, clip() {}, fillRect() {},
      rect: (...bounds) => calls.push(bounds),
    },
    images: ["image A", "image B"],
    compare: { a: [0], b: [1], op: "wipe" },
    _blit: (image) => calls.push(image),
  };
  const redraw = (fraction) => {
    calls.length = 0;
    split.compareSplit = fraction;
    BlinkPlayer.prototype._drawCompareSplit.call(split);
    return JSON.stringify(calls);
  };
  check("split at 0% shows B", redraw(0) === '["image B"]');
  check("split at 25% clips A to the first quarter of the canvas", redraw(.25) === '["image B",[0,0,128,512],"image A"]');
  check("split at 100% covers B with A", redraw(1) === '["image B",[0,0,512,512],"image A"]');
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
