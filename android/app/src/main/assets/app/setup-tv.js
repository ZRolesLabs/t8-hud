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

  // The remote's up and down keys, on the TV only. Left to itself the WebView jumps to whatever looks
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
    const typing = el => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|color)$/.test(el.type)));
    document.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        if (e.target && e.target.tagName === 'TEXTAREA') return;
        if (step(k === 'ArrowDown')) e.preventDefault();
      } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && !typing(e.target)) {     // in a text box they move the cursor
        if (side(k === 'ArrowRight')) e.preventDefault();
      }
    }, true);
  }

  const box = $('tvbox');
  if (box) {
    if (onTv) {
      box.querySelector('h2').textContent = 'Easier: set up from your phone';
      box.querySelector('.hint').textContent = 'Typing with a TV remote is slow. Point your phone camera at the code and tap the link, or type the address into a browser on your phone or computer (same network). Back on the remote returns to the HUD.';
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
