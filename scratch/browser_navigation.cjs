/* Playwright, using a local checkout or BLINK_URL. No external services required. */
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { chromium } = require("playwright");

async function checkNavigation() {
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  let server;
  try {
    let base = process.env.BLINK_URL;
    if (!base) {
      const { startServer } = await import("./lib_cdp.mjs");
      const local = await startServer(resolve(__dirname, "../frontend"));
      server = local.server;
      base = "http://127.0.0.1:" + local.port + "/";
    }
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin
      ? route.continue() : route.abort());
    const nav = page.getByRole("navigation", { name: "Project pages" });
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    async function openNavigation() {
      if (await menu.isVisible() && await menu.getAttribute("aria-expanded") === "false") await menu.click();
    }
    // Changed on purpose (14 Nov 2026): the menu shows the chosen mode's pages. In Science Mode: Home, its pages and a switch to Learn Mode;
    // Overview keeps the classic project navigation without the removed standalone Planet X page.
    const destinations = [
      ["Sky Explorer", "sky.html"], ["Workspace", "index.html#workspace"],   // leave the workspace first: its own link is a same-page jump
      ["Simulator", "simulator.html"], ["Results", "results.html"], ["About", "index.html#about"]
    ];
    const labels = ["Home", "Workspace", "Pin Board", "Sky Explorer", "Simulator", "Results", "About", "⇄ Switch to Learn Mode"];
    await page.goto(new URL("index.html", base).href);
    await page.waitForURL("**/overview.html");
    for (const width of [320, 390, 768, 1024, 1366, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(new URL("index.html?workspace=1", base).href);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(":focus").textContent(), "Skip to the workspace");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator(":focus").getAttribute("id"), "workspace");
      await openNavigation();
      if (await menu.isVisible()) {
        await page.keyboard.press("Escape");
        assert.equal(await menu.getAttribute("aria-expanded"), "false");
        assert.equal(await page.locator(":focus").getAttribute("id"), "pages-toggle");
        await openNavigation();
      }
      await page.selectOption("#theme-select", "light");
      for (const [label, target] of destinations) {
        await openNavigation();
        assert.deepEqual(await nav.getByRole("link").allTextContents(), labels);
        const link = nav.getByRole("link", { name: label, exact: true });
        const box = await link.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width, label + " link outside viewport");
        await link.click();
        await page.waitForURL(new URL(target, base).href);
        await page.waitForFunction(label => document.querySelector('#project-nav [aria-current="page"]')?.textContent === label, label);
        assert.equal(await page.locator("#project-nav [aria-current]").count(), 1);
        assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
        if (label === "Results") await page.locator("#results-status[hidden]").waitFor({ state: "attached" });
      }
      await page.goto(new URL("overview.html", base).href);
      await openNavigation();
      assert.deepEqual(await nav.getByRole("link").allTextContents(), ["Overview", "Workspace", "Sky Explorer", "Simulator", "Results", "About"], "Overview keeps its classic project menu");
      // The two same-document destinations must keep the loaded field and its URL parameters.
      await page.goto(new URL("index.html?ra=133.8189&dec=-7.247&fov=5&det=D2#workspace", base).href);
      await page.waitForFunction(() => !document.querySelector("#play-btn").disabled);
      const imageGeometry = () => page.locator("#blink-canvas").evaluate(canvas => {
        const rect = canvas.getBoundingClientRect();
        return [rect.width, rect.height, Math.round(rect.top + scrollY)];
      });
      const before = await imageGeometry();
      assert.equal(before[0], before[1], "the image remains square");
      for (const id of ["viewer-settings", "image-layers", "simulation-note"]) {
        const opener = page.locator('[data-open-panel="' + id + '"]');
        await opener.click();
        const panel = page.locator("#" + id);
        assert.ok(await panel.isVisible());
        assert.deepEqual(await imageGeometry(), before, "opening " + id + " moved the image");
        if (id === "viewer-settings") {
          await panel.locator("#centre-crosshair").uncheck();
          await panel.locator("#centre-crosshair").check();
        }
        if (id === "image-layers") await page.mouse.click(1, 1);
        else if (id === "simulation-note") await panel.getByRole("button", { name: "Close" }).click();
        else await page.keyboard.press("Escape");
        assert.equal(await panel.isVisible(), false);
        assert.equal(await page.locator(":focus").getAttribute("data-open-panel"), id);
      }
      const query = new URL(page.url()).search;
      for (const label of ["About", "Workspace"]) {
        await openNavigation();
        await nav.getByRole("link", { name: label, exact: true }).click();
        assert.equal(new URL(page.url()).search, query);
        assert.equal(await page.locator("#play-btn").isEnabled(), true);
      }
      console.log("Shared navigation, keyboard, saved theme and field links passed at", width, "px");
    }
    await page.goto(new URL("index.html?embed=1", base).href);
    await page.locator("html.embed,body.embed").first().waitFor({ state: "attached" });
    assert.equal(await page.locator(".site-header").isVisible(), false);
    assert.ok(await page.locator("#workspace").isVisible());
  } finally {
    await browser.close();
    if (server) server.close();
  }
}
checkNavigation().catch(error => { console.error(error); process.exitCode = 1; });
