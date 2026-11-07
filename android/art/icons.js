// shared SVG defs + three icon concepts (viewBox 0 0 512 512) and banners (0 0 320 180)
const defs = `<defs>
<radialGradient id="bg" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#241238"/><stop offset="1" stop-color="#0a0712"/></radialGradient>
<linearGradient id="liq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e535c8"/><stop offset="1" stop-color="#7b2ff0"/></linearGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="glowS" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;
const flask = (x,y,s,zColor='#f3eefe') => `<g transform="translate(${x},${y}) scale(${s})" filter="url(#glowS)">
 <path d="M-40 -60 V-160 Q-40 -172 -28 -172 H28 Q40 -172 40 -160 V-60 L130 95 Q145 125 110 125 H-110 Q-145 125 -130 95 Z" fill="none" stroke="#c86bff" stroke-width="18" stroke-linejoin="round"/>
 <path d="M-58 -20 L-118 90 Q-126 108 -104 108 H104 Q126 108 118 90 L58 -20 Z" fill="url(#liq)"/>
 <text x="0" y="96" text-anchor="middle" font-family="BigS" font-weight="800" font-size="190" fill="${zColor}">Z</text>
 <circle cx="-62" cy="40" r="10" fill="#fff" opacity=".7"/><circle cx="66" cy="70" r="7" fill="#fff" opacity=".7"/></g>`;
const flaskWave = (x,y,s) => `<g transform="translate(${x},${y}) scale(${s})" filter="url(#glowS)">
 <path d="M-40 -60 V-160 Q-40 -172 -28 -172 H28 Q40 -172 40 -160 V-60 L130 95 Q145 125 110 125 H-110 Q-145 125 -130 95 Z" fill="none" stroke="#c86bff" stroke-width="18" stroke-linejoin="round"/>
 <path d="M-66 -10 Q-50 -34 -33 -10 T0 -10 T33 -10 T66 -10 L118 90 Q126 108 104 108 H-104 Q-126 108 -118 90 Z" fill="url(#liq)"/>
 <text x="0" y="96" text-anchor="middle" font-family="BigS" font-weight="800" font-size="170" fill="#f3eefe">Z</text>
 <circle cx="-66" cy="50" r="10" fill="#fff" opacity=".7"/><circle cx="70" cy="74" r="7" fill="#fff" opacity=".7"/><circle cx="-10" cy="-120" r="8" fill="#fff" opacity=".5"/></g>`;
const brackets = (w,h,m,l,c='#c86bff',sw=8) => `<g stroke="${c}" stroke-width="${sw}" fill="none">
<path d="M${m} ${m+l} V${m} H${m+l}"/><path d="M${w-m-l} ${m} H${w-m} V${m+l}"/><path d="M${m} ${h-m-l} V${h-m} H${m+l}"/><path d="M${w-m-l} ${h-m} H${w-m} V${h-m-l}"/></g>`;
const wave = (x,y,w,amp) => { let d=`M${x} ${y}`; const n=24; for(let i=1;i<=n;i++){const px=x+w*i/n; const a=amp*Math.sin(i*1.3)*Math.sin(i/n*Math.PI); d+=` L${px.toFixed(1)} ${(y-Math.abs(a)).toFixed(1)} L${px.toFixed(1)} ${(y+Math.abs(a)).toFixed(1)} L${px.toFixed(1)} ${y}`;} return d; };

// ZRolesLabs app badge (the standard for every Labs launcher icon): cyan pill under the flask, same as Labs Browser "WEB".
// 78 tall, centred at (256,404) on the 512 canvas, width fits the label. blockbuZter uses the same colours in a ticket shape.
const badge = (cx,cy,w,h,label) => `<g filter="url(#glowS)"><rect x="${cx-w/2}" y="${cy-h/2}" width="${w}" height="${h}" rx="${h/2}" fill="#06222a" stroke="#33e6ff" stroke-width="5"/>
 <text x="${cx}" y="${cy+h*0.2}" text-anchor="middle" font-family="JBM" font-weight="700" font-size="${h*0.52}" letter-spacing="10" fill="#33e6ff">${label}</text></g>`;
const icons = {
 A: `<svg viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#bg)"/>
   ${brackets(512,512,70,60)}
   ${flask(256,262,1.05)}</svg>`,
 B: `<svg viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#bg)"/>
   <text x="236" y="330" text-anchor="middle" font-family="BigS" font-weight="800" font-size="250" fill="#f3eefe" filter="url(#glowS)">T8</text>
   <path d="${wave(126,375,220,34)}" stroke="#c86bff" stroke-width="6" fill="none" filter="url(#glowS)"/>
   ${flask(372,330,0.42)}</svg>`,
 C: `<svg viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#bg)"/>
   ${flaskWave(256,236,0.95)}${badge(256,404,300,78,'T8 HUD')}</svg>`
};
const banners = {
 A: `<svg viewBox="0 0 320 180">${defs}<rect width="320" height="180" fill="url(#bg)"/>${brackets(320,180,10,22,'#c86bff',3)}
   ${flask(78,98,0.42)}<text x="140" y="104" font-family="BigS" font-weight="800" font-size="70" fill="#f3eefe" filter="url(#glowS)">T8 HUD</text>
   <text x="142" y="134" font-family="JBM" font-size="13" letter-spacing="5" fill="#3fe0ff">ZROLESLABS</text></svg>`,
 B: `<svg viewBox="0 0 320 180">${defs}<rect width="320" height="180" fill="url(#bg)"/>
   <text x="34" y="112" font-family="BigS" font-weight="800" font-size="92" fill="#f3eefe" filter="url(#glowS)">T8 HUD</text>
   <path d="${wave(36,136,200,12)}" stroke="#c86bff" stroke-width="2.5" fill="none" filter="url(#glowS)"/>${flask(272,120,0.3)}</svg>`,
 C: `<svg viewBox="0 0 320 180">${defs}<rect width="320" height="180" fill="url(#bg)"/>
   ${flaskWave(80,100,0.42)}
   <text x="150" y="102" font-family="BigS" font-weight="800" font-size="68" fill="#f3eefe" filter="url(#glowS)">T8 HUD</text>
   <text x="152" y="130" font-family="JBM" font-size="12" letter-spacing="4" fill="#3fe0ff">ZROLESLABS</text></svg>`
};
module.exports = { icons, banners };
