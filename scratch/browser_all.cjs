const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge'});
 try{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const path of ['index.html','results.html','sky.html','simulator.html','planet-x.html']){
   await page.goto('http://127.0.0.1:18769/'+path);
   await page.waitForTimeout(600);
   console.log(path, await page.title(), errors.splice(0));
   if(path==='planet-x.html') console.log('lab', await page.locator('#summary').textContent());
   if(path==='sky.html') console.log('sky',await page.locator('#status').textContent());
   if(path==='simulator.html') console.log('scene',await page.locator('#scene').locator('*').count());
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
