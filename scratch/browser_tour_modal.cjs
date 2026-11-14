/* Run against a local frontend server with Playwright and BLINK_URL. */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function check() {
  const base = process.env.BLINK_URL || "http://127.0.0.1:8765/";
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  try {
    for (const width of [320, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
      await page.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin
        ? route.continue() : route.abort());
      await page.goto(new URL("index.html#workspace", base).href);   // a bare index.html redirects to overview.html; a hash keeps the workspace
      await page.locator("#about").evaluate(el => { el.inert = true; });
      const opener = page.locator("#tour-btn");
      await opener.click();
      const dialog = page.getByRole("dialog");
      assert.equal(await dialog.count(), 1, "tour is exposed as one dialog");
      assert.equal(await dialog.getAttribute("aria-modal"), "true");
      assert.equal(await page.locator("#workspace").evaluate(el => el.inert), true,
        "workspace is inert while modal tour is open");
      assert.equal(await page.locator(".site-header").evaluate(el => el.inert), true,
        "site header is inert while modal tour is open");
      await assert.rejects(
        page.locator("#load-btn").click({ trial: true, timeout: 500 }),
        /Timeout.*exceeded/s,
        "background controls cannot receive pointer input while the modal is open");
      assert.equal(await page.locator(":focus").evaluate(el => el.closest(".tour-card") !== null), true);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(":focus").evaluate(el => el.closest(".tour-card") !== null), true);
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.locator(":focus").evaluate(el => el.closest(".tour-card") !== null), true);
      await dialog.getByRole("button", { name: "Next" }).click();
      assert.equal(await dialog.locator(".tour-count").textContent(), "2 / 8");
      await page.keyboard.press("Escape");
      assert.equal(await dialog.count(), 0);
      assert.equal(await page.locator("#workspace").evaluate(el => el.inert), false);
      assert.equal(await page.locator(".site-header").evaluate(el => el.inert), false);
      assert.equal(await page.locator("#about").evaluate(el => el.inert), true,
        "an existing inert state is preserved");
      await page.locator("#load-btn").click({ trial: true });
      assert.equal(await opener.evaluate(el => el === document.activeElement), true,
        "closing returns focus to the launch button");
      await page.close();
      console.log(`Tour modal passed at ${width}px`);
    }
  } finally {
    await browser.close();
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
