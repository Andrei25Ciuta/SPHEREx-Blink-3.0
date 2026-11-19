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

async function run(browser, { mobile = false, fail = "", compatibility = false, submit = false } = {}) {
  const context = await browser.newContext({
    ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
    serviceWorkers: "block",
  });
  const posts = [], apiReads = [], errors = [], dr1Images = [], fallbackImages = [];
  const payloads = [];
  const mapFailures = [];
  let blocked = 0;
  // Register BEFORE a page exists. Only the local test fixture can fulfill a field POST;
  // no acquisition or retry is ever forwarded, regardless of hostname.
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (!["GET", "HEAD"].includes(method)) {
      if (/\/api\/field-requests(?:\/|$)/.test(url.pathname)) posts.push(`${method} ${url.pathname}`);
      if (submit && method === "POST" && url.origin === base.origin && url.pathname === "/api/field-requests") {
        const payload = request.postDataJSON();
        payloads.push(payload);
        await wait(400); // keep the first request pending during repeated activation
        return route.fulfill({ json: {
          requestId: "fr-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", status: "queued", cached: false,
          statusUrl: "/api/field-requests/fr-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          query: { ra: payload.ra, dec: payload.dec, fov: payload.fov }, detectors: {},
        } });
      }
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
    if (!response.ok() && (isDr1(url) || isFallback(url))) mapFailures.push(`${response.status()} ${url.pathname}`);
    if (response.ok() && isDr1Png(url)) dr1Images.push(url.pathname);
    if (response.ok() && isMapHost(url) && isFallback(url) && /(?:Allsky|Npix\d+)\.(?:jpe?g|png)$/i.test(url.pathname)) {
      fallbackImages.push(url.pathname);
    }
  });
  page.on("requestfailed", request => {
    const url = new URL(request.url());
    if (isDr1(url) || isFallback(url)) mapFailures.push(`${request.failure()?.errorText} ${url.pathname}`);
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
    if (submit) url.searchParams.set("api", base.origin);
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
    const ra = page.locator("#sky-zone-ra"), dec = page.locator("#sky-zone-dec");
    const fov = page.locator("#sky-zone-fov"), button = page.getByRole("button", { name: "Request this zone" });
    let beforeDraftRa;
    if (submit) {
      await button.waitFor();
      assert.equal(await fov.inputValue(), "5", "default zone width is 5 arcmin");
      beforeDraftRa = Number(await ra.inputValue());
      assert.ok(Math.abs(beforeDraftRa - 269.4462) < 0.001);
    }
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
    if (submit) await eventually(async () => Math.abs(Number(await ra.inputValue()) - beforeDraftRa) > 0.01,
      "pan did not update the draft coordinates");
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
    if (submit) {
      assert.equal(await fov.inputValue(), "5", "zoom does not change submitted zone width");
      await ra.fill("08:");
      if (await button.isEnabled()) await button.click();
      assert.match(await page.locator("#sky-zone-error").textContent(), /RA:/);
      assert.deepEqual(posts, [], "incomplete RA cannot submit a different sky centre");
      await ra.fill("08:00:00");
      await ra.press("Enter");
      await dec.fill("--7.25");
      if (await button.isEnabled()) await button.click();
      assert.match(await page.locator("#sky-zone-error").textContent(), /Dec:/);
      assert.deepEqual(posts, [], "a repeated sign cannot switch hemispheres");
      await dec.fill("-07:15:00");
      await dec.press("Enter");
      await fov.fill("0");
      await fov.press("Tab");
      if (await button.isEnabled()) await button.click();
      assert.deepEqual(posts, [], "invalid size cannot submit");
      await fov.fill("11");
      await fov.press("Tab");
      if (await button.isEnabled()) await button.click();
      assert.deepEqual(posts, [], "out-of-range size cannot submit");
      await fov.fill("7.25");
      await fov.press("Enter");
      assert.deepEqual(posts, [], "draft edits and Enter in an input do not submit");
      assert.equal(new URL(page.url()).searchParams.has("ra"), false, "the URL contains no uncommitted draft");
      await button.press("Enter");
      await button.evaluate(el => { el.click(); el.click(); });
      await eventually(() => payloads.length === 1, "no mocked field request received");
      const payload = payloads[0];
      assert.deepEqual(payload, {
        ra: 120, dec: -7.25, fov: 7.25, dateFrom: null, dateTo: null,
        detectors: ["D1", "D2", "D3", "D4", "D5", "D6"], collection: "spherex_dr1",
      });
      await eventually(() => {
        const params = new URL(page.url()).searchParams;
        return ["ra", "dec", "fov"].every(key => params.has(key) && Number(params.get(key)) === payload[key]);
      }, "committed URL differs from the submitted coordinates");
      await eventually(async () => /\b(?:sent|submitted|received|accepted|queued)\b/i.test(await page.locator("#sky-zone-status").textContent()),
        "mock request acknowledgment was not announced");
      assert.deepEqual(posts, ["POST /api/field-requests"], "one explicit action may send only one POST");
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await eventually(async () => label.test(await status.textContent()), "wrong survey status after reload");
    if (fail) assert.ok(blocked > 0, "failure fixture never ran");
    if (submit) assert.deepEqual(posts, ["POST /api/field-requests"], "reload submitted again");
    console.log(`PASS ${mobile ? "phone (touch pan/pinch)" : "desktop (drag/wheel)"} ${fail ? `2MASS fallback after DR1 ${fail} failure` : "DR1 0.753 µm"}: rendered sky, interaction, reload`);
    if (submit) console.log("PASS P2 zone validation, keyboard submission, canonical payload and URL, repeat guard, reload without a POST");
  } catch (error) {
    console.error("Pilot failure details:", {
      mobile, fail, submit, status: await page.locator("#aladin-status").textContent({ timeout: 1000 }).catch(() => null),
      mapFailures: [...new Set(mapFailures)].slice(-12), posts,
    });
    throw error;
  } finally {
    await context.close();
    assert.ok(submit ? posts.length <= 1 && posts.every(post => post === "POST /api/field-requests") : !posts.length,
      `unexpected acquisition or retry attempts: ${posts.join(", ")}`);
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
    await run(browser, { submit: true });
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
