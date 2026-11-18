'use strict';
// T8 HUD for Google TV: small changes to the shared setup page when it is served by the TV app.
(function () {
  const $ = id => document.getElementById(id);
  const onTv = location.hostname === '127.0.0.1';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // a QR code of the phone setup address, drawn from /app/qrcode.js (MIT, Kazuhiko Arase)
  function showQr(box) {
    const s = document.createElement('script');
    s.src = '/app/qrcode.js';
    s.onload = async () => {
      let url = '';
      try { url = ((await (await fetch('/api/settings', { cache: 'no-store' })).json()).lanUrls || [])[0] || ''; } catch {}
      if (!url) return;
      const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin-top:6px';
      const img = document.createElement('div');
      img.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
      img.style.cssText = 'width:170px;height:170px;background:#fff;border-radius:10px;padding:6px;flex:none';
      const svg = img.querySelector('svg'); if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; }
      const u = $('tvurl');
      u.parentNode.insertBefore(wrap, u); wrap.appendChild(img); wrap.appendChild(u);
      u.style.flex = '1'; u.style.minWidth = '280px'; u.style.fontSize = '22px'; u.style.wordBreak = 'normal'; u.style.overflowWrap = 'anywhere';
    };
    document.head.appendChild(s);
  }

  // The remote's arrow keys, on the TV only. Left to itself the WebView jumps to whatever looks
  // nearest, which skips small things like check boxes, and a number box keeps the keys for itself (they
  // change the number), so the remote gets stuck in it. Here up and down go row by row and never skip one:
  // the next row down (or up), and in that row the control closest to straight below (or above).
  if (onTv) {
    const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]';
    const bar = document.querySelector('.bar');
    const seen = el => { if (el.disabled || el.tabIndex < 0 || !el.getClientRects().length) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const box = el => { const r = el.getBoundingClientRect(); return { el, l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
    const sideways = (a, c) => (c.l > a.r ? c.l - a.r : a.l > c.r ? a.l - c.r : 0) * 4 + Math.abs(c.cx - a.cx) / 100; // overlap first, then centres
    function step(down) {
      const cur = document.activeElement;
      const all = [...document.querySelectorAll(SEL)].filter(seen);
      if (!all.length) return false;
      const inBar = el => !!(bar && bar.contains(el));
      const flow = all.filter(el => !inBar(el)).map(box), fixed = all.filter(inBar).map(box);
      if (!cur || cur === document.body || !all.includes(cur)) { const f = flow[0] || fixed[0]; go(f.el); return true; }
      const a = box(cur);
      let pool;
      if (inBar(cur)) pool = down ? [] : flow.filter(c => c.b <= a.t + 2);          // up from the buttons at the bottom: the last thing in view above them
      else {
        pool = flow.filter(c => c.el !== cur && (down ? c.cy > a.cy && c.t >= a.b - Math.min(a.h, c.h) / 2 : c.cy < a.cy && c.b <= a.t + Math.min(a.h, c.h) / 2));
        if (!pool.length && down) pool = fixed;                                      // past the last row: the buttons at the bottom
      }
      if (!pool.length) return false;
      const edge = down ? Math.min(...pool.map(c => c.t)) : Math.max(...pool.map(c => c.b));
      const first = pool.find(c => (down ? c.t : c.b) === edge);
      const tol = Math.max(10, first.h * 0.6);
      const row = pool.filter(c => down ? c.t <= edge + tol : c.b >= edge - tol);
      row.sort((x, y) => sideways(a, x) - sideways(a, y));
      go(row[0].el);
      return true;
    }
    function go(el) { el.focus({ preventScroll: true }); if (!(bar && bar.contains(el))) el.scrollIntoView({ block: 'center' }); }
    // left and right stay inside the row: the nearest control beside this one, or nowhere
    function side(right) {
      const cur = document.activeElement;
      if (!cur || cur === document.body) return false;
      const a = box(cur), home = bar && bar.contains(cur);
      const pool = [...document.querySelectorAll(SEL)].filter(seen).filter(el => el !== cur && !!(bar && bar.contains(el)) === !!home).map(box)
        .filter(c => Math.min(a.b, c.b) - Math.max(a.t, c.t) > Math.min(a.h, c.h) / 2 && (right ? c.cx > a.cx : c.cx < a.cx));
      if (!pool.length) return true;                                                 // end of the row: stay put
      pool.sort((x, y) => Math.abs(x.cx - a.cx) - Math.abs(y.cx - a.cx));
      go(pool[0].el);
      return true;
    }
    // Boxes you type in. Left alone, the TV's on-screen keyboard pops up the moment the remote lands on one,
    // and then it keeps the arrow keys for itself. So every box sits read-only until OK is pressed on it:
    // the arrows pass straight through, OK opens the keyboard, and the keyboard's own tick (or OK once the
    // keyboard is gone, or just moving on) closes the box again.
    const types = el => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file|hidden)$/.test(el.type)));
    const app = window.T8App;                                                         // the TV app itself, for the keyboard
    const keyboard = show => { try { if (app && app.keyboard) app.keyboard(show); } catch {} };
    let editing = null, busy = false;
    const park = el => { el.readOnly = true; el.enterKeyHint = 'done'; el.classList.remove('tv-edit'); };
    function edit(el) {
      busy = true;
      el.blur();                                                                      // off and on again: the keyboard only opens for a box that takes the focus while it can be typed in
      el.readOnly = false; el.classList.add('tv-edit'); editing = el;
      el.focus({ preventScroll: true });
      busy = false;
      try { const n = el.value.length; el.setSelectionRange(n, n); } catch {}          // (number boxes have no cursor to place)
      keyboard(true);
    }
    function done(el) {
      busy = true;
      el.blur();                                                                      // lets the page hear about the change
      park(el); editing = null;
      if (el.isConnected) el.focus({ preventScroll: true });
      busy = false;
      keyboard(false);
    }
    const css = document.createElement('style');
    css.textContent = 'input[readonly], textarea[readonly] { caret-color: transparent; } input.tv-edit, textarea.tv-edit { outline: 2px solid #fff !important; box-shadow: 0 0 0 5px var(--accent), 0 0 26px var(--accent); caret-color: var(--accent); }';
    document.head.appendChild(css);
    const parkAll = root => { if (root.querySelectorAll) root.querySelectorAll('input, textarea').forEach(el => { if (types(el) && el !== editing) park(el); }); };
    parkAll(document);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (types(n) && n !== editing) park(n); parkAll(n); })))
      .observe(document.documentElement, { childList: true, subtree: true });           // rows added later
    document.addEventListener('focusin', e => { if (!busy && types(e.target) && e.target !== editing) park(e.target); }, true);
    document.addEventListener('focusout', e => { if (!busy && e.target === editing) { park(editing); editing = null; } }, true);

    // OK on a tick box. Some WebViews tick it by themselves and some do not, so look afterwards and only
    // tick it here when nothing happened.
    let tick = null;
    const ticks = el => !!el && el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio');
    document.addEventListener('keyup', e => {
      if (e.key !== 'Enter' || !tick) return;
      const { el, was } = tick; tick = null;
      if (el === e.target) setTimeout(() => { if (el.checked === was && !el.disabled && el.isConnected) el.click(); }, 60);
    }, true);

    document.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const k = e.key, t = e.target;
      if (k === 'Enter') {
        if (types(t)) { e.preventDefault(); if (!e.repeat) (t === editing ? done : edit)(t); }
        else if (ticks(t) && !e.repeat) tick = { el: t, was: t.checked };
      } else if (k === 'ArrowDown' || k === 'ArrowUp') {
        if (t && t.tagName === 'TEXTAREA' && t === editing) return;
        if (step(k === 'ArrowDown')) e.preventDefault();
      } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && t !== editing) {         // while typing they move the cursor
        if (side(k === 'ArrowRight')) e.preventDefault();
      }
    }, true);
  }

  const box = $('tvbox');
  if (box) {
    if (onTv) {
      box.querySelector('h2').textContent = 'Easier: set up from your phone';
      box.querySelector('.hint').textContent = 'Typing with a TV remote is slow. Point your phone camera at the code and tap the link, or type the address into a browser on your phone or computer (same network). To type here anyway, press OK on a box and the keyboard opens. Back on the remote returns to the HUD.';
      showQr(box);
    } else box.hidden = true;
  }

  // the app section: version, update check, one-press install on the TV
  const sec = document.createElement('section');
  sec.innerHTML = '<h2>TV app</h2><p class="hint" id="appInfo">Checking…</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="appInstall" class="primary" hidden>Install update</button><button id="appCheck">Check for updates</button></div><p class="hint" id="appMsg" style="margin:10px 0 0"></p>';
  (box && box.nextElementSibling ? box.parentNode.insertBefore(sec, box.nextElementSibling) : document.querySelector('main').appendChild(sec));

  // an update is waiting: say so at the very top, with the button right there (the TV app section is a long way
  // down with a remote). On the TV the button takes the focus, so one press of OK starts the install.
  function banner(u) {
    let b = $('appBanner');
    if (!u) { if (b) b.remove(); return; }
    if (b && b.dataset.v === u.version) return;
    if (b) b.remove();
    b = document.createElement('section');
    b.id = 'appBanner'; b.dataset.v = u.version;
    b.style.cssText = 'border-color:var(--accent);box-shadow:0 0 18px rgba(200,107,255,.28);display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap';
    const can = onTv && u.canInstall;
    b.innerHTML = '<div><h2 style="margin:0 0 4px">Update ready</h2><p class="hint" style="margin:0">T8 HUD <b>' + esc(u.version) + '</b> is out. ' +
      (can ? 'Press OK to install it. Your settings stay as they are.' : onTv ? 'Download it from ' + esc(u.page) : 'Install it from the setup screen on the TV (press OK on the remote, then Settings).') + '</p></div>' +
      (can ? '<button class="primary" id="appBannerBtn" style="font-size:17px;padding:14px 22px">Install update</button>' : '');
    const lead = document.querySelector('main .lead');
    lead.parentNode.insertBefore(b, lead.nextSibling);
    if (can) { $('appBannerBtn').onclick = () => { $('appInstall').scrollIntoView({ block: 'center' }); $('appInstall').click(); }; $('appBannerBtn').focus(); }
  }

  async function refresh() {
    try {
      const c = await (await fetch('/api/config', { cache: 'no-store' })).json();
      const a = c.app || {};
      const u = a.update;
      banner(u);
      $('appInfo').innerHTML = 'T8 HUD for Google TV, version <b>' + esc(a.version || '?') + '</b>. ' + esc(a.updateStatus || '') +
        (u ? '. Release notes: ' + esc(u.page) : '');
      $('appInstall').hidden = !(u && u.canInstall);
      if (u && !onTv) { $('appInstall').hidden = true; $('appMsg').textContent = 'Install it from the setup screen on the TV (press OK on the remote).'; }
    } catch { $('appInfo').textContent = 'Could not reach the app.'; }
  }
  $('appCheck').onclick = async () => {
    $('appMsg').textContent = 'Asking GitHub…';
    try { await fetch('/app/check-update', { method: 'POST' }); } catch {}
    setTimeout(async () => { await refresh(); $('appMsg').textContent = ''; }, 4000);
  };
  $('appInstall').onclick = async () => {
    const b = $('appInstall'); b.disabled = true; $('appMsg').textContent = 'Downloading the update… (about 10 s)';
    try {
      const r = await (await fetch('/app/update', { method: 'POST' })).json();
      $('appMsg').textContent = r.error || 'The installer is open: press Install. The HUD comes back by itself afterwards (or open T8 HUD again).';
    } catch { $('appMsg').textContent = 'Update failed. Try again in a minute.'; }
    b.disabled = false;
  };
  refresh();
  setInterval(refresh, 30000);
})();
