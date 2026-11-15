/* Public HTTPS frontend -> actual local cloud ASGI fixture, with synthetic FITS. No external archive requests. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { resolve, sep, delimiter } = require('node:path');
const { mkdir } = require('node:fs/promises');

(async () => {
  const root = resolve(__dirname, '..'), frontend = resolve(root, 'frontend');
  const port = Number(process.env.BLINK_TEST_PORT || 8810), local = `http://127.0.0.1:${port}`;
  const ui = 'https://blink-ui.example', api = 'https://blink-api.example';
  const service = spawn(process.env.BLINK_PYTHON || 'python3', ['backend/tests/cloud_fixture.py', '--port', String(port)], {
    cwd: root, env: { ...process.env, PYTHONPATH: [resolve(root, 'backend'), resolve(root, 'backend/tests')].join(delimiter) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; service.stderr.on('data', d => logs += d);
  let browser;
  try {
    let ready = false;
    for (let i=0; i<80; i++) {
      try { ready = (await fetch(local+'/api/health')).ok; } catch {}
      if (ready) break;
      if (service.exitCode !== null) throw new Error(logs);
      await new Promise(r=>setTimeout(r, 100));
    }
    assert.ok(ready, logs || 'Fixture server did not start');
    browser = await chromium.launch(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : process.env.BLINK_BROWSER === 'chrome' ? { channel: 'chrome' } : {});
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', e=>errors.push(e.message));
      let acquisitionPosts = 0;
      let fail = false;
      await page.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.origin === api) {
          if (route.request().method() === 'POST' && u.pathname === '/api/field-requests') acquisitionPosts++;
          if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Fixture storage unavailable' }), headers: { 'access-control-allow-origin': ui } });
          const response = await fetch(local+u.pathname+u.search, { headers: { Origin: ui } });
          return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
        }
        if (u.origin !== ui) return route.abort();
        const file = resolve(frontend, decodeURIComponent(u.pathname.slice(1) || 'index.html'));
        if (!file.startsWith(frontend+sep)) return route.abort();
        return route.fulfill({ path: file });
      });
      const url = ui+'/index.html?data=api&legacy_api=1&api='+encodeURIComponent(api)+'&ra=150&dec=20&fov=5&det=D2#workspace';
      await page.goto(url);
      await page.locator('#stage-overlay.hidden').waitFor({ timeout: 20000 });
      assert.equal(acquisitionPosts, 0, 'legacy prepared-data links use the existing GET API only');
      assert.match(await page.title(), /SPHEREx/i);
      assert.match(await page.locator('#data-source-badge').textContent(), /synthetic/i);
      assert.match(await page.locator('#frame-counter').textContent(), /3/);
      assert.equal(await page.locator('#data-source option[value="api"]').evaluate(e=>e.disabled), false);
      const before = await page.locator('#frame-counter').textContent();
      await page.locator('#play-btn').click();
      await page.waitForFunction(value => document.querySelector('#frame-counter').textContent !== value, before);
      await page.locator('#play-btn').click();
      assert.equal(await page.locator('#play-btn').getAttribute('aria-label'), 'Play');
      await page.locator('#zoom-in-btn').click();
      assert.notEqual((await page.locator('#zoom-level').textContent()).trim(), '×1');
      await page.locator('[data-open-panel="viewer-settings"]').click();
      await page.keyboard.press('Escape');
      assert.ok(await page.locator('#stage-overlay.hidden').count());
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1));
      await mkdir('/tmp/blink-cloud-evidence', { recursive: true });
      await page.screenshot({ path: `/tmp/blink-cloud-evidence/workspace-${width}.png` });
      fail = true;
      await page.reload();
      await page.locator('#stage-overlay.error').waitFor();
      assert.match(await page.locator('#stage-overlay').textContent(), /Fixture storage unavailable/);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Cloud browser checks passed at 390 and 1440 px: HTTPS selection, synthetic provenance, frames, playback, zoom, Settings, explicit 503 failure.');
  } finally {
    if (browser) await browser.close();
    service.kill('SIGTERM');
  }
})().catch(e=>{ console.error(e); process.exitCode=1; });
