/* Sky Explorer archive failures and recovery, with all network responses controlled locally. */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { resolve, sep } = require("node:path");

const root = resolve(__dirname, "../frontend");
const collection = "spherex_qr2";
const liveResult = {
  source: "https://irsa.ipac.caltech.edu/SIA?sample=1",
  retrieved: "2026-11-08T17:00:00+00:00",
  query: { ra: 127.69444, dec: -39.1776, fov: 2, collection },
  records: [{ id: "live-product-1", detector: "D2", startMjd: 61000.25,
    footprint: [[127.69, -39.18], [127.70, -39.18], [127.70, -39.17], [127.69, -39.17]],
    productUrl: "https://irsa.ipac.caltech.edu/ibe/data/spherex/sample.fits" }], truncated: false,
};

function staticRoute(route, origin, prefix) {
  const url = new URL(route.request().url());
  if (url.origin !== origin || !url.pathname.startsWith(prefix)) return route.abort();
  const file = resolve(root, decodeURIComponent(url.pathname.slice(prefix.length) || "index.html"));
  if (!file.startsWith(root + sep)) return route.abort();
  return route.fulfill({ path: file });
}

async function check() {
  const browser = await chromium.launch({ channel: process.env.BLINK_BROWSER || undefined });
  try {
    const publicOrigin = "https://blink.example";
    const prefix = "/SPHEREx-Blink-2.0/";
    const publicPage = await browser.newPage({ viewport: { width: 320, height: 800 } });
    const publicApi = [];
    publicPage.on("request", request => { if (request.url().includes("/api/observations")) publicApi.push(request.url()); });
    await publicPage.route("**/*", route => staticRoute(route, publicOrigin, prefix));
    await publicPage.goto(publicOrigin + prefix + "sky.html");
    await publicPage.locator("#products:not([hidden])").waitFor();
    assert.equal(await publicPage.locator('#search button[type="submit"]').isDisabled(), true);
    assert.match(await publicPage.locator("#live-search-help").textContent(), /local .*backend/i);
    assert.deepEqual(publicApi, []);
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await publicPage.goto(publicOrigin + prefix + "sky.html?ra=127.69444&dec=-39.1776&fov=2&collection=spherex_qr2");
    await publicPage.getByText(/Live archive search requires the local Blink backend/).waitFor();
    assert.deepEqual(publicApi, [], "public deep links do not call a nonexistent API");
    await publicPage.locator("#example").click();
    await publicPage.locator("#products:not([hidden])").waitFor();
    await publicPage.close();

    const localOrigin = "http://localhost:8765";
    const apiOrigin = "http://localhost:8001";
    const localPage = await browser.newPage();
    const errors = [];
    localPage.on("pageerror", error => errors.push(error.message));
    let apiResponse = { status: 502, body: { detail: "IRSA image metadata is unavailable. Retry the search." } };
    await localPage.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === apiOrigin && url.pathname === "/api/observations")
        return route.fulfill({ status: apiResponse.status, contentType: "application/json", body: JSON.stringify(apiResponse.body) });
      return staticRoute(route, localOrigin, "/");
    });
    await localPage.goto(localOrigin + "/sky.html?api=" + encodeURIComponent(apiOrigin));
    await localPage.locator("#products:not([hidden])").waitFor();
    const savedCount = await localPage.locator("#rows tr").count();
    assert.ok(savedCount > 0);
    await localPage.locator("#ra").fill("not a coordinate");
    await localPage.locator('#search button[type="submit"]').click();
    assert.match(await localPage.locator("#status").textContent(), /Right Ascension|RA|number/i);
    assert.equal(await localPage.locator("#products").isVisible(), true,
      "invalid input keeps the last valid field visible");
    assert.equal(await localPage.locator("#rows tr").count(), savedCount);

    await localPage.locator("#ra").fill("127.69444");
    await localPage.locator('#search button[type="submit"]').click();
    await localPage.getByText(/Live archive search unavailable.*IRSA image metadata is unavailable/).waitFor();
    await localPage.locator("#example").click();
    await localPage.locator("#products:not([hidden])").waitFor();
    assert.equal(await localPage.locator("#rows tr").count(), savedCount);

    apiResponse = { status: 200, body: { wrong: "schema" } };
    await localPage.locator('#search button[type="submit"]').click();
    await localPage.getByText(/Live archive search unavailable.*invalid archive metadata response/i).waitFor();

    apiResponse = { status: 200, body: { ...liveResult, records: [null] } };
    await localPage.locator('#search button[type="submit"]').click();
    await localPage.getByText(/Live archive search unavailable.*invalid archive metadata response/i).waitFor();

    apiResponse = { status: 200, body: liveResult };
    await localPage.locator('#search button[type="submit"]').click();
    await localPage.locator("#rows button").getByText("live-product-1").waitFor();
    assert.match(await localPage.locator("#provenance").textContent(), /Live IRSA SIA2 response/);
    assert.equal(await localPage.locator("#rows tr").count(), 1);

    apiResponse = { status: 200, body: { ...liveResult, records: [] } };
    await localPage.locator('#search button[type="submit"]').click();
    await localPage.getByText("0 image products found.").waitFor();
    assert.equal(await localPage.locator("#rows tr").count(), 0);
    assert.equal(await localPage.locator("#workspace").isVisible(), false,
      "an empty archive search has no actionable observed-field link");
    assert.match(await localPage.locator("#empty-products").textContent(), /No image products/i);
    assert.deepEqual(errors, [], "no browser exceptions");
    await localPage.close();
    console.log("Sky Explorer public boundary, failure and recovery passed");
  } finally {
    await browser.close();
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
