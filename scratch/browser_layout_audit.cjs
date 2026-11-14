const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { resolve, sep } = require("node:path");
const { readFile } = require("node:fs/promises");
const { createServer } = require("node:http");

async function serveCheckout() {
  const root = resolve(__dirname, "../frontend");
  const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };
  const server = createServer(async (request, response) => {
    const path = resolve(root, decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice(1) || "index.html"));
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      response.writeHead(200, { "Content-Type": mime[path.slice(path.lastIndexOf("."))] || "application/octet-stream" }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function luminance(rgb) {
  const channels = rgb.startsWith("#") ? [1, 3, 5].map(i => parseInt(rgb.slice(i, i + 2), 16)) : rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
  const values = channels.map(value => value / 255);
  const linear = values.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function main() {
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  let server;
  try {
    const page = await browser.newPage();
    if (!process.env.BLINK_URL) server = await serveCheckout();
    const base = process.env.BLINK_URL || `http://127.0.0.1:${server.address().port}/`;
    const pages = ["index.html", "overview.html", "results.html", "sky.html", "simulator.html", "planet-x.html"];
    for (const name of pages) {
      for (const theme of ["deep-space", "observatory", "light", "midnight"]) {
        for (const width of [320, 375, 768, 1280]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(base + name + (name === "index.html" ? "?workspace=1" : ""));
          await page.evaluate(value => localStorage.setItem("spherex-blink-theme", value), theme);
          await page.reload();
          assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
          const audit = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const panel = document.querySelector(".panel");
            // A transparent field panel exposes the ancestor surface behind it.
            let backdrop = panel;
            while (backdrop && getComputedStyle(backdrop).backgroundColor === "rgba(0, 0, 0, 0)") {
              backdrop = backdrop.parentElement;
            }
            return {
              overflow: document.documentElement.scrollWidth - innerWidth,
              bodyText: getComputedStyle(document.body).color,
              bodySurface: root.getPropertyValue("--bg").trim(),
              panelText: panel ? getComputedStyle(panel).color : null,
              panelSurface: backdrop ? getComputedStyle(backdrop).backgroundColor : root.getPropertyValue("--bg").trim(),
              mutedText: root.getPropertyValue("--text-muted").trim(),
            };
          });
          if (audit.overflow > 2) {
            const offenders = await page.evaluate(() => [...document.querySelectorAll("body *")]
              .filter(el => el.getBoundingClientRect().right > innerWidth + 2)
              .slice(0, 12).map(el => ({ tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 60),
                right: Math.round(el.getBoundingClientRect().right), width: Math.round(el.getBoundingClientRect().width) })));
            console.error("Overflow elements:", offenders);
          }
          assert.ok(audit.overflow <= 2, `${name} ${theme} ${width}px overflows by ${audit.overflow}px`);
          assert.ok(contrast(audit.bodyText, audit.bodySurface) >= 4.5, `${name} ${theme} body contrast`);
          if (audit.panelText) {
            assert.ok(contrast(audit.panelText, audit.panelSurface) >= 4.5, `${name} ${theme} panel contrast`);
            assert.ok(contrast(audit.mutedText, audit.panelSurface) >= 4.5, `${name} ${theme} muted contrast`);
          }
          if (width === 320) {
            await page.keyboard.press("Tab");
            assert.ok(await page.locator(":focus").evaluate(element => element.classList.contains("skip-link")),
              `${name} ${theme} skip link focus`);
          }
        }
      }
      console.log(name, "layout, text contrast and skip focus passed");
    }
  } finally {
    await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
