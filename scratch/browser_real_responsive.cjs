/* Local integration check. Serve backend/data/real with uvicorn on port 18773. */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function check() {
  const base = process.env.BLINK_URL || "http://127.0.0.1:18773/";
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  try {
    for (const width of [320, 375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin
        ? route.continue() : route.abort());
      const url = new URL("index.html", base);
      url.search = new URLSearchParams({ data: "api", api: base.slice(0, -1), ra: "269.4462",
        dec: "4.769", fov: "3", det: "D2" }).toString();
      await page.goto(url.href);
      await page.locator("#stage-overlay.hidden").waitFor({ timeout: 120000 });
      const count = await page.locator("#observation-select option").count();
      assert.ok(count >= 3, `expected several D2 observations, got ${count}`);
      assert.match(await page.locator("#data-source-badge").textContent(), /SPHEREx-format FITS/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "real-data workspace overflows the viewport");
      await page.locator("#frame-slider").fill("1");
      assert.match(await page.locator("#frame-counter").textContent(), /Frame 2/);
      await page.locator('input[name="mode"][value="diff"]').check();
      assert.match(await page.locator("#blink-canvas").getAttribute("aria-label"), /difference image/);
      await page.locator("#detector-pair summary").click();
      await page.locator("#detector-pair img").first().waitFor({ state: "visible" });
      assert.equal(await page.locator("#detector-pair img").evaluateAll(images =>
        images.every(img => img.complete && img.naturalWidth > 0)), true,
        "both observed comparison cutouts load");
      await page.locator("#blink-canvas").click({ position: { x: 80, y: 80 } });
      await page.locator("#measure-table-wrap:not([hidden])").waitFor({ timeout: 120000 });
      assert.equal(await page.locator("#measure-table tbody tr").count(), count);
      assert.deepEqual(errors, [], "no browser exceptions");
      await page.close();
      console.log(`Observed D2 workflow passed at ${width}px with ${count} frames`);
    }
  } finally {
    await browser.close();
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
