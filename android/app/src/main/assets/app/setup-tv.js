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

  async function refresh() {
    try {
      const c = await (await fetch('/api/config', { cache: 'no-store' })).json();
      const a = c.app || {};
      const u = a.update;
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
