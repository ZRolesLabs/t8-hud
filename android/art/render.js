const { chromium } = require('playwright');
const { icons, banners, extra } = require('./icons.js');
const css = `@font-face{font-family:BigS;src:url(BigShouldersDisplay.woff2)}@font-face{font-family:JBM;src:url(JetBrainsMono.woff2)}html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}`;
const jobs = JSON.parse(process.argv[2]);
(async()=>{
 const b = await chromium.launch(); const fs=require('fs');
 for (const [svg,w,h,out] of jobs) {
  const p = await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
  const src = eval(svg);
  fs.writeFileSync('r.html',`<style>${css}</style>${src}`);
  await p.goto('file://'+process.cwd()+'/r.html'); await p.waitForTimeout(400);
  await p.screenshot({path:out, omitBackground:true}); await p.close();
 }
 await b.close();
})();
