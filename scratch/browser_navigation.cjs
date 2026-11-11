/* Run against scripts/serve_frontend.py with Playwright installed. */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function checkNavigation() {
  const base = process.env.BLINK_URL || "http://127.0.0.1:8765/";
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.route("**/*", route => {
      return new URL(route.request().url()).origin === new URL(base).origin
        ? route.continue() : route.abort();
    });
    for (const width of [320, 720, 721, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(base);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(":focus").textContent(), "Skip to the workspace");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator(":focus").getAttribute("id"), "workspace");
      const links = page.locator(".hero-nav a");
      assert.ok(await links.count() >= 7, "primary navigation should expose each project page");
      for (const name of ["Overview", "Workspace", "Sky Explorer", "Simulator", "Planet X Lab", "Real-data results", "About"])
        assert.ok(await links.getByText(name, { exact: true }).count(), `missing ${name} navigation link`);
      for (const link of await links.all()) {
        const box = await link.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width, "link outside viewport");
        await link.click({ trial: true });
      }
      await links.getByText("Real-data results").click();
      await page.locator("#results-status[hidden]").waitFor({ state: "attached" });
      await page.getByRole("navigation", { name: "Pages" }).getByRole("link").click();
      assert.ok(await page.locator("#workspace").isVisible());
      console.log("Navigation passed at", width, "px");
    }
    await page.goto(new URL("?embed=1", base).href);
    assert.equal(await page.locator(".hero").isVisible(), false);
    assert.ok(await page.locator("#workspace").isVisible());
  } finally {
    await browser.close();
  }
}

checkNavigation().catch(error => { console.error(error); process.exitCode = 1; });
