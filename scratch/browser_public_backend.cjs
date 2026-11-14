/* Exercise the static frontend as if served from a public host, without network access. */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { resolve, sep } = require("node:path");

async function check() {
  const root = resolve(__dirname, "../frontend");
  const origin = "https://blink.example";
  const prefix = "/SPHEREx-Blink-2.0/";
  const base = origin + prefix;
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  const serveStatic = (page, host, pathPrefix) => page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== host || !url.pathname.startsWith(pathPrefix)) return route.abort();
    const file = resolve(root, decodeURIComponent(url.pathname.slice(pathPrefix.length) || "index.html"));
    if (!file.startsWith(root + sep)) return route.abort();
    return route.fulfill({ path: file });
  });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 800 }, reducedMotion: "reduce" });
    const localRequests = [];
    page.on("request", request => {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(request.url())) localRequests.push(request.url());
    });
    await serveStatic(page, origin, prefix);

    await page.goto(base + "index.html#workspace");   // a bare index.html redirects to overview.html
    await page.locator("#quick-pick-list button").first().waitFor();
    assert.equal(await page.locator('#data-source option[value="api"]').evaluate(option => option.disabled), true,
      "public static site cannot offer the local FITS backend as an actionable option");
    assert.match(await page.locator("#data-source-help").textContent(), /local backend/i);
    assert.match(await page.locator("#data-source-badge").textContent(), /Synthetic demo/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "public backend guidance fits a phone viewport");

    await page.goto(base + "index.html?data=api&ra=269.4462&dec=4.769&fov=3");
    await page.locator("#stage-overlay.error").waitFor();
    assert.match(await page.locator("#stage-overlay .overlay-sub").textContent(), /public demo.*local backend/i);
    assert.deepEqual(localRequests, [], "public site never requests a visitor's loopback backend");
    await page.locator('[data-open-panel="viewer-settings"]').click();   // the settings are a dialog now
    await page.locator("#data-source").selectOption("mock");
    await page.locator("#stage-overlay.hidden").waitFor({ timeout: 30000 });
    assert.match(await page.locator("#data-source-badge").textContent(), /Synthetic demo/);

    await page.goto(base + "sky.html");
    await page.locator("#example").click();
    await page.locator("#products:not([hidden])").waitFor();
    assert.equal(await page.locator("#workspace").isVisible(), false,
      "public Sky Explorer must not offer a dead observed-FITS workspace link");
    assert.equal(await page.locator("#workspace-help").isVisible(), true);
    assert.match(await page.locator("#workspace-help").textContent(), /local backend/i);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.goto(base + "planet-x.html");
    await page.locator("#summary:not(:empty)").waitFor();
    assert.equal(await page.locator("#workspace").isVisible(), false,
      "public Planet X Lab must not offer a dead observed-FITS workspace link");
    assert.equal(await page.locator("#workspace-help").isVisible(), true);
    assert.match(await page.locator("#workspace-help").textContent(), /local backend/i);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.goto(base + "results.html");
    await page.locator("#candidate-rows button").first().waitFor();
    assert.equal(await page.locator("#candidate-viewer").isVisible(), false,
      "public Results must not link a real-data record to unavailable local FITS");
    assert.match(await page.locator("#candidate-viewer-help").textContent(), /local backend/i);
    const synthetic = "SYNTHETIC demo data (invented in the browser, NOT SPHEREx observations)";
    const exportData = { tool: "SPHEREx Blink", generated: "2026-11-08T00:00:00Z", data: synthetic,
      field: { ra_deg: 269.4462, dec_deg: 4.769, fov_arcmin: 5, detector: "D2" },
      candidates: [{ candidate: "Test mover", kind: "mover (straight line)", detector: "D2",
        detections: 3, images: 3, data: synthetic }] };
    await page.locator("#candidate-file").setInputFiles({ name: "synthetic.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exportData)) });
    await page.getByText("Candidate export loaded.").waitFor();
    assert.equal(await page.locator("#candidate-viewer").isVisible(), true,
      "synthetic candidate links remain available on the public site");
    assert.doesNotMatch(await page.locator("#candidate-viewer").getAttribute("href"), /data=api/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.close();

    const local = await browser.newPage();
    const localOrigin = "http://localhost:8765";
    await serveStatic(local, localOrigin, "/");
    await local.goto(localOrigin + "/sky.html");
    await local.locator("#example").click();
    await local.locator("#products:not([hidden])").waitFor();
    assert.equal(await local.locator("#workspace").isVisible(), true,
      "locally served Sky Explorer keeps the observed-field link");
    assert.match(await local.locator("#workspace").getAttribute("href"), /data=api/);
    await local.goto(localOrigin + "/planet-x.html");
    await local.locator("#summary:not(:empty)").waitFor();
    assert.equal(await local.locator("#workspace").isVisible(), true,
      "locally served Planet X Lab keeps the observed-field link");
    await local.goto(localOrigin + "/results.html");
    await local.locator("#candidate-rows button").first().waitFor();
    assert.equal(await local.locator("#candidate-viewer").isVisible(), true,
      "locally served Results keeps the real-data workspace link");
    await local.close();

    console.log("Public static backend guard passed");
  } finally {
    await browser.close();
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
