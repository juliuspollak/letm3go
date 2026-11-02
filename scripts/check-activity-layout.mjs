import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('../.build/browser-tools/node_modules/playwright');
import fs from 'node:fs';
import assert from 'node:assert/strict';
(async()=>{
 const browser = await chromium.launch({headless:true});
 const css = fs.readFileSync('src/styles.css','utf8');
 const results=[];
 for(const [name,viewport] of [['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]){
  const page = await browser.newPage({viewport,isMobile:true,hasTouch:true});
  await page.route('**/*', route=>route.abort());
  const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main style="margin-top:110px;padding:0 21px"><div class="swipe-back-page"><section class="detail detail-sheet-page"><h1>SYNTHETIC CSS GEOMETRY FIXTURE</h1><p>Not an actual ride or app screenshot.</p><div class="activity-sheet" style="--activity-sheet-height:300px"><div class="activity-sheet-body">Fixture sheet</div></div></section></div></main>`;
  await page.setContent(html);
  const fixed=await page.locator('.detail-sheet-page').boundingBox();
  const pass=Math.abs(fixed.x)<1&&Math.abs(fixed.y)<1&&Math.abs(fixed.width-viewport.width)<1&&Math.abs(fixed.height-viewport.height)<1;
  await page.screenshot({path:`.build/phase1/geometry-${name}.png`});
  await page.addStyleTag({content:'.swipe-back-page{will-change:transform !important}'});
  const old=await page.locator('.detail-sheet-page').boundingBox();
  results.push({name,viewport,fixed,oldContainingBlock:old,pass});
  if(name==='portrait') {assert.ok(pass,'portrait page must be viewport fixed');assert.ok(old.x>15&&old.y>90,'old will-change must reproduce offset');}
  await page.close();
 }
 fs.writeFileSync('.build/phase1/browser-geometry.json',JSON.stringify({browser:await browser.version(),fixture:'CSS-only synthetic containing-block reproducer, no native map or actual activity data',results},null,2));
 console.log(JSON.stringify(results,null,2));
 await browser.close();
 if(results.some(x=>!x.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
