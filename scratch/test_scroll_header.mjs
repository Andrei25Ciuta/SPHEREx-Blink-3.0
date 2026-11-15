// Direction-aware shared masthead behavior. Run: node scratch/test_scroll_header.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHeaderScrollController } from "../frontend/js/features/scrollHeader.js";

const header = createHeaderScrollController();
header.reset(0);
assert.equal(header.update(40), false, "stay visible while leaving top");
assert.equal(header.update(70), false, "near top do not hide");
assert.equal(header.update(80), false, "small downward movement does not hide");
assert.equal(header.update(109), true, "continued downscroll hides the header");
assert.equal(header.update(104), true, "tiny upscroll does not flicker");
assert.equal(header.update(90), false, "18px cumulative upscroll reveals the header");
assert.equal(header.update(110), false, "a small downward movement does not instantly hide again");
assert.equal(header.update(139), true, "continued downward motion hides again");
assert.equal(header.update(200, { keepVisible: true }), false, "open menu reveals the header");
assert.equal(header.update(580, { keepVisible: true }), false, "open menu remains visible during scroll");
assert.equal(header.update(595), false, "after menu closes there is a hide threshold");
assert.equal(header.update(630), true, "header hides again after scrolling down");
assert.equal(header.update(610), false, "short upward movement at the bottom reveals navigation");
assert.equal(header.update(0), false, "returning to top reveals navigation");
header.reset(3200);
assert.equal(header.update(3200), false, "deep links load with the header visible");
assert.equal(header.update(3235), true, "deep link can still hide header when scrolling");
assert.equal(header.reveal(), false, "keyboard focus reveals immediately");
assert.equal(header.update(3235), false, "no immediate re-hide after focus");
assert.equal(header.update(-25), false, "negative overscroll is clamped");
assert.equal(header.update(NaN), false, "invalid scroll position is safe");

const siteHeader = readFileSync(new URL("../frontend/js/siteHeader.js", import.meta.url), "utf8");
const baseStyle = readFileSync(new URL("../frontend/css/instrument.css", import.meta.url), "utf8");
const overviewStyle = readFileSync(new URL("../frontend/css/overview-3d.css", import.meta.url), "utf8");
assert.match(siteHeader, /window\.addEventListener\("scroll", scheduleHeaderVisibility, \{ passive: true \}\)/);
assert.match(siteHeader, /header\.addEventListener\("focusin", revealHeader\)/);
assert.match(siteHeader, /menu\.classList\.contains\("is-open"\)/);
assert.match(siteHeader, /window\.addEventListener\("pageshow"/);
const backToTopClick = siteHeader.match(/backToTop\.addEventListener\("click", \(\) => \{([\s\S]*?)^  \}\);/m)?.[1] ?? "";
const content = { tabIndex: 0, hasAttribute: () => false, focus: (options) => { assert.equal(options.preventScroll, true); active = content; } };
let active = null;
let scrolledTo;
new Function("document", "window", backToTopClick)(
  { querySelector: (selector) => { assert.equal(selector, "main"); return content; } },
  { scrollTo: ({ top }) => { scrolledTo = top; } },
);
assert.equal(active, content, "Back to top hands focus to the main content outside the sticky header");
assert.equal(content.tabIndex, -1);
assert.equal(scrolledTo, 0);
assert.match(baseStyle, /position: sticky; top: 0; z-index: 1000/);
assert.match(baseStyle, /\.site-header\.is-hidden:focus-within/);
assert.match(baseStyle, /prefers-reduced-motion: reduce/);
assert.match(overviewStyle, /transition: background 0\.3s, transform 0\.24s ease/);

for (const page of ["index", "overview", "sky", "simulator", "learn", "results", "about"]) {
  const html = readFileSync(new URL(`../frontend/${page}.html`, import.meta.url), "utf8");
  assert.match(html, /js\/siteHeader\.js\?v=4/, page + " loads updated nav");
  assert.match(html, /css\/instrument\.css\?v=4/, page + " loads updated sticky CSS");
}
console.log("PASS shared scroll header: down hides, up reveals, focus/menu safe, seven pages wired");
