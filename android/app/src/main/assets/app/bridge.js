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
      ? 'Looking for your T8 on the network… · press OK on the remote for setup'
      : 'T8 asleep or offline · waiting for it · OK on the remote opens setup';
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
    el.textContent = 'T8 HUD ' + u.version + ' is out · press OK, then Install update';
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 20000);
  }

  class AppEvents {
    constructor(url) {
      this.preview = /preview/.test(url);
      this.listeners = {};
      this.readyState = 1;
      this.closed = false;
      this.cfgSig = '';
      setTimeout(() => this.loop(), 0);
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
            if (sig !== this.cfgSig) { this.cfgSig = sig; this.emit('config', c); }
            if (!this.preview) updateNote(c.app);
          }
          if (this.preview) {
            if (!demo) { demo = await getJSON('/samples/getState-dsd64-deacon-blues.json'); demoStart = Date.now() - demo.position; }
            const raw = JSON.parse(JSON.stringify(demo));
            raw.position = (Date.now() - demoStart) % raw.duration;
            const s = window.T8N.normalize(raw);
            s.art = '/art/preview'; delete s.artRef;
            this.emit('link', { connected: true, error: null, since: demoStart });
            this.emit('state', s);
          } else {
            const r = await getJSON('/t8/state');
            this.emit('link', r.link);
            offlineText(r.link);
            if (r.raw) this.emit('state', toState(r.raw));
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
  // TV app: a small key-hint chip, shown only when a remote button is pressed (MainActivity calls t8Hint)
  let hintEl = null, hintTimer = 0;
  window.t8Hint = function () {
    if (!hintEl) {
      hintEl = document.createElement('div');
      const k = t => '<span style="display:inline-block;padding:.35vh .7vh;margin-right:.6vh;border:1px solid rgba(243,238,255,.45);border-radius:.5vh;font-weight:700">' + t + '</span>';
      hintEl.innerHTML = k('OK') + 'Settings<span style="opacity:.4;margin:0 1.2vh">·</span>' + k('BACK') + 'Exit';
      hintEl.style.cssText = 'position:fixed;right:3vh;bottom:3vh;z-index:99;padding:.9vh 1.4vh;border-radius:1vh;' +
        'background:rgba(12,7,20,.72);color:rgba(243,238,255,.8);font:500 1.45vh/1 "JetBrains Mono",monospace;letter-spacing:.04em;' +
        'transition:opacity .5s;opacity:0;pointer-events:none';
      document.body.appendChild(hintEl);
    }
    requestAnimationFrame(() => { hintEl.style.opacity = '1'; });
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintEl.style.opacity = '0'; }, 5000);
  };

  AppEvents.CLOSED = 2;
  window.EventSource = AppEvents;
})();
