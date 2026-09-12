const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch();
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:8000/');
 await page.waitForFunction(()=>window.oksPortal);
 assert.equal(await page.evaluate(()=>TULA_DATA.oks.length),95);
 assert.equal(await page.evaluate(()=>oksPortal.filtered().length),53);
 await page.click('[data-mode="all"]');
 assert.equal(await page.evaluate(()=>oksPortal.filtered().length),95);
 await page.check('#unmappedOnly');
 assert.equal(await page.evaluate(()=>oksPortal.filtered().length),37);
 await page.uncheck('#unmappedOnly');
 await page.evaluate(()=>oksPortal.openCard('archive-001'));
 for(const tab of ['media','access','procure','report']) await page.click('[data-tab="'+tab+'"]');
 await page.click('[data-tab="access"]');
 await page.check('#walkingEnabled');
 for(const [minutes,bands] of [[5,1],[17,4],[30,6]]) {
 await page.locator('#walkingMinutes').evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},minutes);
 assert.equal(await page.locator('.walking-band').count(),bands);
 }
 await page.evaluate(()=>oksPortal.openCard('archive-054'));
 await page.click('[data-tab="access"]');
 assert.match(await page.locator('#cardBody').innerText(),/требует проверки/);
 assert.equal(await page.locator('#walkingMinutes').count(),0);
 await page.evaluate(()=>oksPortal.exitDistrict());
 await page.check('#fullMap');
 assert.equal(await page.evaluate(()=>oksPortal.state.fullMap),true);
 await page.uncheck('#fullMap');
 assert.equal(await page.evaluate(()=>oksPortal.state.fullMap),false);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/tula-v2-mobile.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: archive, filters, cards, 5–30 minute bands, approximate coordinates, full map, mobile width; no JS errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
