const {chromium}=require('playwright'); const assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'msedge'});try{
 const p=await b.newPage({viewport:{width:1280,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://127.0.0.1:18769/index.html');
 await p.locator('.workspace-settings').evaluate(e=>e.open=true); await p.locator('[data-theme-picker]').selectOption('light-research');
 assert.equal(await p.locator('html').getAttribute('data-theme'),'light-research');
 await p.locator('#planetx-demo-btn').click();
 await p.locator('#stage-overlay.hidden').waitFor({timeout:30000});
 console.log('frames',await p.locator('#frame-counter').textContent(),'observations',await p.locator('#observation-select option').count());
 await p.locator('.view-settings').evaluate(e=>e.open=true); await p.locator('#image-zoom').selectOption('2');assert.ok(await p.locator('.image-plane').evaluate(e=>e.getBoundingClientRect().width >= 2*e.parentElement.clientWidth-2));
 await p.locator('#find-distant-btn').click(); await p.waitForTimeout(2500);console.log('movers',await p.locator('#movers-status').textContent());
 await p.goto('http://127.0.0.1:18769/results.html');assert.equal(await p.locator('html').getAttribute('data-theme'),'light-research');console.log('results',await p.locator('#candidate-explorer').isVisible()); console.log('errors',errs);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
