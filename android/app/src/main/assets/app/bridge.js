'use strict';
// T8 HUD for Google TV: stands in for the bridge's event stream. The app polls the T8 and the page
// turns each answer into HUD state with the same normaliser the PC bridge uses (lib/normalize.js).
(function () {
  // normalize.js keys stream cover URLs with a short hash; this one only has to be stable
  window.T8HUD_HASH = function (s) {
    let out = '';
    for (const seed of [0x811c9dc5, 0x6a09e667, 0x3c6ef372]) {
      let h = seed >>> 0;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      out += h.toString(16).padStart(8, '0');
    }
    return out;
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const getJSON = async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };

  function toState(raw) {
    const s = window.T8N.normalize(raw);
    // the app's server checks the reference against the T8's own answer before fetching it
    if (s.art && s.artRef) s.art += '?k=' + encodeURIComponent(s.artRef.kind) + '&v=' + encodeURIComponent(s.artRef.value);
    delete s.artRef;
    return s;
  }

  // what the "offline" strip says, so a first start explains itself
  function offlineText(link) {
    const el = document.getElementById('offline');
    if (!el || link.connected) return;
    el.textContent = link.error === 'No T8 set yet'
      ? 'Looking for your T8 on the network… · press OK on the remote for the menu'
      : 'T8 asleep or offline · waiting for it · OK on the remote opens the menu';
  }

  // a newer release on GitHub: say so now and then, never permanently on screen (burn-in)
  let updateShownAt = 0;
  function updateNote(app) {
    const u = app && app.update;
    if (!u || Date.now() - updateShownAt < 3 * 3600e3) return;
    updateShownAt = Date.now();
    let el = document.getElementById('appUpdate');
    if (!el) {
      el = document.createElement('div');
      el.id = 'appUpdate';
      el.style.cssText = 'position:fixed;right:2vw;bottom:2vh;z-index:50;padding:.6em 1em;border-radius:.5em;background:rgba(12,7,20,.88);border:1px solid rgba(200,107,255,.6);color:#f3eeff;font:500 1vw/1.3 "JetBrains Mono",monospace';
      document.body.appendChild(el);
    }
    el.textContent = 'T8 HUD ' + u.version + ' is out · press OK, then Settings → Install update';
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 20000);
  }

  // Lyrics: lib/lyrics.js decides what to ask and what to accept (the same file the PC bridge uses); the
  // app fetches. The T8 is asked first; LRCLIB only if the online lookup is switched on in setup.
  const L = window.T8L;
  const lyricIo = {
    t8: async (track, state, raw) => {
      const q = L.t8LyricRequest(state, raw);
      if (!q) return null;
      const r = await fetch('/t8/lyric?q=' + encodeURIComponent(q), { cache: 'no-store' });
      return r.ok ? L.t8LyricText(L.decodeText(new Uint8Array(await r.arrayBuffer()))) : null;
    },
    lrclib: path => getJSON('/lyrics/lrclib?p=' + encodeURIComponent(path)),
  };

  class AppEvents {
    constructor(url) {
      this.preview = /preview/.test(url);
      this.listeners = {};
      this.readyState = 1;
      this.closed = false;
      this.cfgSig = '';
      this.display = {};
      this.lyricKey = '';
      this.lyricJob = 0;
      setTimeout(() => this.loop(), 0);
    }
    // once per track: find the words and hand them to the page
    async lyrics(state, raw) {
      if (!L || this.display.showLyrics !== true || !state.track || state.state === 'idle') return;
      // (the T8 can take a moment to say it has a lyric: when that flag turns up, the track is looked up again)
      const key = L.trackKey(state.track, state.duration) && L.trackKey(state.track, state.duration) + (raw && raw.hasLyric === true ? '|t8' : '');
      if (!key || key === this.lyricKey) return;
      this.lyricKey = key;
      const job = ++this.lyricJob;
      const track = { title: state.track.title, artist: state.track.artist, duration: state.duration };
      let r = { kind: 'none', source: null, lines: [] };
      try {
        r = await L.find(state.track, state.duration, { t8: t => lyricIo.t8(t, state, raw), lrclib: lyricIo.lrclib }, { online: this.display.lyricsOnline === true });
      } catch (e) { console.error(e); }
      if (job === this.lyricJob && !this.closed) this.emit('lyrics', Object.assign({ track }, r));
    }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    emit(type, data) {
      for (const fn of this.listeners[type] || []) { try { fn({ data: JSON.stringify(data) }); } catch (e) { console.error(e); } }
    }
    close() { this.closed = true; this.readyState = 2; }
    async loop() {
      let n = 0, demo = null, demoStart = 0;
      while (!this.closed) {
        try {
          if (n % 3 === 0) {
            const c = await getJSON('/api/config');
            const sig = JSON.stringify({ ...c, app: undefined });
            if (sig !== this.cfgSig) {
              this.cfgSig = sig; this.emit('config', c);
              // the lyric switches may have changed: look the playing track up again
              const d = c.display || {};
              if (d.showLyrics !== this.display.showLyrics || d.lyricsOnline !== this.display.lyricsOnline) { this.lyricKey = ''; this.lyricJob++; }
              this.display = d;
            }
            if (!this.preview) updateNote(c.app);
          }
          if (this.preview) {
            const first = !demo;
            if (!demo) { demo = await getJSON('/samples/getState-dsd64-deacon-blues.json'); demoStart = Date.now() - demo.position; }
            const raw = JSON.parse(JSON.stringify(demo));
            raw.position = (Date.now() - demoStart) % raw.duration;
            const s = window.T8N.normalize(raw);
            s.art = '/art/preview'; delete s.artRef;
            this.emit('link', { connected: true, error: null, since: demoStart });
            this.emit('state', s);
            if (first && L) {
              // sample lines written for the preview (not the words of the sample track); drawn only when lyrics are on
              try {
                const sample = L.fromLrcText(await (await fetch('/samples/demo-lyrics.lrc', { cache: 'no-store' })).text(), 'sample');
                if (sample) this.emit('lyrics', Object.assign({ track: { title: s.track.title, artist: s.track.artist, duration: s.duration } }, sample));
              } catch (e) { /* the preview works without them */ }
            }
          } else {
            const r = await getJSON('/t8/state');
            this.emit('link', r.link);
            offlineText(r.link);
            if (r.raw) { const st = toState(r.raw); this.emit('state', st); this.lyrics(st, r.raw); }
          }
          this.emit('hb', Date.now());
        } catch (e) {
          const l = { connected: false, error: 'The app is starting', since: Date.now() };
          this.emit('link', l); offlineText(l);
        }
        n++;
        await sleep(1000);
      }
    }
  }
  // TV app: the remote menu (Settings · Lyrics · About · Exit) and the About card. MainActivity sends every
  // remote key on the HUD to t8Key(); it answers 'settings' or 'exit' when the app must act, else ''.
  const LOGO = '<svg viewBox="-150 -185 300 325" aria-hidden="true"><defs><linearGradient id="abq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e535c8"/><stop offset="1" stop-color="#7b2ff0"/></linearGradient></defs><path d="M-40 -60 V-160 Q-40 -172 -28 -172 H28 Q40 -172 40 -160 V-60 L130 95 Q145 125 110 125 H-110 Q-145 125 -130 95 Z" fill="none" stroke="#c86bff" stroke-width="18" stroke-linejoin="round"/><path d="M-66 -10 Q-50 -34 -33 -10 T0 -10 T33 -10 T66 -10 L118 90 Q126 108 104 108 H-104 Q-126 108 -118 90 Z" fill="url(#abq)"/><text x="0" y="96" text-anchor="middle" font-family="Big Shoulders Display, Arial Narrow, sans-serif" font-weight="800" font-size="170" fill="#f3eefe">Z</text></svg>';
  const ITEMS = [['settings', 'Settings'], ['lyrics', 'Lyrics'], ['about', 'About'], ['exit', 'Exit']];
  // Lyrics on the remote: OK flips them on or off right there (the same switch as "Show lyrics" in setup)
  let lyricsOn = false;
  async function readLyricsSwitch() { try { lyricsOn = ((await getJSON('/api/config')).display || {}).showLyrics === true; } catch (e) { /* keep the last answer */ } if (menuEl) drawMenu(); }
  async function flipLyrics() {
    lyricsOn = !lyricsOn; drawMenu();
    try { await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display: { showLyrics: lyricsOn } }) }); } catch (e) { /* the switch shows the truth on the next open */ }
    readLyricsSwitch();
  }
  const MENU_MS = 8000;
  let menuEl = null, menuTimer = 0, sel = 0, aboutEl = null;
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function css() {
    if (document.getElementById('t8MenuCss')) return;
    const st = document.createElement('style');
    st.id = 't8MenuCss';
    st.textContent = `
#t8Menu{position:fixed;right:3vh;bottom:3vh;z-index:99;display:flex;gap:1vh;padding:1vh;border-radius:1.4vh;background:rgba(12,7,20,.86);border:1px solid rgba(200,107,255,.35);font:600 1.7vh/1 "JetBrains Mono",monospace;letter-spacing:.04em;transition:opacity .35s;opacity:0}
#t8Menu.on{opacity:1}
#t8Menu b{display:block;padding:1.1vh 1.8vh;border-radius:.9vh;color:rgba(243,238,255,.75);border:1px solid transparent;font-weight:600}
#t8Menu b.sel{color:#fff;background:rgba(200,107,255,.28);border-color:#c86bff;box-shadow:0 0 1.6vh rgba(200,107,255,.45)}
#t8Menu i{font-style:normal;margin-left:.6vh;padding:.25vh .7vh;border-radius:.6vh;font-size:.82em;color:rgba(243,238,255,.6);border:1px solid rgba(243,238,255,.25)}
#t8Menu i.on{color:#5cf2c5;border-color:rgba(92,242,197,.6)}
#t8About{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(5,3,10,.78);backdrop-filter:blur(.6vh)}
#t8About .card{width:min(62vh,80vw);padding:4.5vh 5vh 4vh;border-radius:2.4vh;text-align:center;color:#f3eefe;background:radial-gradient(120% 90% at 50% 0%,#2a1150 0%,#120a22 60%,#0a0612 100%);border:2px solid rgba(200,107,255,.5);box-shadow:0 0 6vh rgba(123,47,240,.35)}
#t8About svg{width:13vh;height:14vh;filter:drop-shadow(0 0 1.8vh rgba(200,107,255,.7))}
#t8About h2{margin:1.6vh 0 0;font:800 6.4vh/.95 "Big Shoulders Display",sans-serif;letter-spacing:.02em}
#t8About .by{margin-top:1vh;font:600 1.7vh/1 "JetBrains Mono",monospace;color:#3fe0ff;letter-spacing:.42em;text-transform:uppercase}
#t8About dl{display:grid;grid-template-columns:auto 1fr;gap:1.1vh 2.2vh;margin:3.6vh 0 0;text-align:left;font:500 1.75vh/1.3 Archivo,sans-serif}
#t8About dt{color:rgba(243,238,255,.55);font:600 1.35vh/1.6 "JetBrains Mono",monospace;letter-spacing:.12em;text-transform:uppercase}
#t8About dd{margin:0;color:#f3eefe;word-break:break-word}
#t8About .tag{margin-top:3vh;font:500 1.55vh/1.45 Archivo,sans-serif;color:rgba(243,238,255,.65)}
#t8About .ok{display:inline-block;margin-top:3.4vh;padding:1.2vh 5vh;border-radius:1vh;font:700 1.9vh/1 "JetBrains Mono",monospace;color:#fff;background:rgba(200,107,255,.3);border:1px solid #c86bff;box-shadow:0 0 1.8vh rgba(200,107,255,.5)}`;
    document.head.appendChild(st);
  }

  function drawMenu() {
    menuEl.innerHTML = ITEMS.map((it, i) => '<b class="' + (i === sel ? 'sel' : '') + '">' + it[1] + (it[0] === 'lyrics' ? ' <i class="' + (lyricsOn ? 'on' : '') + '">' + (lyricsOn ? 'on' : 'off') + '</i>' : '') + '</b>').join('');
  }
  function bump() { clearTimeout(menuTimer); menuTimer = setTimeout(hideMenu, MENU_MS); }
  function showMenu() {
    css();
    if (!menuEl) { menuEl = document.createElement('div'); menuEl.id = 't8Menu'; document.body.appendChild(menuEl); }
    sel = 0; drawMenu(); menuEl.hidden = false;
    readLyricsSwitch();
    requestAnimationFrame(() => menuEl.classList.add('on'));
    bump();
  }
  function hideMenu() {
    clearTimeout(menuTimer);
    if (!menuEl) return;
    menuEl.classList.remove('on');
    setTimeout(() => { if (menuEl && !menuEl.classList.contains('on')) menuEl.hidden = true; }, 400);
  }
  const menuOpen = () => menuEl && !menuEl.hidden && menuEl.classList.contains('on');

  async function showAbout() {
    css();
    hideMenu();
    let c = {};
    try { c = await getJSON('/api/config'); } catch (e) { /* show what we can */ }
    const app = c.app || {};
    const ver = app.version || c.version || '';
    const upd = app.update ? 'Version ' + esc(app.update.version) + ' is available: Settings → Install update' : 'Up to date';
    aboutEl = document.createElement('div');
    aboutEl.id = 't8About';
    aboutEl.innerHTML = '<div class="card">' + LOGO + '<h2>T8 HUD</h2><div class="by">by ZRolesLabs</div>' +
      '<dl><dt>Version</dt><dd>' + esc(ver) + '</dd>' +
      '<dt>Updates</dt><dd>' + upd + '</dd>' +
      '<dt>Project</dt><dd>github.com/ZRolesLabs/t8-hud</dd>' +
      '<dt>Contact</dt><dd>zroleslabs@proton.me</dd>' +
      '<dt>Licence</dt><dd>MIT · free and open source</dd></dl>' +
      '<div class="tag"><b style="color:#c86bff;letter-spacing:.06em">UN-ENSHITTIFIED.</b> Read-only, account-free, no ads, no tracking.<br>Not affiliated with Eversolo.</div>' +
      '<div class="ok">OK</div></div>';
    document.body.appendChild(aboutEl);
  }
  function hideAbout() { if (aboutEl) { aboutEl.remove(); aboutEl = null; } }

  window.t8Key = function (k) {
    if (aboutEl) { if (k === 'ok' || k === 'back') hideAbout(); return ''; }
    if (!menuOpen()) {
      if (k === 'back') return 'exit';
      showMenu(); return '';
    }
    bump();
    if (k === 'left' || k === 'up') { sel = (sel + ITEMS.length - 1) % ITEMS.length; drawMenu(); return ''; }
    if (k === 'right' || k === 'down') { sel = (sel + 1) % ITEMS.length; drawMenu(); return ''; }
    if (k === 'back') { hideMenu(); return ''; }
    if (k === 'ok') {
      const act = ITEMS[sel][0];
      if (act === 'lyrics') { flipLyrics(); return ''; } // stays open, so you see it switch
      hideMenu();
      if (act === 'about') { showAbout(); return ''; }
      return act;
    }
    return '';
  };

  AppEvents.CLOSED = 2;
  window.EventSource = AppEvents;
})();
