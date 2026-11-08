/* Exercise simulator readouts and invalid-input recovery on the checked-out frontend. */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { resolve, sep } = require("node:path");

async function check() {
  const root = resolve(__dirname, "../frontend");
  const origin = "http://simulator.local";
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 820 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const path = resolve(root, decodeURIComponent(url.pathname.slice(1) || "index.html"));
      return path.startsWith(root + sep) ? route.fulfill({ path }) : route.abort();
    });
    await page.goto(origin + "/simulator.html");
    await page.locator("#day").fill("180");
    await page.waitForFunction(() => document.querySelector("#offset")?.textContent.includes("″"));
    assert.match(await page.locator("#earth").textContent(), /^-?\d+\.\d{3} \/ -?\d+\.\d{3} \/ -?\d+\.\d{3}$/);
    assert.match(await page.locator("#range").textContent(), /^\d+\.\d{3} AU$/);
    assert.match(await page.locator("#offset").textContent(), /^-?\d+″ \/ -?\d+″$/);
    await page.locator("#mode").selectOption("scientific");
    assert.match(await page.locator("#scale").textContent(), /Uniform spatial scale/);
    await page.locator("#distance").fill("0");
    assert.equal(await page.locator("#offset").textContent(), "—");
    assert.match(await page.locator("#status").textContent(), /Enter valid coordinates/);
    await page.locator("#distance").fill("500");
    assert.match(await page.locator("#offset").textContent(), /″/);
    await page.locator("#distance").fill("20000");
    assert.match(await page.locator("#offset").textContent(), /^-?\d+\.\d″ \/ -?\d+\.\d″$/);
    await page.locator("#ra").fill("359.8");
    await page.locator("#dec").fill("-45");
    assert.match(await page.locator("#offset").textContent(), /^-?\d+\.\d″ \/ -?\d+\.\d″$/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log("Simulator rounded readouts and invalid-input recovery passed");
  } finally {
    await browser.close();
  }
}
check().catch(error => { console.error(error); process.exitCode = 1; });
