// ZRL TV banner standard v3 (2026-11-21): the PC icon look on a 16:9 tile.
// Flask centred on top, cyan pill underneath with the app's full name. Same pill width on every tile.
// node tv-banner.js  -> ../app/src/main/res/drawable-xhdpi/banner.png (640x360) + drawable/banner.png (320x180)
// Copy JetBrainsMono.woff2 from public/fonts/ next to this script first. Same template as every ZRolesLabs TV app.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const res = path.join(__dirname, '..', 'app', 'src', 'main', 'res'); const caps = false;
const APPS = [['t8hud', 'T8 HUD']];
const defs = `<defs><radialGradient id="bg" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#241238"/><stop offset="1" stop-color="#0a0712"/></radialGradient>
<linearGradient id="liq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e535c8"/><stop offset="1" stop-color="#7b2ff0"/></linearGradient>
<filter id="glowS" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
// flask exactly as the PC icons (windows-v2): dark glass, wave liquid, Z outline path
const flask = (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})" filter="url(#glowS)"><path d="M-40 -60 V-160 Q-40 -172 -28 -172 H28 Q40 -172 40 -160 V-60 L130 95 Q145 125 110 125 H-110 Q-145 125 -130 95 Z" fill="#0a0712" stroke="#c86bff" stroke-width="18" stroke-linejoin="round"/>
<path d="M-66 -10 Q-50 -34 -33 -10 T0 -10 T33 -10 T66 -10 L118 90 Q126 108 104 108 H-104 Q-126 108 -118 90 Z" fill="url(#liq)"/><path d="M-30.09 96V77.72L6.55 -20.62H-28.05V-40H30.01V-21.39L-8.08 76.62H27.37V96Z" fill="#f3eefe"/>
<circle cx="-66" cy="50" r="10" fill="#fff" opacity=".7"/><circle cx="70" cy="74" r="7" fill="#fff" opacity=".7"/><circle cx="-10" cy="-120" r="8" fill="#fff" opacity=".5"/></g>`;
// SPEC (640x360): flask centre (320,150) scale .62 | pill 420x64 centred at y 282, rx 32, fill #06222a, stroke #33e6ff 4
// name JetBrains Mono 700 32px, letter-spacing 4, cyan, centred | frame 3px #c86bff 55%
const svg = n => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">${defs}
<rect width="640" height="360" fill="url(#bg)"/><rect x="1.5" y="1.5" width="637" height="357" rx="6" fill="none" stroke="#c86bff" stroke-opacity=".55" stroke-width="3"/>
${flask(320, 146, 0.64)}
<g filter="url(#glowS)"><rect x="110" y="250" width="420" height="64" rx="32" fill="#06222a" stroke="#33e6ff" stroke-width="4"/>
<text id="t" x="322" y="296" text-anchor="middle" font-family="JBM" font-weight="700" font-size="40" letter-spacing="5" fill="#33e6ff">${caps ? n.toUpperCase() : n}</text></g></svg>`;
const css = `@font-face{font-family:JBM;src:url(JetBrainsMono.woff2)}html,body{margin:0;background:#000}svg{display:block}`;
(async () => {
  const b = await chromium.launch();
  for (const [id, n] of APPS) {
    fs.writeFileSync(path.join(__dirname, 'r.html'), `<style>${css}</style>${svg(n)}`);
    for (const [px, sc] of [[640, 1], [320, 0.5]]) {
      const p = await b.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: sc });
      await p.goto('file://' + path.join(__dirname, 'r.html')); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150);
      const w = await p.evaluate(() => document.getElementById('t').getComputedTextLength()); if (px == 640) console.log(id, Math.round(w));
      await p.screenshot({ path: path.join(res, px == 640 ? 'drawable-xhdpi' : 'drawable', 'banner.png') }); await p.close();
    }
  }
  fs.unlinkSync(path.join(__dirname, 'r.html')); await b.close();
})();
