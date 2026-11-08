/* Local integration check. Serve backend/data/real with uvicorn on port 18773.
   BLINK_REAL_FIELD=epsind-d6 selects the independent Epsilon Indi B D6 cutouts. */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { readFileSync } = require("node:fs");

async function check() {
  const base = process.env.BLINK_URL || "http://127.0.0.1:18773/";
  const field = process.env.BLINK_REAL_FIELD === "epsind-d6"
    ? { label: "Epsilon Indi B D6", ra: "331.0969", dec: "-56.8007", det: "D6" }
    : { label: "Barnard D2", ra: "269.4462", dec: "4.769", det: "D2" };
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  try {
    for (const width of [320, 375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin
        ? route.continue() : route.abort());
      const url = new URL("index.html", base);
      url.search = new URLSearchParams({ data: "api", api: base.slice(0, -1), ra: field.ra,
        dec: field.dec, fov: "3", det: field.det }).toString();
      await page.goto(url.href);
      await page.locator("#stage-overlay.hidden").waitFor({ timeout: 120000 });
      const count = await page.locator("#observation-select option").count();
      assert.ok(count >= 3, `expected several ${field.det} observations, got ${count}`);
      assert.match(await page.locator("#data-source-badge").textContent(), /SPHEREx-format FITS/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "real-data workspace overflows the viewport");
      await page.locator("#frame-slider").fill("1");
      assert.match(await page.locator("#frame-counter").textContent(), /Frame 2/);
      await page.locator('input[name="mode"][value="diff"]').check();
      assert.match(await page.locator("#blink-canvas").getAttribute("aria-label"), /difference image/);
      await page.locator("#detector-pair summary").click();
      await page.waitForFunction(() => [...document.querySelectorAll("#detector-pair img")]
        .every(img => img.complete && img.naturalWidth > 0));
      assert.equal(await page.locator("#detector-pair img").evaluateAll(images =>
        images.every(img => img.complete && img.naturalWidth > 0)), true,
        "both observed comparison cutouts load");
      const canvasBox = await page.locator("#blink-canvas").boundingBox();
      await page.locator("#blink-canvas").click({ position: { x: canvasBox.width / 2, y: canvasBox.height / 2 } });
      await page.locator("#measure-table-wrap:not([hidden])").waitFor({ timeout: 120000 });
      assert.equal(await page.locator("#measure-table tbody tr").count(), count);
      if (width === 1280) {
        const table = page.locator("#measure-table-wrap");
        if (!await table.evaluate(details => details.open)) await table.locator("summary").click();
        const [download] = await Promise.all([page.waitForEvent("download"),
          page.locator("#download-measurements").click()]);
        const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
        assert.equal(exported.data, "spherex_header");
        assert.equal(exported.measurements.length, count);
        assert.ok(exported.measurements.every(point => point.detector === field.det && Number.isFinite(point.fluxJy)));
      }
      assert.deepEqual(errors, [], "no browser exceptions");
      await page.close();
      console.log(`Observed ${field.label} workflow passed at ${width}px with ${count} frames`);
    }
  } finally {
    await browser.close();
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
