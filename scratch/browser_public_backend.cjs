/* Exercise the static frontend as if served from a public host, without network access. */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { resolve, sep } = require("node:path");

async function check() {
  const root = resolve(__dirname, "../frontend");
  const origin = "https://blink.example";
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 800 }, reducedMotion: "reduce" });
    const localRequests = [];
    page.on("request", request => {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(request.url())) localRequests.push(request.url());
    });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const file = resolve(root, decodeURIComponent(url.pathname.slice(1) || "index.html"));
      if (!file.startsWith(root + sep)) return route.abort();
      return route.fulfill({ path: file });
    });

    await page.goto(origin + "/index.html");
    await page.locator("#quick-pick-list button").first().waitFor();
    assert.equal(await page.locator('#data-source option[value="api"]').evaluate(option => option.disabled), true,
      "public static site cannot offer the local FITS backend as an actionable option");
    assert.match(await page.locator("#data-source-help").textContent(), /local backend/i);
    assert.match(await page.locator("#data-source-badge").textContent(), /Synthetic demo/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "public backend guidance fits a phone viewport");

    await page.goto(origin + "/index.html?data=api&ra=269.4462&dec=4.769&fov=3");
    await page.locator("#stage-overlay.error").waitFor();
    assert.match(await page.locator("#stage-overlay .overlay-sub").textContent(), /public demo.*local backend/i);
    assert.deepEqual(localRequests, [], "public site never requests a visitor's loopback backend");
    await page.locator(".workspace-settings summary").click();
    await page.locator("#data-source").selectOption("mock");
    await page.locator("#stage-overlay.hidden").waitFor({ timeout: 30000 });
    assert.match(await page.locator("#data-source-badge").textContent(), /Synthetic demo/);
    console.log("Public static backend guard passed");
  } finally {
    await browser.close();
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
