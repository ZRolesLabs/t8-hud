'use strict';
// T8 HUD bridge: polls the Eversolo T8 on your LAN, pushes clean updates to the TV page
// over Server-Sent Events, and proxies cover art. No dependencies, no cloud. Node 18+.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { normalize } = require('./lib/normalize');
const stats = require('./lib/stats');

// ---------- config ----------
const ROOT = __dirname;
function loadConfig() {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  const file = path.join(ROOT, 'config.json');
  const user = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const cfg = { ...base, ...user, display: { ...base.display, ...(user.display || {}) } };
  if (process.env.T8_HOST) cfg.t8Host = process.env.T8_HOST;
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.argv.includes('--demo')) cfg.t8Host = 'demo';
  // Release 1 ships cover + telemetry only. The signal chain, DAC window and listening stats stay in
  // the code for a later release; set "labs": true in config.json by hand to try them.
  cfg.labs = cfg.labs === true;
  if (!cfg.labs) Object.assign(cfg.display, { showChain: false, showStats: false, showDac: false });
  if (!/^#[0-9a-f]{6}$/i.test(cfg.display.customColor || '')) cfg.display.customColor = '#ff2bd6';
  return cfg;
}
let cfg = loadConfig();
const DEMO = cfg.t8Host === 'demo';
const T8_PORT = cfg.t8Port || 9529;
let t8Host = cfg.t8Host;

// ---------- T8 access ----------
// Plain http.get with a fresh connection each time and minimal headers: the T8's small
// embedded server can stall on Node's fetch (keep-alive and extra headers).
function t8Get(pathAndQuery, timeoutMs = cfg.timeoutMs || 6000, host = t8Host) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${host}:${T8_PORT}${pathAndQuery}`, { agent: false, headers: { Connection: 'close', Accept: '*/*' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const body = Buffer.concat(chunks);
        resolve({ buffer: body, json: () => JSON.parse(body.toString('utf8')) });
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error(`no answer within ${timeoutMs / 1000}s`), { name: 'AbortError' })));
    req.on('error', reject);
  });
}

// ---------- auto-discovery: if the T8 goes missing (new DHCP lease), sweep the LAN for it ----------
function lanPrefixes() {
  const out = new Set();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(cfg.t8Host || '')) out.add(cfg.t8Host.split('.').slice(0, 3).join('.'));
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && /^(10|172|192)\./.test(a.address)) out.add(a.address.split('.').slice(0, 3).join('.'));
  }
  return [...out];
}
function portOpen(host, port, ms = 900) {
  return new Promise(resolve => {
    const s = net.connect({ host, port });
    const done = ok => { s.destroy(); resolve(ok); };
    s.setTimeout(ms, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}
// every T8 answering on the LAN (used by the setup page's "Find my T8" button)
async function scanLan() {
  const found = [];
  for (const prefix of lanPrefixes()) {
    const hosts = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
    const open = (await Promise.all(hosts.map(async h => (await portOpen(h, T8_PORT)) ? h : null))).filter(Boolean);
    for (const h of open) {
      try {
        const st = (await t8Get('/ZidooMusicControl/v2/getState', 3000, h)).json();
        if (st && (st.deviceInfo || st.playingMusic || 'state' in st)) found.push({ host: h, name: (st.deviceInfo && st.deviceInfo.deviceName) || '', model: (st.deviceInfo && st.deviceInfo.model) || '' });
      } catch {}
    }
  }
  return found;
}
let lastScan = 0, failures = 0;
async function discover() {
  if (DEMO || cfg.autoDiscover === false || Date.now() - lastScan < 60000) return;
  lastScan = Date.now();
  for (const prefix of lanPrefixes()) {
    const hosts = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
    const open = (await Promise.all(hosts.map(async h => (await portOpen(h, T8_PORT)) ? h : null))).filter(Boolean);
    for (const h of open) {
      try {
        const st = (await t8Get('/ZidooMusicControl/v2/getState', 3000, h)).json();
        if (st && (st.deviceInfo || st.playingMusic || 'state' in st)) {
          if (h !== t8Host) {
            console.log(`[t8] found the T8 at its new address ${h} (was ${t8Host}); saved to config.json`);
            t8Host = h; saveHost(h);
          }
          return;
        }
      } catch {}
    }
  }
  console.warn('[t8] sweep found no T8 on the network. Is it asleep? Retrying.');
}
function saveHost(h) {
  try { writeUserConfig({ t8Host: h }); } catch (e) { console.warn('[t8] could not save the new address:', e.message); }
}
function writeUserConfig(patch) {
  const file = path.join(ROOT, 'config.json');
  const user = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  Object.assign(user, patch);
  fs.writeFileSync(file, JSON.stringify(user, null, 2) + '\n');
}

// ---------- settings from the setup page: validated, saved to config.json, pushed to every screen ----------
const PALETTE_KEYS = ['cyber', 'amber', 'mono', 'custom'];
const str = (v, max = 40) => typeof v === 'string' ? v.trim().slice(0, max) : '';
function cleanSettings(b) {
  if (!b || typeof b !== 'object') throw new Error('bad request');
  const out = {};
  if ('t8Host' in b && !DEMO && b.t8Host !== 'demo') { // demo mode never overwrites your T8's address
    const h = str(b.t8Host, 64);
    if (!/^[\w.-]+$/.test(h)) throw new Error('That T8 address does not look right');
    out.t8Host = h;
  }
  if ('chain' in b) {
    if (!Array.isArray(b.chain)) throw new Error('bad chain');
    out.chain = b.chain.slice(0, 16).map(c => ({ ...(c && c.kind === 'link' ? { kind: 'link' } : {}), ...(c && str(c.from) ? { from: str(c.from) } : {}), model: str(c && c.model), brand: str(c && c.brand), type: str(c && (c.type || c.role)) })).filter(c => c.model || c.brand || c.type);
  }
  if ('sources' in b) {
    if (!b.sources || typeof b.sources !== 'object') throw new Error('bad sources');
    out.sources = {};
    for (const [k, v] of Object.entries(b.sources).slice(0, 30)) {
      const key = str(k, 40); if (!key) continue;
      const name = str(v && v.name), note = str(v && v.note);
      if (name || note) out.sources[key] = { name, note };
    }
  }
  if ('dacWindow' in b) {
    const w = b.dacWindow || {};
    if (typeof w !== 'object' || (w.items && !Array.isArray(w.items))) throw new Error('bad DAC window');
    out.dacWindow = { title: str(w.title), items: (w.items || []).slice(0, 8).map(i => ({ label: str(i && i.label, 24), value: str(i && i.value) })).filter(i => i.label || i.value) };
  }
  if ('device' in b) out.device = { brand: str(b.device && b.device.brand), type: str(b.device && (b.device.type || b.device.role)) };
  if ('display' in b) {
    const d = b.display || {};
    out.display = { ...cfg.display };
    if (PALETTE_KEYS.includes(d.palette)) out.display.palette = d.palette;
    if ('eqLabel' in d) out.display.eqLabel = str(d.eqLabel);
    if ('eqNote' in d) out.display.eqNote = str(d.eqNote);
    if ('showEq' in d) out.display.showEq = !!d.showEq;
    if ('showClock' in d) out.display.showClock = !!d.showClock;
    if ('showFlask' in d) out.display.showFlask = !!d.showFlask;
    if ('customColor' in d && /^#[0-9a-f]{6}$/i.test(d.customColor)) out.display.customColor = d.customColor.toLowerCase();
    if ('nightAfterIdleMinutes' in d) out.display.nightAfterIdleMinutes = Math.max(0, Math.min(600, Math.round(Number(d.nightAfterIdleMinutes) || 0)));
    if (cfg.labs) {
      if ('showStats' in d) out.display.showStats = !!d.showStats;
      if ('showChain' in d) out.display.showChain = !!d.showChain;
      if ('showDac' in d) out.display.showDac = !!d.showDac;
    }
    if ('animatePath' in d) out.display.animatePath = !!d.animatePath;
    const pick = (k, ok) => { if (k in d) out.display[k] = ok.includes(d[k]) ? d[k] : ok[0]; };
    pick('font', ['classic', 'modern', 'serif', 'terminal']);
    pick('textSize', ['standard', 'large', 'xlarge']);
    pick('beadShape', ['glow', 'dot', 'diamond', 'dash']);
    pick('beadColor', ['format', 'hardware', 'white']);
    pick('beadSize', ['medium', 'small', 'large']);
    pick('beadSpeed', ['normal', 'slow', 'fast']);
  }
  return out;
}
function applySettings(clean) {
  writeUserConfig(clean);
  cfg = loadConfig();
  if (clean.t8Host && clean.t8Host !== t8Host) { t8Host = clean.t8Host; failures = 0; console.log(`[t8] address changed on the setup page: now polling ${t8Host}`); }
  broadcast('config', publicConfig());
}
// the setup page only accepts changes from your own network, sent by the setup page itself
function isLan(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '');
  return a === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a) || /^f[cd]/i.test(a);
}
function sameOrigin(req) {
  const o = req.headers.origin; if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}
function readBody(req, max = 65536) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad JSON')); } });
    req.on('error', reject);
  });
}
// sources the T8 has reported, remembered in config.json so the setup page lists them after a restart
const seenSources = new Set(Array.isArray(cfg.seenSources) ? cfg.seenSources.filter(s => typeof s === 'string').slice(0, 50) : []);
function noteSource(label) {
  if (!label || seenSources.has(label) || DEMO) return;
  seenSources.add(label);
  try { writeUserConfig({ seenSources: [...seenSources].slice(-50) }); } catch (e) { console.warn('[t8] could not save the source list:', e.message); }
}

// demo mode replays a captured payload with a moving playhead
const demoRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples', 'getState-dsd64-deacon-blues.json'), 'utf8'));
const demoStart = Date.now() - demoRaw.position;
function demoState() {
  const raw = JSON.parse(JSON.stringify(demoRaw));
  raw.position = (Date.now() - demoStart) % raw.duration;
  return raw;
}

// ---------- live state ----------
let current = null;          // last normalized state
let lastRaw = null;          // last getState exactly as the T8 sent it (for /api/raw)
let link = { connected: false, error: null, since: Date.now() };
const clients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

async function poll() {
  try {
    const raw = DEMO ? demoState() : (await t8Get('/ZidooMusicControl/v2/getState')).json();
    lastRaw = raw;
    current = normalize(raw);
    rememberArt(current);
    if (current.source && current.source.label) noteSource(current.source.label);
    failures = 0;
    if (!link.connected) {
      link = { connected: true, error: null, since: Date.now() };
      broadcast('link', link);
      console.log(`[t8] connected to ${DEMO ? 'demo' : t8Host}: ${current.track ? `${current.track.artist} - ${current.track.title} (${current.format.codecLabel})` : current.state}`);
    }
    if (!DEMO && cfg.labs) stats.record(current); // a replayed demo is not real listening; stats are a labs extra
    broadcast('state', current);
  } catch (err) {
    if (link.connected || link.error !== String(err.message)) {
      link = { connected: false, error: String(err.message), since: Date.now() };
      broadcast('link', link);
      const why = err.name === 'AbortError' || /aborted/i.test(err.message) ? `no answer within ${(cfg.timeoutMs || 6000) / 1000}s` : err.message;
      console.warn(`[t8] ${t8Host} unreachable: ${why} (retrying every ${(cfg.pollMs || 1000) / 1000}s)`);
    }
    if (++failures >= 3) await discover();
  } finally {
    setTimeout(poll, cfg.pollMs || 1000);
  }
}

// ---------- cover art proxy (the T8 sends no CORS headers and no content type) ----------
// The page asks for /art/<key>; the key maps to an art reference seen in a real getState (a library
// track id, a path on the T8, or the stream's own cover URL), so the bridge never fetches anything
// the T8 didn't point at.
const artCache = new Map(); // key -> Buffer, small LRU
const artRefs = new Map();  // key -> { kind, value }
function rememberArt(state) {
  if (!state || !state.art || !state.artRef) return;
  const key = state.art.slice(5);
  artRefs.delete(key); artRefs.set(key, state.artRef);
  if (artRefs.size > 60) artRefs.delete(artRefs.keys().next().value);
}
function fetchUrl(u, timeoutMs = 8000, hops = 3) {
  return new Promise((resolve, reject) => {
    const mod = u.startsWith('https:') ? require('https') : http;
    const req = mod.get(u, { headers: { Accept: 'image/*', 'User-Agent': 't8-hud' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) { res.resume(); return resolve(fetchUrl(new URL(res.headers.location, u).href, timeoutMs, hops - 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = []; let n = 0;
      res.on('data', c => { n += c.length; if (n > 15e6) req.destroy(new Error('image too large')); else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function getArt(key) {
  if (artCache.has(key)) { const b = artCache.get(key); artCache.delete(key); artCache.set(key, b); return b; }
  let buf = null;
  if (DEMO) buf = fs.existsSync(path.join(ROOT, 'samples', 'demo-cover.jpg')) ? fs.readFileSync(path.join(ROOT, 'samples', 'demo-cover.jpg')) : null;
  else {
    const ref = artRefs.get(key) || (/^[\w-]{1,32}$/.test(key) && !key.startsWith('x') ? { kind: 'id', value: key } : null);
    if (!ref) return null;
    if (ref.kind === 'id') buf = (await t8Get(`/ZidooMusicControl/v2/getImage?id=${encodeURIComponent(ref.value)}&musicType=0&type=0&target=16`, 8000)).buffer;
    else if (ref.kind === 'path') buf = (await t8Get(ref.value, 8000)).buffer;
    else if (ref.kind === 'url') buf = await fetchUrl(ref.value);
  }
  if (!buf || !isImage(buf)) return null; // the T8 answers {"status":806} as JSON when there is no art
  artCache.set(key, buf);
  if (artCache.size > 30) artCache.delete(artCache.keys().next().value);
  return buf;
}
function imageType(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}
function isImage(b) { return !!imageType(b); }

// ---------- build id: a fingerprint of the page files, so open TV pages reload themselves after an update ----------
const BUILD = (() => {
  const h = crypto.createHash('sha1');
  const walk = d => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : h.update(f).update(fs.readFileSync(p)); } };
  walk(path.join(ROOT, 'public'));
  return h.digest('hex').slice(0, 12);
})();

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

function sendJSON(res, obj) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/events' && url.searchParams.get('preview')) {
      // the setup page's preview: the recorded sample track on a loop, never mixed with the live T8
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 2000\n\n`);
      res.write(`event: config\ndata: ${JSON.stringify(publicConfig())}\n\n`);
      res.write(`event: link\ndata: ${JSON.stringify({ connected: true, error: null, since: Date.now() })}\n\n`);
      const send = () => { const s = normalize(demoState()); s.art = '/art/preview'; delete s.artRef; res.write(`event: state\ndata: ${JSON.stringify(s)}\n\n`); };
      send();
      const t = setInterval(send, 1000);
      req.on('close', () => clearInterval(t));
      return;
    }
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 2000\n\n`);
      res.write(`event: config\ndata: ${JSON.stringify(publicConfig())}\n\n`);
      res.write(`event: link\ndata: ${JSON.stringify(link)}\n\n`);
      if (current) res.write(`event: state\ndata: ${JSON.stringify(current)}\n\n`);
      res.write(`event: stats\ndata: ${JSON.stringify(stats.summary())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/state') return sendJSON(res, { link, state: current });
    // the T8's own answer, untouched: handy for bug reports ("open /api/raw while it plays, send me the text")
    if (p === '/api/raw') return sendJSON(res, lastRaw || {});
    if (p === '/api/config') return sendJSON(res, publicConfig());
    if (p === '/api/settings' && req.method === 'GET') {
      return sendJSON(res, { t8Host, chain: cfg.chain, sources: cfg.sources || {}, device: cfg.device || {}, dacWindow: cfg.dacWindow || { title: '', items: [] }, display: cfg.display, seenSources: [...seenSources], lanUrls: lanUrls(), link, palettes: PALETTE_KEYS, demo: DEMO, labs: cfg.labs, version: require('./package.json').version });
    }
    if ((p === '/api/settings' || p === '/api/find-t8') && req.method === 'POST') {
      if (!isLan(req.socket.remoteAddress) || !sameOrigin(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Changes are only accepted from the setup page on your own network.' })); }
      if (p === '/api/find-t8') return sendJSON(res, { found: DEMO ? [] : await scanLan() });
      let clean;
      try { clean = cleanSettings(await readBody(req)); } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: e.message })); }
      applySettings(clean);
      console.log('[setup] settings saved');
      return sendJSON(res, { ok: true });
    }
    if (p === '/api/stats') return sendJSON(res, stats.summary());
    if (p === '/art/preview') {
      const f = path.join(ROOT, 'samples', 'demo-cover.jpg');
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' });
      return res.end(fs.readFileSync(f));
    }
    if (p.startsWith('/art/')) {
      const key = decodeURIComponent(p.slice(5));
      const buf = /^[\w-]{1,32}$/.test(key) ? await getArt(key).catch(e => { console.warn(`[art] ${key}: ${e.message}`); return null; }) : null;
      if (!buf) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': imageType(buf), 'Cache-Control': 'max-age=86400' });
      return res.end(buf);
    }
    // static files from /public
    const rel = p === '/' ? 'index.html' : p === '/setup' ? 'setup.html' : p.slice(1);
    const file = path.normalize(path.join(ROOT, 'public', rel));
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    // TV browsers love serving stale copies: never cache the page, and stamp asset links with the build id
    const ext = path.extname(file);
    const cache = ext === '.woff2' ? 'max-age=31536000' : 'no-store, must-revalidate';
    if (ext === '.html') {
      const html = fs.readFileSync(file, 'utf8').replace(/(href|src)="((?:fonts\/fonts\.css|style\.css|app\.js))"/g, `$1="$2?b=${BUILD}"`);
      res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': cache, Pragma: 'no-cache', Expires: '0' });
      return res.end(html);
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.warn(`[http] ${p}: ${err.message}`);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  }
});

function publicConfig() {
  return { chain: cfg.chain, sources: cfg.sources || {}, device: cfg.device || {}, dacWindow: cfg.dacWindow || { title: '', items: [] }, display: cfg.display, labs: cfg.labs, demo: DEMO, t8Host: cfg.t8Host, build: BUILD, version: require('./package.json').version };
}

// stats go out every 30 s
setInterval(() => broadcast('stats', stats.summary()), 30000);
// keep connections alive through proxies and sleepy TV browsers
setInterval(() => { for (const res of clients) res.write(`event: hb\ndata: ${Date.now()}\n\n`); }, 10000);

stats.init(path.join(ROOT, 'data'));
server.on('error', err => {
  if (err.code === 'EADDRINUSE') { console.error(`Port ${cfg.port || 8080} is already in use: the HUD is probably already running in another window. Close that one first (${process.platform === 'win32' ? 'or run: Stop-Process -Name node' : 'or run: sudo systemctl stop t8hud, or pkill node'}).`); process.exit(1); }
  throw err;
});
// this computer's addresses on the home network, so nobody has to go looking for them
function lanUrls() {
  const port = cfg.port || 8080, out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/tailscale|zerotier|vpn|wg|docker|vethernet|virtualbox|vmware/i.test(name)) continue;
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(`http://${a.address}:${port}`);
  }
  return out;
}
server.listen(cfg.port || 8080, () => {
  const urls = lanUrls();
  console.log(`T8 HUD v${require('./package.json').version} running.`);
  console.log(urls.length ? `  On the TV, open:   ${urls.join('   or   ')}\n  Setup page:        ${urls[0]}/setup  (or http://localhost:${cfg.port || 8080}/setup on this computer)` : `  Open http://localhost:${cfg.port || 8080}/setup on this computer.`);
  console.log(DEMO ? 'Demo mode: replaying a captured T8 payload.' : `Polling the T8 at http://${t8Host}:${T8_PORT} (auto-discovery ${cfg.autoDiscover === false ? "off" : "on"})`);
  poll();
});
