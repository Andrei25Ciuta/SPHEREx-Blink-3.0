const assert = require("node:assert/strict");
const { chromium } = require("playwright");

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
  try {
    const page = await browser.newPage();
    const base = process.env.BLINK_URL || "http://127.0.0.1:8765/";
    const pages = ["index.html", "results.html", "sky.html", "simulator.html", "planet-x.html"];
    for (const name of pages) {
      for (const theme of ["deep-space", "observatory", "light-research"]) {
        for (const width of [320, 375, 768, 1280]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(base + name);
          await page.evaluate(value => localStorage.setItem("spherex-blink.theme", value), theme);
          await page.reload();
          const audit = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const panel = document.querySelector(".panel");
            return {
              overflow: document.documentElement.scrollWidth - innerWidth,
              bodyText: getComputedStyle(document.body).color,
              bodySurface: root.getPropertyValue("--bg").trim(),
              panelText: panel ? getComputedStyle(panel).color : null,
              panelSurface: panel ? getComputedStyle(panel).backgroundColor : null,
              mutedText: root.getPropertyValue("--text-muted").trim(),
            };
          });
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
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
