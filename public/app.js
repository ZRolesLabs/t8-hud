'use strict';
// T8 HUD front end: listens to the bridge over Server-Sent Events and renders the HUD.

const PALETTES = {
  cyber: { name: 'Cyberpunk', vars: { '--ink': '#0c0714', '--ink-2': '#170e26', '--rule': '#2e2245', '--fg': '#f3eeff', '--fg-2': '#ab9fcc', '--fg-3': '#6e618d', '--ok': '#5cf2c5', '--warn': '#ff4f8b' },
           tier: { dsd: '#c86bff', hires: '#29e3ff', cd: '#ece6ff', lossy: '#82789c' } },
  amber: { name: 'Studio amber', vars: { '--ink': '#0a0c10', '--ink-2': '#12151c', '--rule': '#262b36', '--fg': '#ecebe6', '--fg-2': '#9aa0ab', '--fg-3': '#5f6674', '--ok': '#6fd3a0', '--warn': '#ff6b81' },
           tier: { dsd: '#f2a541', hires: '#4fd1e8', cd: '#e8e6df', lossy: '#9aa3b2' } },
  mono:  { name: 'Mono', vars: { '--ink': '#0b0b0b', '--ink-2': '#161616', '--rule': '#2b2b2b', '--fg': '#f2f2f2', '--fg-2': '#a3a3a3', '--fg-3': '#666666', '--ok': '#e0e0e0', '--warn': '#ff6b6b' },
           tier: { dsd: '#ffffff', hires: '#d6d6d6', cd: '#b4b4b4', lossy: '#858585' } },
};
// "Custom": the Cyberpunk base with one colour of your choosing for every format (set on /setup)
PALETTES.custom = { name: 'Custom', vars: { ...PALETTES.cyber.vars }, tier: { dsd: '#ff2bd6', hires: '#ff2bd6', cd: '#ff2bd6', lossy: '#ff2bd6' } };
function setCustom(hex) { if (/^#[0-9a-f]{6}$/i.test(hex || '')) for (const k of Object.keys(PALETTES.custom.tier)) PALETTES.custom.tier[k] = hex; }
const MODES = ['show', 'eng', 'night'];
const MODE_NAMES = { show: 'Showcase', eng: 'Engineering', night: 'Night' };

const $ = id => document.getElementById(id);
const stage = $('stage');
const store = {
  get(k, d) { try { return localStorage.getItem('t8hud-' + k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('t8hud-' + k, v); } catch {} },
};

let cfg = { chain: [], display: { palette: 'cyber', eqLabel: 'Room EQ', eqNote: '', nightAfterIdleMinutes: 10, showStats: false, showChain: false, showDac: false } };
let S = null;              // latest normalized state from the bridge
let recvAt = 0;            // when it arrived
// Playhead: a local clock that runs between T8 reports. Each report is jittery (poll timing, network, and the T8
// sometimes repeats a stale position), so small differences are blended in gently and the bar never steps
// backwards; only a real jump (seek, new track, pause/resume) snaps it.
const ph = { key: '', base: 0, at: 0, shown: 0, lastRaw: -1, playing: false };
function phNow(t) { return ph.playing ? ph.base + (t - ph.at) : ph.base; }
function phReport(st, t) {
  const key = st.track ? `${st.track.id}|${st.track.title}|${st.duration}` : '';
  const playing = st.state === 'playing', raw = st.position || 0;
  const pred = phNow(t), diff = raw - pred;
  if (key !== ph.key || playing !== ph.playing || Math.abs(diff) > 3000) {
    Object.assign(ph, { key, base: raw, at: t, shown: raw, lastRaw: raw, playing });   // real jump: snap
    return;
  }
  if (playing && raw === ph.lastRaw) return;                 // stale repeat from the T8: keep our own clock
  ph.lastRaw = raw;
  ph.base = pred + diff * 0.25; ph.at = t;                     // drift: ease a quarter of the way per report
}
let palKey = null, mode = 'show';
let lastPlayingAt = Date.now();
let artId = null;

// ---------- helpers ----------
function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`; }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function mmss(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function rateHTML(hz) {
  if (!hz) return '—';
  if (hz >= 1e6) return (hz / 1e6).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + '<small>MHz</small>';
  return (hz / 1000).toFixed(hz % 1000 ? 1 : 0) + '<small>kHz</small>';
}
function kbpsHTML(k) { if (!k) return '—'; return k >= 1000 ? (k / 1000).toFixed(2) + '<small>Mbps</small>' : Math.round(k) + '<small>kbps</small>'; }
function fmtHz(hz) { return hz >= 1e6 ? (hz / 1e6).toFixed(4).replace(/0+$/, '') + ' MHz' : (hz / 1000).toFixed(hz % 1000 ? 1 : 0) + ' kHz'; }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200); }
const accent = () => PALETTES[palKey].tier[S ? S.format.tier : 'dsd'];

// ---------- palette & mode ----------
function applyPalette() {
  const p = PALETTES[palKey] || PALETTES.cyber;
  const css = (k, v) => document.documentElement.style.setProperty(k, v);
  // every colour also goes out as an "r,g,b" triplet: older TV browsers have no color-mix(), so the CSS uses rgba(var(--x-rgb), a)
  const both = (k, hex) => { css(k, hex); css(k + '-rgb', rgbOf(hex)); };
  for (const [k, v] of Object.entries(p.vars)) both(k, v);
  const a = accent();
  both('--accent', a);
  both('--hw', p.tier.dsd); // hardware boxes keep the palette's signature colour
  document.documentElement.style.setProperty('--accent-soft', hexA(a, .13));
}
function applyMode() {
  stage.classList.toggle('eng', mode === 'eng');
  stage.classList.toggle('nightmode', mode === 'night' || autoNight());
}
function autoNight() {
  const mins = cfg.display.nightAfterIdleMinutes;
  return mins > 0 && (!S || S.state !== 'playing') && Date.now() - lastPlayingAt > mins * 60000;
}

// ---------- render ----------
function render() {
  if (!S) return;
  applyPalette();
  const f = S.format, t = S.track;
  stage.classList.toggle('is-idle', S.state === 'idle' || !t);
  // the Google TV app holds the screen on while this is true; paused or idle, the TV's own screensaver may start
  window.t8Busy = S.state === 'playing' || cfg.display.screensaverWhenIdle === false;
  // cover + telemetry only (the default): give the cover the room the chain and stats would use
  stage.classList.toggle('minimal', !cfg.display.showChain && !cfg.display.showStats && !cfg.display.showDac);
  $('idle-s').textContent = S.source.external ? `External input · ${S.source.label || ''}` : (S.device.name || '');

  $('devname').textContent = S.device.name || 'Eversolo';
  $('devmeta').textContent = [S.device.model, S.device.version && 'fw ' + S.device.version].filter(Boolean).join(' · ');
  $('src').textContent = PREVIEW ? 'PREVIEW · sample track, not your T8' : ['Source ' + (((cfg.sources || {})[S.source.label] || {}).name || S.source.label || '—'), S.source.input].filter(Boolean).join(' · ');
  if (!t) return;

  $('prov').textContent = t.provenance.join(' · ');
  $('title').textContent = t.title;
  $('title').classList.toggle('long', t.title.length > 28);
  $('artist').textContent = t.artist;
  $('album').textContent = t.album;

  const fam = f.family === 'dsd' ? f.codecLabel : f.family === 'lossy' ? f.codecLabel : 'PCM';
  // a value the T8 doesn't send: say so plainly instead of a bare dash
  const na = `<span class="na">N/A</span><span class="why">not reported${S.source.streaming && S.source.label ? ' by ' + esc(S.source.label) : ''}</span>`;
  $('badges').innerHTML = [
    ['Container', f.container ? esc(f.container) + (f.dlna && f.dlna.converted ? '<span class="why">converted by the DLNA sender</span>' : '') : na, false],
    ['Format', esc(fam), true],
    ['Sample rate', rateHTML(f.rateHz), true],
    ['Bit depth', f.bits ? f.bits + '<small>bit</small>' : '—', false],
    ['Channels', f.channels ? f.channels + '<small>ch</small>' : '—', false],
    ['Bitrate', f.kbps ? kbpsHTML(f.kbps) : na, false],
  ].map(([k, v, h]) => `<div class="badge${h ? ' hero' : ''}"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

  let ring = '';
  if (f.family === 'dsd' && f.dsdMultiple) ring = `<b>${f.codecLabel}</b> = ${f.dsdMultiple} × 44.1 kHz = <b>${fmtHz(f.rateHz)}</b> × 1 bit × ${f.channels || 2} ch = <b>${(f.rawKbps / 1000).toFixed(3)} Mbps</b>`;
  else if (f.family === 'lossy') ring = `<b>${esc(f.codecLabel)}</b> · perceptual codec${f.kbps ? ` · about ${(1411.2 / f.kbps).toFixed(1)}:1 smaller than CD` : ''}`;
  else if (f.rawKbps) ring = `<b>${fmtHz(f.rateHz)}</b> × ${f.bits} bit × ${f.channels} ch = <b>${(f.rawKbps / 1000).toFixed(3)} Mbps</b> raw${f.kbps && Math.abs(f.kbps - f.rawKbps) > 50 ? ` · ${esc(f.container)} ≈ ${(f.kbps / 1000).toFixed(2)} Mbps` : ''}`;
  $('ring').innerHTML = ring;

  const o = S.output;
  const chips = [];
  if (o.codec || o.interface) chips.push([`OUT ${esc(o.codec || '')}${o.interface ? ' → ' + esc(o.interface) : ''}`, 'on']);
  if (o.rateHz && f.rateHz) chips.push([o.matchesSource ? 'Output rate = source rate' : `Resampled to ${fmtHz(o.rateHz)}`, o.matchesSource ? 'on' : 'warn']);
  if (S.volume.display) chips.push([`Volume ${esc(S.volume.display)}${S.volume.locked ? ' · locked' : ''}`, S.volume.locked ? 'on' : '']);
  if (S.volume.mute) chips.push(['Muted', 'warn']);
  if (cfg.display.showEq !== false) chips.push([S.flags.eq ? esc(cfg.display.eqLabel || 'EQ') + ' on' + (cfg.display.eqNote ? ' · ' + esc(cfg.display.eqNote) : '') : 'EQ off', S.flags.eq ? 'on' : '']);
  chips.push([S.flags.dsp ? 'DSP on' : 'DSP off', S.flags.dsp ? 'on' : '']);
  if (S.flags.sub) chips.push(['Sub output on', 'on']);
  chips.push([S.flags.mqa ? 'MQA' : 'MQA off', '']);
  if (!S.source.streaming || S.flags.replayGain) chips.push([S.flags.replayGain ? 'ReplayGain ' + esc(S.flags.replayGain) : 'No ReplayGain tag', '']); // a file tag: says nothing about streams
  $('flags').innerHTML = chips.map(([c, k]) => `<span class="chip ${k}">${c}</span>`).join('');

  renderChain();
  renderDac();
  renderRaw();
  renderLyrics();
  fitLyrics();
  $('n-title').textContent = `${t.title} · ${t.artist}`;
  $('n-rate').textContent = f.family === 'dsd' ? `${f.codecLabel} · ${fmtHz(f.rateHz)}` : f.family === 'lossy' ? `${f.codecLabel} · ${Math.round(f.kbps)} kbps` : `${f.bits}-bit / ${fmtHz(f.rateHz)}`;
  loadArt();
}

function renderChain() {
  $('chain').hidden = !cfg.display.showChain;
  // every box: model on top, "brand type" underneath (both from the setup page)
  const two = (a, b) => [a, b].filter(Boolean).join(' ');
  const src = (cfg.sources || {})[S.source.label] || {};
  const dev = cfg.device || {};
  const box = (n, s, k) => ({ n, s, k });
  const main = [
    box(src.name || S.source.label || 'Source', src.note || (S.source.external ? 'external input' : 'library'), 'hw'),
    box(S.device.model || 'T8', two(dev.brand || 'Eversolo', dev.type || 'transport'), 'hw'),
    box(S.output.interface || 'Output', 'digital output', 'link'),
  ];
  // gear can branch off an earlier box (a sub fed from the DAC, a second amp...): those go on rows below
  const branches = new Map();
  const items = (cfg.chain || []).map(c => ({ ...box(c.model || c.name || '', (c.brand || c.type) ? two(c.brand, c.type) : (c.note || ''), c.kind === 'link' ? 'link' : 'hw'), from: (c.from || '').trim() }));
  for (const it of items) {
    const key = it.from.toLowerCase();
    if (key && main.some(m => m.n.toLowerCase() === key)) { if (!branches.has(key)) branches.set(key, []); branches.get(key).push(it); }
    else main.push(it);
  }
  main.forEach((m, i) => { m.col = i + 1; m.row = 1; });
  let cols = main.length, row = 1;
  for (const [key, list] of branches) {
    const parent = main.find(m => m.n.toLowerCase() === key);
    row++;
    list.forEach((it, i) => { it.col = parent.col + 1 + i; it.row = row; it.parent = parent.col; });
    cols = Math.max(cols, parent.col + list.length);
  }
  const nodes = [...main, ...[...branches.values()].flat()];
  const chain = $('chain');
  const sig = JSON.stringify(nodes);
  if (chain.dataset.sig === sig) return;
  chain.dataset.sig = sig;
  chain.style.setProperty('--n', cols);
  chain.classList.toggle('split', row > 1);
  chain.querySelectorAll('.node').forEach(n => n.remove());
  for (const it of nodes) {
    const d = document.createElement('div');
    d.className = 'node' + (it.k ? ' ' + it.k : '') + (it.row > 1 ? ' br' : '');
    d.style.gridColumn = it.col; d.style.gridRow = it.row;
    d.dataset.row = it.row; d.dataset.col = it.col; if (it.parent) d.dataset.parent = it.parent;
    d.innerHTML = `<span class="n">${esc(it.n)}</span><span class="s">${esc(it.s)}</span>`;
    chain.appendChild(d);
  }
  chainGeo = null;
}

// where the boxes sit, for drawing the signal lines (recomputed when the chain or the screen size changes)
let chainGeo = null;
function chainGeometry(cv) {
  const cr = cv.getBoundingClientRect();
  const pts = [...$('chain').querySelectorAll('.node')].map(el => {
    const b = el.querySelector('.n').getBoundingClientRect();
    return { x: b.left + b.width / 2 - cr.left, y: b.top + b.height / 2 - cr.top, h: b.height, row: +el.dataset.row, col: +el.dataset.col, parent: +el.dataset.parent || 0 };
  });
  const main = pts.filter(p => p.row === 1).sort((a, b) => a.col - b.col);
  if (!main.length) return null;
  const paths = [[{ x: main[0].x, y: main[0].y }, { x: main[main.length - 1].x, y: main[0].y }]];
  const rows = [...new Set(pts.filter(p => p.row > 1).map(p => p.row))];
  for (const r of rows) {
    const br = pts.filter(p => p.row === r).sort((a, b) => a.col - b.col);
    const par = main.find(m => m.col === br[0].parent);
    if (par) paths.push([{ x: par.x, y: par.y }, { x: par.x, y: br[0].y }, { x: br[br.length - 1].x, y: br[0].y }]);
  }
  return { paths, R: main[0].h * 0.75 };
}

// DAC window: fixed settings typed in on /setup (most DACs, like the Z10, have no network API to ask)
function renderDac() {
  const w = cfg.dacWindow || {}, items = (w.items || []).filter(i => i.label || i.value);
  const box = $('dac');
  box.hidden = !cfg.display.showDac || !items.length;
  if (box.hidden) return;
  const html = `<div class="hd"><span class="ttl">${esc(w.title || 'DAC')}</span><span class="tag">your settings · set in /setup</span></div>` +
    `<div class="items">${items.map(i => `<div class="it"><span class="k">${esc(i.label)}</span><span class="v">${esc(i.value || '—')}</span></div>`).join('')}</div>`;
  if (box.innerHTML !== html) box.innerHTML = html;
}

// ---------- lyrics ----------
// The bridge (or the TV app) looks the words up and sends them once per track; the page only draws them.
// Synced lyrics follow the playhead line by line. Lyrics without timing are shown as plain text that rolls
// with the track and says "not timed". No lyrics for the track: one small line says so (see lyricsNote).
let LY = null;   // { track: { title, artist, duration }, kind: 'synced' | 'plain' | ..., source, lines: [{ t, text }] }
const ly = { sig: '', note: '', kind: '', rows: [], idx: -2, y: null, checked: 0 };
const LY_SOURCE = { t8: 'from the T8', lrclib: 'LRCLIB', sample: 'sample lines' };
const LY_GAP_MS = 7000; // a pause this long gets the dots; shorter ones just hold the last line
const sameSec = (a, b) => Math.round((a || 0) / 1000) === Math.round((b || 0) / 1000);
function lyricsNow() {
  if (cfg.display.showLyrics !== true || !S || !S.track || !LY || !LY.track || !LY.lines || !LY.lines.length) return null;
  if (LY.kind !== 'synced' && LY.kind !== 'plain') return null;
  return LY.track.title === S.track.title && LY.track.artist === S.track.artist && sameSec(LY.track.duration, S.duration) ? LY : null;
}
// Lyrics are switched on and there are no words to show: one quiet line says why, so a track without
// lyrics doesn't look like the HUD is broken.
const LY_NOTE = { looking: 'looking for the words…', instrumental: 'instrumental', none: 'none found for this track', offline: 'none on the T8 · online lookup is off' };
function lyricsNote() {
  if (cfg.display.showLyrics !== true || !S || !S.track || !S.track.title) return '';
  const mine = LY && LY.track && LY.track.title === S.track.title && LY.track.artist === S.track.artist && sameSec(LY.track.duration, S.duration);
  // (a stream's length turns up a few seconds into the track: until then it is still being looked up)
  if (!mine || (!(S.duration > 0) && (S.position || 0) < 15000)) return 'looking';
  if (LY.kind === 'instrumental') return 'instrumental';
  return LY.source === 'sample' || cfg.display.lyricsOnline === true ? 'none' : 'offline';
}
function renderLyrics() {
  const L = lyricsNow();
  const note = L ? '' : lyricsNote();
  const sig = L ? [L.kind, L.source, L.track.title, L.track.artist, Math.round(L.track.duration / 1000), L.lines.length].join('|') : '';
  if (sig === ly.sig && note === ly.note) return;
  Object.assign(ly, { sig, note, kind: L ? L.kind : '', rows: [], idx: -2, y: null });
  $('lyrics').hidden = !L && !note;
  $('lyrics').classList.toggle('ly-note', !L && !!note);
  stage.classList.toggle('has-lyrics', !!L);
  if (!L) { $('lyroll').innerHTML = ''; $('lyk').innerHTML = note ? `Lyrics · <b>${esc(LY_NOTE[note])}</b>` : ''; return; }
  const end = S.duration || 0;
  if (L.kind === 'synced') {
    const lines = L.lines;
    if (lines[0].t >= LY_GAP_MS) ly.rows.push({ t: 0, gap: true });
    lines.forEach((l, i) => {
      if (l.text) ly.rows.push({ t: l.t, text: l.text });
      else if ((lines[i + 1] ? lines[i + 1].t : end) - l.t >= LY_GAP_MS) ly.rows.push({ t: l.t, gap: true });
    });
    ly.rows.forEach((r, i) => { r.end = ly.rows[i + 1] ? ly.rows[i + 1].t : Math.max(end, r.t); });
  } else ly.rows = L.lines.map(l => ({ text: l.text }));
  $('lyk').innerHTML = `Lyrics · <b>${esc(LY_SOURCE[L.source] || L.source || '')}</b>${L.kind === 'plain' ? ' · not timed' : ''}`;
  $('lywin').classList.toggle('plain', L.kind === 'plain');
  $('lyroll').style.transform = '';
  $('lyroll').innerHTML = ly.rows.map(r => r.gap ? '<div class="ly-line gap"><i></i><i></i><i></i></div>' : `<div class="ly-line">${esc(r.text)}</div>`).join('');
}
// A long title in extra-large lettering can leave too little room for three lines: then only the line being
// sung is shown, so the telemetry never gets pushed off the screen.
let lyFitSig = '';
function fitLyrics() {
  const sig = ly.sig && [ly.sig, $('title').textContent, stage.dataset.font, stage.dataset.tsize, stage.className.replace(/\s*ly-compact/, ''), stage.clientWidth, $('flags').childElementCount].join('|');
  if (sig === lyFitSig) return;
  lyFitSig = sig;
  stage.classList.remove('ly-compact');
  if (!sig) return;
  const main = document.querySelector('.main'), info = document.querySelector('.info');
  if (info.offsetHeight > main.clientHeight + 1) stage.classList.add('ly-compact');
  ly.checked = 0; // re-centre the line in its new window
}
// called every frame with the playhead (ms)
function lyricsFrame(pos, now) {
  if (!ly.sig) return;
  const win = $('lywin'), roll = $('lyroll'), els = roll.children;
  if (!els.length) return;
  const put = y => { y = Math.round(y * 10) / 10; if (y !== ly.y) { ly.y = y; roll.style.transform = `translateY(${-y}px)`; } };
  if (ly.kind === 'plain') {
    // no timing to go on: roll through the words over the length of the track
    const q = Math.max(0, Math.min(1, ((S.duration ? pos / S.duration : 0) - 0.03) / 0.9));
    put(Math.max(0, roll.offsetHeight - win.clientHeight) * q - win.clientHeight * 0.24 * (1 - q) + win.clientHeight * 0.24 * q);
    return;
  }
  const at = pos + 250 + (Number(cfg.display.lyricsOffsetMs) || 0); // a touch early: eyes read ahead of ears
  let idx = -1;
  for (let lo = 0, hi = ly.rows.length - 1; lo <= hi;) { const mid = (lo + hi) >> 1; if (ly.rows[mid].t <= at) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  const moved = idx !== ly.idx;
  if (moved) {
    ly.idx = idx;
    for (let i = 0; i < els.length; i++) { els[i].classList.toggle('on', i === idx); els[i].classList.toggle('past', i < idx); }
  }
  // keep the line being sung in the middle (re-measured now and then: fonts load late and screens resize)
  if (moved || now - ly.checked > 1000) {
    ly.checked = now;
    const el = els[Math.max(0, idx)];
    put(el.offsetTop + el.offsetHeight / 2 - win.clientHeight / 2);
  }
  const row = ly.rows[idx];
  if (row && row.gap) {
    const f = row.end > row.t ? (at - row.t) / (row.end - row.t) : 1;
    const dots = els[idx].children;
    for (let i = 0; i < dots.length; i++) dots[i].style.opacity = Math.max(0.18, Math.min(1, f * dots.length - i)).toFixed(2);
  }
}

function renderRaw() {
  if (mode !== 'eng') return;
  $('rawdl').innerHTML = Object.entries(S.raw).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

function renderStats(st) {
  if (!cfg.display.showStats) { $('stats').innerHTML = ''; return; }
  const h = Math.floor(st.todaySec / 3600), m = Math.floor(st.todaySec % 3600 / 60);
  $('stats').innerHTML = [
    ['Listening today', h ? `${h}h ${m}m` : `${m}m`],
    ['Time in DSD', Math.round(st.dsdShare * 100) + '%'],
    ['Hi-res or better', Math.round(st.hiresShare * 100) + '%'],
    ['Best PCM today', st.bestPcm ? `${st.bestPcm.bits ? st.bestPcm.bits + '/' : ''}${+(st.bestPcm.rateHz / 1000).toFixed(1)}` : '—'],
    ['Album of the week', st.albumOfWeek || '—'],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('');
}

// ---------- cover art + colour backdrop ----------
function loadArt() {
  const img = $('art');
  const id = S.art;
  if (id === artId) return;
  artId = id;
  img.classList.remove('ready');
  $('artempty').hidden = true;
  if (!id) { $('artempty').hidden = false; paintBackdrop(null); return; }
  const next = new Image();
  next.onload = () => { img.src = next.src; img.classList.add('ready'); paintBackdrop(next); };
  next.onerror = () => { $('artempty').hidden = false; paintBackdrop(null); };
  next.src = id;
}
function paintBackdrop(img) {
  const c = $('bg'), g = c.getContext('2d');
  g.fillStyle = PALETTES[palKey].vars['--ink']; g.fillRect(0, 0, c.width, c.height);
  if (img) g.drawImage(img, 0, 0, c.width, c.height);
  else { g.fillStyle = hexA(accent(), .35); g.beginPath(); g.arc(c.width * .3, c.height * .4, c.height * .5, 0, 7); g.fill(); }
}

// ---------- animation loop: playhead and chain pulse (no fake meters: everything shown is real) ----------
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let pulseX = 0, lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(100, now - lastFrame); lastFrame = now;
  if (S && S.track) {
    let pos = Math.max(0, Math.min(S.duration || 0, phNow(Date.now())));
    if (ph.playing) pos = ph.shown = Math.max(ph.shown, pos);  // never step backwards while playing
    else ph.shown = pos;
    $('pos').textContent = mmss(pos);
    $('dur').textContent = '-' + mmss(S.duration - pos);
    $('bar').style.transform = `scaleX(${S.duration ? pos / S.duration : 0})`;
    if (S.format.fileMB && S.duration) $('moved').innerHTML = `<b>≈${(S.format.fileMB * pos / S.duration).toFixed(1)} MB</b> of ${S.format.fileMB.toFixed(1)} MB played`;
    else $('moved').textContent = '';
    lyricsFrame(pos, now);
    const playing = S.state === 'playing' && !reduce;
    drawPulse(playing ? dt : 0);
  }
  requestAnimationFrame(frame);
}
function drawPulse(dt) {
  const cv = $('pulse'), r = cv.getBoundingClientRect();
  if (cv.width !== Math.round(r.width) || cv.height !== Math.round(r.height)) { cv.width = Math.round(r.width); cv.height = Math.round(r.height); chainGeo = null; }
  if (!chainGeo) chainGeo = chainGeometry(cv);
  const g = cv.getContext('2d'), a = accent();
  g.clearRect(0, 0, cv.width, cv.height);
  if (!chainGeo) return;
  const { paths, R } = chainGeo;
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = Math.max(1, R * 0.08); g.lineJoin = 'round';
  for (const p of paths) { g.beginPath(); g.moveTo(p[0].x, p[0].y); for (const q of p.slice(1)) g.lineTo(q.x, q.y); g.stroke(); }
  const d = cfg.display, SPEED = { slow: 0.5, normal: 1, fast: 2 }, SIZE = { small: 0.6, medium: 1, large: 1.5 };
  // more bits, faster flow; the speed setting only scales it, so a DSD file still outruns an MP3
  const speed = (0.06 + Math.log10(Math.max(64, S.format.kbps || 320)) * 0.07) * (SPEED[d.beadSpeed] || 1);
  pulseX = (pulseX + dt * speed / 1000) % 1;
  const along = (p, t) => { // point at fraction t along a polyline
    const segs = p.slice(1).map((q, i) => Math.hypot(q.x - p[i].x, q.y - p[i].y));
    let d = t * segs.reduce((x, y) => x + y, 0);
    for (let i = 0; i < segs.length; i++) { if (d <= segs[i] || i === segs.length - 1) { const f = segs[i] ? Math.min(1, d / segs[i]) : 0; return { x: p[i].x + (p[i + 1].x - p[i].x) * f, y: p[i].y + (p[i + 1].y - p[i].y) * f }; } d -= segs[i]; }
  };
  if (d.animatePath === false) return; // static lines only
  const pal = PALETTES[palKey] || PALETTES.cyber;
  const col = d.beadColor === 'hardware' ? pal.tier.dsd : d.beadColor === 'white' ? '#ffffff' : a; // default: the format colour
  const BR = R * (SIZE[d.beadSize] || 1);
  const bead = (p, t) => {
    const { x, y } = along(p, t), q = along(p, Math.min(1, t + 0.002)), ang = Math.atan2(q.y - y, q.x - x) || 0;
    const shape = d.beadShape || 'glow';
    if (shape === 'glow') { const gr = g.createRadialGradient(x, y, 0, x, y, BR); gr.addColorStop(0, hexA(col, .95)); gr.addColorStop(1, hexA(col, 0)); g.fillStyle = gr; g.fillRect(x - BR, y - BR, BR * 2, BR * 2); return; }
    g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = col; g.shadowColor = hexA(col, .8); g.shadowBlur = BR * .5; g.beginPath();
    if (shape === 'dot') g.arc(0, 0, BR * .32, 0, 7);
    else if (shape === 'diamond') { const r = BR * .42; g.moveTo(r, 0); g.lineTo(0, r * .7); g.lineTo(-r, 0); g.lineTo(0, -r * .7); g.closePath(); }
    else { const w = BR * 1.1, h = BR * .2; g.rect(-w / 2, -h / 2, w, h); } // dash
    g.fill(); g.restore();
  };
  for (let k = 0; k < 3; k++) bead(paths[0], (pulseX + k / 3) % 1);
  for (const p of paths.slice(1)) bead(p, (pulseX * 1.7) % 1);
}

// ---------- live connection ----------
let pageBuild = null, lastStats = null, es = null, lastMsg = Date.now();
// /?preview=<settings>: a sample track drawn with settings from the setup page, clearly labelled
const PREVIEW = (() => { try { const q = new URLSearchParams(location.search).get('preview'); return q ? JSON.parse(q) : null; } catch { return null; } })();
function connect() {
  if (es) es.close();
  lastMsg = Date.now();
  es = new EventSource(PREVIEW ? '/events?preview=1' : '/events');
  // any event, including the bridge's heartbeat, proves the connection is alive
  for (const ev of ['config', 'state', 'stats', 'lyrics', 'link', 'hb']) es.addEventListener(ev, () => { lastMsg = Date.now(); });
  es.addEventListener('config', e => {
    cfg = JSON.parse(e.data);
    if (PREVIEW) { cfg.display = { ...cfg.display, ...PREVIEW }; store.set = () => {}; }
    // the bridge was updated: reload so the TV runs the new page
    if (pageBuild && cfg.build && cfg.build !== pageBuild) { location.reload(); return; }
    pageBuild = cfg.build;
    setCustom(cfg.display.customColor);
    $('clock').hidden = cfg.display.showClock === false;
    $('sig').hidden = cfg.display.showFlask !== true; // maker's mark, off unless switched on in /setup
    // track text: font style and artist/album size, both from the setup page
    stage.dataset.font = ['modern', 'serif', 'terminal'].includes(cfg.display.font) ? cfg.display.font : 'classic';
    stage.dataset.tsize = ['large', 'xlarge'].includes(cfg.display.textSize) ? cfg.display.textSize : 'standard';
    // the palette always comes from the setup page
    if (cfg.display.palette in PALETTES) palKey = cfg.display.palette;
    if (!palKey) palKey = 'cyber';
    $('chain').dataset.sig = '';
    applyPalette(); // also before the first track, so the waiting screen has the right colours
    render();
    if (lastStats) renderStats(lastStats);
  });
  es.addEventListener('state', e => {
    S = JSON.parse(e.data); recvAt = Date.now(); phReport(S, recvAt);
    if (S.state === 'playing') lastPlayingAt = Date.now();
    render(); applyMode();
  });
  es.addEventListener('stats', e => renderStats(lastStats = JSON.parse(e.data)));
  es.addEventListener('lyrics', e => { LY = JSON.parse(e.data); if (S) { renderLyrics(); fitLyrics(); } });
  es.addEventListener('link', e => {
    const l = JSON.parse(e.data);
    $('offline').hidden = l.connected; $('dot').classList.toggle('on', l.connected);
  });
  es.onerror = () => {
    $('offline').hidden = false; $('dot').classList.remove('on');
    if (es.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
  };
}
// watchdog: if the bridge goes quiet (rebooted, Wi-Fi blip, TV browser napping), drop the dead
// connection and dial again instead of freezing on the last track
setInterval(() => {
  if (Date.now() - lastMsg > 25000) { $('offline').hidden = false; $('dot').classList.remove('on'); connect(); }
}, 5000);

// ---------- settings ----------
// No remote-control shortcuts: TV browsers (TV Bro etc.) each handle keys differently, so every
// setting lives on the setup page instead.

// ---------- clock, night drift, burn-in shift ----------
function tick() { const d = new Date(); $('clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); applyMode(); }
function drift() { const d = $('drift'); d.style.left = (8 + Math.random() * 55) + '%'; d.style.top = (10 + Math.random() * 65) + '%'; }
function shift() { $('hud').style.transform = `translate(${(Math.random() * 2 - 1) * 0.25}cqw, ${(Math.random() * 2 - 1) * 0.25}cqw)`; }

palKey = 'cyber';
applyPalette(); applyMode(); tick(); drift();
setInterval(tick, 10000);
// once a day, while nothing is playing, reload: some TV browsers get sluggish when a page stays open for days
const pageStart = Date.now();
setInterval(() => { if (Date.now() - pageStart > 864e5 && (!S || S.state !== 'playing')) location.reload(); }, 600000); setInterval(drift, 15000); setInterval(shift, 180000);
connect();
requestAnimationFrame(frame);

// hide the mouse pointer after 3 s without movement (TVs never show it, PCs get it back on move)
(function cursor() {
  let t = null;
  const hide = () => document.body.classList.add('nocursor');
  addEventListener('mousemove', () => { document.body.classList.remove('nocursor'); clearTimeout(t); t = setTimeout(hide, 3000); }, { passive: true });
  hide();
})();
