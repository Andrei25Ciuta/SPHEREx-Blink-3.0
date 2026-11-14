/* Run with Playwright, BLINK_URL (a local frontend server, default http://127.0.0.1:8765/) and optionally BLINK_BROWSER (chrome, msedge). */
const {chromium}=require('playwright');
const BASE=process.env.BLINK_URL||'http://127.0.0.1:8765/';
(async()=>{
 const browser=await chromium.launch({channel:process.env.BLINK_BROWSER||undefined});
 try{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const path of ['index.html','results.html','sky.html','simulator.html']){
   await page.goto(BASE+(path==='index.html'?'index.html#workspace':path));
   await page.waitForTimeout(600);
   console.log(path, await page.title(), errors.splice(0));
   if(path==='sky.html') console.log('sky',await page.locator('#status').textContent());
   if(path==='simulator.html') console.log('scene',await page.locator('#scene').locator('*').count());
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
