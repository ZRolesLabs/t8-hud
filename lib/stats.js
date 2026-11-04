'use strict';
// Local listening log: seconds played per day, per format tier and per album. Stored in data/stats.json.

const fs = require('fs');
const path = require('path');

let file = null;
let db = { days: {} }; // { "2026-11-03": { total, tiers: {dsd,hires,cd,lossy}, albums: {name: sec}, peakRateHz } }
let last = null;       // timestamp of the last playing sample
let dirty = false;

function dayKey(t) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'stats.json');
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); if (!db.days) db = { days: {} }; } catch { db = { days: {} }; }
  setInterval(save, 30000).unref();
  process.on('SIGINT', () => { save(); process.exit(0); });
}

function save() {
  if (!dirty || !file) return;
  try { fs.writeFileSync(file, JSON.stringify(db)); dirty = false; } catch (e) { console.warn('[stats] save failed:', e.message); }
}

function record(s) {
  const now = s.at;
  if (s.state !== 'playing' || !s.track) { last = null; return; }
  if (last !== null) {
    const sec = Math.min(5, (now - last) / 1000); // ignore gaps (bridge asleep, T8 offline)
    const d = (db.days[dayKey(now)] ||= { total: 0, tiers: {}, albums: {}, peakRateHz: 0 });
    d.total += sec;
    d.tiers[s.format.tier] = (d.tiers[s.format.tier] || 0) + sec;
    if (s.track.album) d.albums[s.track.album] = (d.albums[s.track.album] || 0) + sec;
    if (s.format.rateHz > d.peakRateHz) d.peakRateHz = s.format.rateHz;
    // best PCM: highest sample rate, then bit depth (DSD is counted separately, it would always win)
    if (s.format.family === 'pcm' && s.format.rateHz) {
      const b = d.bestPcm || { rateHz: 0, bits: 0 };
      const bits = Number(s.format.bits) || 0;
      if (s.format.rateHz > b.rateHz || (s.format.rateHz === b.rateHz && bits > b.bits)) d.bestPcm = { rateHz: s.format.rateHz, bits };
    }
    dirty = true;
  }
  last = now;
}

function summary(now = Date.now()) {
  const today = db.days[dayKey(now)] || { total: 0, tiers: {}, albums: {}, peakRateHz: 0 };
  const week = {};
  for (let i = 0; i < 7; i++) {
    const d = db.days[dayKey(now - i * 864e5)];
    if (d) for (const [a, sec] of Object.entries(d.albums)) week[a] = (week[a] || 0) + sec;
  }
  const topAlbum = Object.entries(week).sort((a, b) => b[1] - a[1])[0];
  return {
    todaySec: Math.round(today.total),
    dsdShare: today.total ? (today.tiers.dsd || 0) / today.total : 0,
    hiresShare: today.total ? ((today.tiers.dsd || 0) + (today.tiers.hires || 0)) / today.total : 0,
    peakRateHz: today.peakRateHz || 0,
    bestPcm: today.bestPcm || null,
    albumOfWeek: topAlbum ? topAlbum[0] : null,
  };
}

module.exports = { init, record, summary };
