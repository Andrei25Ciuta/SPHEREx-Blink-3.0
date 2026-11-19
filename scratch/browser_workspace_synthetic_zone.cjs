/* BLINK_URL=http://127.0.0.1:8772/ CHROME_PATH=/usr/bin/chromium node scratch/browser_workspace_synthetic_zone.cjs */
const assert = require("node:assert/strict");
const { chromium, devices } = require("playwright");

const base = new URL(process.env.BLINK_URL || "http://127.0.0.1:8765/");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "use a loopback frontend");

async function check(browser, mobile) {
  const context = await browser.newContext({
    ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
    reducedMotion: "reduce", serviceWorkers: "block",
  });
  const api = [], external = [], errors = [];
  await context.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || request.method() !== "GET") {
      api.push(`${request.method()} ${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (url.origin === base.origin) return route.continue();
    if (!["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) external.push(url.hostname);
    return route.abort("blockedbyclient");
  });
  await context.addInitScript(() => {
    window.viewerScrolls = [];
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      if (this.id === "workspace-photo-viewer") window.viewerScrolls.push(args[0]);
      return scroll.apply(this, args);
    };
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(new URL("index.html#workspace", base).href, { waitUntil: "domcontentloaded" });
    const zone = page.locator("#workspace-sky-zone-controls");
    const slider = zone.locator("#fov-input");
    const request = zone.getByRole("button", { name: "Request this zone" });
    const ra = zone.locator("#workspace-sky-zone-ra");
    const dec = zone.locator("#workspace-sky-zone-dec");
    const player = page.locator("#play-btn");
    await request.waitFor();
    assert.ok(await request.isEnabled(), "the demo must work before opening an external map");
    assert.equal(await page.locator("#search-form input[type=range]").count(), 0);
    assert.equal(await page.locator("#fov-input").count(), 1, "reuse the original slider, not a duplicate");
    assert.equal(await slider.getAttribute("min"), "1");
    assert.equal(await slider.getAttribute("max"), "30");
    assert.equal(await slider.inputValue(), "5");
    assert.equal(await page.locator("#workspace-sky-surface").isVisible(), false);
    assert.deepEqual(external, [], "synthetic startup must not fetch a survey");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const geometry = await zone.evaluate(panel => {
      const label = panel.querySelector('label[for="fov-input"]');
      const slider = panel.querySelector("#fov-input");
      const parts = Array.from(label.childNodes).filter(node =>
        node.nodeType === Node.ELEMENT_NODE || node.textContent.trim());
      const labelLines = parts.map(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().bottom;
      });
      const bounds = id => panel.querySelector(id).getBoundingClientRect().toJSON();
      return { labelLines, sliderBorder: parseFloat(getComputedStyle(slider).borderTopWidth),
        ra: bounds("#workspace-sky-zone-ra"), dec: bounds("#workspace-sky-zone-dec"),
        width: bounds("#workspace-sky-synthetic-fov"), button: bounds("#workspace-sky-zone-request") };
    });
    assert.ok(Math.max(...geometry.labelLines) - Math.min(...geometry.labelLines) < 5,
      "FOV label, value and unit must read on one line");
    assert.equal(geometry.sliderBorder, 0, "the range must not inherit a text-input box");
    if (!mobile) {
      assert.ok(geometry.ra.right < geometry.dec.left && geometry.dec.right < geometry.width.left &&
        geometry.width.right < geometry.button.left, "wide layout must keep all four controls in one row");
    }

    await slider.press("End");
    assert.equal(await slider.inputValue(), "30");
    assert.equal(await zone.locator("#fov-value").textContent(), "30");
    assert.equal(new URL(page.url()).searchParams.has("fov"), false, "changing a draft does not commit the URL");
    assert.equal(await player.isEnabled(), false, "changing a draft does not generate frames");
    await ra.fill("08:");
    await request.click();
    assert.match(await zone.locator("#workspace-sky-zone-error").textContent(), /RA:/);
    assert.deepEqual(await page.evaluate(() => window.viewerScrolls), []);
    await ra.fill("08:00:00");
    await dec.fill("-07:15:00");
    await dec.press("Enter");
    assert.equal(new URL(page.url()).searchParams.has("fov"), false, "typing and Enter in a draft do not submit");
    await request.press("Enter");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("fov") === "30" &&
      !document.getElementById("play-btn").disabled && window.viewerScrolls.length === 1);
    const committed = new URL(page.url()).searchParams;
    assert.deepEqual(["ra", "dec", "fov"].map(k => committed.get(k)), ["120", "-7.25", "30"]);
    assert.equal(committed.has("request_id"), false);
    assert.match(await page.locator("#data-source-badge").textContent(), /synthetic/i);
    assert.equal(await page.locator("#field-request-panel").isVisible(), false, "synthetic loads must not fake cloud progress");

    await slider.press("Home");
    assert.equal(await slider.inputValue(), "1");
    assert.equal(new URL(page.url()).searchParams.get("fov"), "30", "editing does not alter displayed data");
    await request.click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get("fov") === "1" &&
      !document.getElementById("play-btn").disabled && window.viewerScrolls.length === 2);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !document.getElementById("play-btn").disabled);
    assert.deepEqual(await page.evaluate(() => window.viewerScrolls), [], "restoring a synthetic link must not jump to playback");
    assert.equal(await slider.inputValue(), "1");
    assert.equal(Number(await ra.inputValue()), 120);
    assert.equal(Number(await dec.inputValue()), -7.25);
    assert.deepEqual(external, [], "synthetic generation and reload must not fetch a survey");
    await page.locator("#planetx-demo-btn").click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get("fov") === "30" &&
      !document.getElementById("play-btn").disabled);
    assert.equal(await slider.inputValue(), "30");
    assert.equal(Number(await ra.inputValue()), Number(new URL(page.url()).searchParams.get("ra")));

    // The real map is an optional backdrop: loss of CDN access must not disable the demo.
    await page.getByRole("button", { name: "Open survey map", exact: true }).click();
    await page.waitForFunction(() => /unavailable|could not/i.test(document.querySelector("#workspace-sky-status").textContent));
    assert.ok(await request.isEnabled(), "a missing public map must not block local synthetic frames");
    await request.click();
    await page.waitForFunction(() => window.viewerScrolls.length === 1 && !document.getElementById("play-btn").disabled);

    await page.goto(new URL("index.html?embed=1&ra=120&dec=-7.25&fov=30#workspace", base).href);
    await page.waitForFunction(() => !document.getElementById("play-btn").disabled);
    assert.equal(await page.locator("#workspace-sky").isVisible(), false);
    assert.equal(await page.locator("#search-form #fov-input").inputValue(), "30", "embed keeps its original range control");
    console.log(`PASS synthetic Workspace (${mobile ? "phone" : "desktop"}): moved 1–30′ slider, offline playback, reload, presets, map failure, embed`);
  } finally {
    await context.close();
    assert.deepEqual(api, [], "synthetic showcase must not attempt a field request, status, retry, or cutout API");
    assert.deepEqual(errors, []);
  }
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    await check(browser, false);
    await check(browser, true);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
