const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto((process.env.BLINK_URL || "http://127.0.0.1:8765/") + "results.html");
    await page.locator("#results-status").waitFor({ state: "hidden" });
    const exportData = {
      tool: "SPHEREx Blink", generated: "2026-11-08T00:00:00Z",
      data: "SYNTHETIC demo data (invented in the browser, NOT SPHEREx observations)",
      field: { ra_deg: 269.4462, dec_deg: 4.769, fov_arcmin: 5, detector: "D2" },
      candidates: [{ candidate: "#1", kind: "mover (straight line)", ra_deg: 269.4462,
        dec_deg: 4.769, detector: "D2", detections: 3, images: 3, speed_arcsec_per_yr: 10.4,
        data: "SYNTHETIC demo data (invented in the browser, NOT SPHEREx observations)",
        search_frames: ["D2@60908.981929", "D2@61114.099563", "D2@61273.515"],
        fit_centroids: [{ frame_index: 0, x_px: 50.25, y_px: 51.5 },
          { frame_index: 1, x_px: 50.75, y_px: 52 }, { frame_index: 2, x_px: 51.25, y_px: 52.5 }] }],
    };
    await page.locator("#candidate-file").setInputFiles({ name: "candidate.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exportData)) });
    await page.getByText("Candidate export loaded.").waitFor();
    assert.match(await page.locator("#candidate-count").textContent(), /1 of 1 records/);
    await page.locator("#candidate-samples").evaluate(element => { element.open = true; });
    await page.locator("#centroid-rows tr").first().waitFor();
    assert.equal(await page.locator("#centroid-rows tr").count(), 3);
    await page.locator("#build-report").click();
    assert.match(await page.locator("#report-output").textContent(), /10\.4/);
    assert.match(await page.locator("#candidate-viewer").getAttribute("href"), /index\.html\?ra=269\.4462/);
    assert.deepEqual(errors, []);
    console.log("Candidate import, evidence and report passed in browser");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
