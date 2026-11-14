/* Run with Playwright, BLINK_URL (a local frontend server, default http://127.0.0.1:8765/) and optionally BLINK_BROWSER (chrome, msedge). */
const {chromium}=require('playwright'); const assert=require('node:assert/strict');
const BASE=process.env.BLINK_URL||'http://127.0.0.1:8765/';
(async()=>{const b=await chromium.launch({channel:process.env.BLINK_BROWSER||undefined});try{
 const p=await b.newPage({viewport:{width:1280,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto(BASE+'index.html#workspace');
 await p.locator('#theme-select').selectOption('light');
 assert.equal(await p.locator('html').getAttribute('data-theme'),'light');
 await p.locator('#planetx-demo-btn').click();
 await p.locator('#stage-overlay.hidden').waitFor({timeout:30000});
 console.log('frames',await p.locator('#frame-counter').textContent(),'observations',await p.locator('#observation-select option').count());
 await p.locator('#zoom-in-btn').click(); assert.notEqual((await p.locator('#zoom-level').textContent()).trim(),'×1');
 await p.locator('#find-distant-btn').click(); await p.waitForTimeout(2500);console.log('movers',await p.locator('#movers-status').textContent());
 await p.goto(BASE+'results.html');assert.equal(await p.locator('html').getAttribute('data-theme'),'light');console.log('results',await p.locator('#candidate-explorer').isVisible()); console.log('errors',errs);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
