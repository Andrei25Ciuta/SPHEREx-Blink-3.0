/* BLINK_URL=http://127.0.0.1:8765/ CHROME_PATH=/usr/bin/chromium node scratch/browser_sky_browse.cjs */
const assert = require("node:assert/strict");
const { chromium, devices } = require("playwright");

const base = new URL(process.env.BLINK_URL || "http://127.0.0.1:8765/");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "use a local frontend server");
const pilot = new URL("index.html?data=api&sky_browse=1#workspace", base);
const dr1 = "/data/hips/SPHEREx/spherex_allsky_cube/";
const isDr1 = url => url.hostname === "irsa.ipac.caltech.edu" && url.pathname.startsWith(dr1);
const isDr1Png = url => isDr1(url) && /\/(?:Allsky|Npix\d+)\.png$/i.test(url.pathname);
const isFallback = url => /(?:\/CDS\/2MASS\/Color\/|\/2MASSColor\/)/i.test(url.pathname);
const isMapHost = url => [
  "irsa.ipac.caltech.edu", "skies.esac.esa.int", "alaskybis.cds.unistra.fr",
  "alasky.cds.unistra.fr", "alasky.u-strasbg.fr",
].includes(url.hostname);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(check, description, timeout = 20000) {
  const end = Date.now() + timeout;
  do {
    if (await check()) return;
    await wait(200);
  } while (Date.now() < end);
  assert.fail(description);
}

async function mapHasSky(page, map) {
  const png = (await map.screenshot({ timeout: 5000 })).toString("base64");
  return page.evaluate(async (image) => {
    const im = new Image();
    im.src = `data:image/png;base64,${image}`;
    await im.decode();
    const canvas = document.createElement("canvas");
    canvas.width = im.width;
    canvas.height = im.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(im, 0, 0);
    // Sample a central area away from edge controls and the centre reticle.
    const { data } = ctx.getImageData(im.width * 0.18, im.height * 0.22, im.width * 0.25, im.height * 0.44);
    const tones = new Set();
    for (let i = 0; i < data.length; i += 4) {
      if (Math.max(data[i], data[i + 1], data[i + 2]) > 35) {
        tones.add(Math.round((data[i] + data[i + 1] + data[i + 2]) / 3));
      }
    }
    return tones.size >= 24;
  }, png);
}

async function run(browser, { mobile = false, fail = "", compatibility = false } = {}) {
  const context = await browser.newContext({
    ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
    serviceWorkers: "block",
  });
  const posts = [], apiReads = [], errors = [], dr1Images = [], fallbackImages = [];
  let blocked = 0;
  // Register the guard BEFORE a page exists. No real POST or retry can leave this context,
  // regardless of hostname. Allow only local files and the public map's read-only resources.
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (!["GET", "HEAD"].includes(method)) {
      if (/\/api\/field-requests(?:\/|$)/.test(url.pathname)) posts.push(`${method} ${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (/\/api\/(?:field-requests|cutouts)(?:\/|$)/.test(url.pathname)) apiReads.push(url.pathname);
    if (isDr1(url) && (fail === "tiles" && /\.png$/i.test(url.pathname) ||
                       fail === "metadata" && url.pathname.endsWith("/properties"))) {
      blocked++;
      return route.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" } });
    }
    if (url.origin === base.origin ||
        (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/aladin-lite@3.6.5/")) ||
        (isMapHost(url) && (isDr1(url) || isFallback(url)) && !/\.fits(?:\.gz)?$/i.test(url.pathname))) {
      return route.continue();
    }
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const url = new URL(response.url());
    if (response.ok() && isDr1Png(url)) dr1Images.push(url.pathname);
    if (response.ok() && isMapHost(url) && isFallback(url) && /(?:Allsky|Npix\d+)\.(?:jpe?g|png)$/i.test(url.pathname)) {
      fallbackImages.push(url.pathname);
    }
  });
  try {
    if (compatibility) {
      await page.goto(new URL("index.html?ra=269.4462&dec=4.769&fov=5&det=D2&embed=1#workspace", base).href);
      await page.locator("#stage-overlay.hidden").waitFor();
      assert.match(await page.locator("#data-source-badge").textContent(), /synthetic/i);
      assert.equal(await page.locator("html").evaluate(el => el.classList.contains("sky-browse")), false);
      assert.equal(await page.locator("#context-title").innerText(), "Sky context");
      await page.goto(new URL("learn.html", base).href);
      assert.match(await page.title(), /learn/i);
      assert.equal(await page.locator("html").evaluate(el => el.classList.contains("sky-browse")), false);
      console.log("PASS legacy synthetic Workspace deep link, embed and Learn Mode");
      return;
    }
    const status = page.locator("#aladin-status");
    const map = page.locator("#aladin-box");
    const url = new URL(pilot);
    // Stale coordinates used to trigger legacy form submission on startup.
    if (mobile || fail) {
      url.searchParams.set("ra", "155");
      url.searchParams.set("dec", "10");
      url.searchParams.set("fov", "8");
    }
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    await map.waitFor({ state: "visible", timeout: 30000 });
    assert.equal(await page.locator("#context-title").innerText(), "Browse the sky");
    assert.equal(await page.locator("#search-form").isVisible(), false);
    const label = fail ? /2MASS/i : /0\.753\s*µm/;
    await eventually(async () => label.test(await status.textContent()), `wrong survey status (${fail || "DR1"})`);
    if (fail) assert.match(await status.textContent(), /unavailable|could not|fallback/i);
    await eventually(() => (fail ? fallbackImages : dr1Images).some(path => /\/Norder[1-9]\d*\/.*\/Npix\d+\./.test(path)),
      "the viewer did not fetch a successful map tile beyond the startup probe");
    await eventually(() => mapHasSky(page, map), "map has no rendered sky detail");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);

    const readout = map.locator(".sky-readout");
    await eventually(async () => /269\.44\d.*4\.769/.test(await readout.textContent()), "did not start at Barnard's Star");
    const beforePan = await readout.textContent();
    const box = await map.boundingBox();
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      const touch = (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
      await touch("touchStart", [{ x, y }]);
      for (let i = 1; i <= 8; i++) await touch("touchMove", [{ x: x + i * 7, y: y + i * 3 }]);
      await touch("touchEnd", []);
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 90, y + 45, { steps: 10 });
      await page.mouse.up();
      await page.mouse.move(1, 1);
    }
    await eventually(async () => {
      const value = await readout.textContent();
      return value.startsWith("Centre:") && value !== beforePan;
    }, "pan did not change the map centre");
    const scale = page.locator("#sky-map-scale");
    await scale.waitFor();
    const beforeZoom = await scale.evaluate(el => `${el.textContent}:${el.style.getPropertyValue("--scale-width")}`);
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      const touch = (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
      const pair = (d) => [{ x: x - d, y, id: 1 }, { x: x + d, y, id: 2 }];
      await touch("touchStart", pair(24));
      for (let i = 1; i <= 10; i++) await touch("touchMove", pair(24 + i * 7));
      await touch("touchEnd", []);
    } else {
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, -500);
    }
    await eventually(async () => (await scale.evaluate(el => `${el.textContent}:${el.style.getPropertyValue("--scale-width")}`)) !== beforeZoom,
      "zoom did not change the angular scale");
    await page.reload({ waitUntil: "domcontentloaded" });
    await eventually(async () => label.test(await status.textContent()), "wrong survey status after reload");
    if (fail) assert.ok(blocked > 0, "failure fixture never ran");
    console.log(`PASS ${mobile ? "phone (touch pan/pinch)" : "desktop (drag/wheel)"} ${fail ? `2MASS fallback after DR1 ${fail} failure` : "DR1 0.753 µm"}: rendered sky, interaction, reload`);
  } finally {
    await context.close();
    assert.deepEqual(posts, [], "acquisition or retry requests were attempted");
    assert.deepEqual(apiReads, [], "browse, synthetic and Learn must not read cloud field/cutout endpoints");
    assert.deepEqual(errors, [], "uncaught browser errors");
  }
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? {
    executablePath: process.env.CHROME_PATH,
    args: ["--enable-unsafe-swiftshader"],
  } : { channel: process.env.BLINK_BROWSER || undefined });
  try {
    await run(browser);
    await run(browser, { mobile: true });
    await run(browser, { fail: "tiles" });
    await run(browser, { mobile: true, fail: "metadata" });
    await run(browser, { compatibility: true });
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
