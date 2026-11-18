'use strict';
// Lyrics for the HUD: parsing, matching and the lookup order. Pure functions plus one small async
// routine that is handed its own I/O, so the PC bridge and the TV app share every decision here and
// only differ in how they fetch.
//
// Where the words come from, in this order:
//   1. the T8 itself (a lyric the player already has for the track: nothing leaves your network)
//   2. LRCLIB (lrclib.net), only if the person switched the online lookup on in /setup. It is a free,
//      open lyrics database: no account, no API key, no tracking. The request carries the track's
//      title, artist, album and length, and nothing else.
// Synced lyrics are only used when their timing can be trusted (same recording length); otherwise the
// words are shown as plain text and labelled "not timed". Nothing is invented.

const LRCLIB_HOST = 'lrclib.net';

// ---------- LRC parsing ----------
// "[01:23.45]", "[01:23:45]", "[1:23]", "[01:23.456]" -> ms
const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g; // enhanced LRC word timing: not shown, stripped
const META = /^\[([a-z#]+):(.*)\]$/i;                     // [ar:...] [ti:...] [offset:...]

function stampMs(m, s, f) {
  const frac = f === undefined ? 0 : Number(f) * (f.length === 3 ? 1 : f.length === 2 ? 10 : 100);
  return Number(m) * 60000 + Number(s) * 1000 + frac;
}
function tidy(s) { return String(s || '').replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim(); }

// LRC text -> { synced: [{ t, text }], plain: [text] }. A timed line with no words is kept (it marks
// a pause in the singing); untimed text is returned as plain lines.
function parseLrc(text) {
  const synced = [], plain = [];
  let offset = 0;
  for (const rawLine of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) { if (plain.length && plain[plain.length - 1] !== '') plain.push(''); continue; }
    const meta = line.match(META);
    if (meta && !/^\d/.test(meta[1])) {
      if (meta[1].toLowerCase() === 'offset' && Number.isFinite(Number(meta[2]))) offset = Number(meta[2]);
      continue;
    }
    const stamps = [];
    let rest = line, m;
    STAMP.lastIndex = 0;
    while ((m = STAMP.exec(line)) && m.index === line.length - rest.length) {
      stamps.push(stampMs(m[1], m[2], m[3]));
      rest = line.slice(STAMP.lastIndex);
    }
    const words = tidy(rest);
    if (stamps.length) for (const t of stamps) synced.push({ t, text: words });
    else plain.push(words);
  }
  // [offset:+ms] means "show the words that much earlier"
  for (const l of synced) l.t = Math.max(0, l.t - offset);
  synced.sort((a, b) => a.t - b.t);
  while (plain.length && plain[plain.length - 1] === '') plain.pop();
  return { synced, plain };
}

// ---------- matching ----------
// loose comparison form: lower case, no accents, no punctuation, "&" = "and"
function fold(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/['’`´]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// "Deacon Blues (2023 Remaster)" / "Song - Live at X" / "Song [Mono]" -> "Deacon Blues" / "Song" / "Song"
const EDITION = /\b(remaster(ed)?|mono|stereo|deluxe|bonus|edit(ion)?|version|mix|live|single|album|explicit|clean|anniversary|expanded|reissue|original|sacd|dsd\d*|hi-?res|\d{4})\b/i;
function baseTitle(s) {
  let out = String(s || '');
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/\s*[([]([^()[\]]*)[)\]]\s*$/, (all, inner) => EDITION.test(inner) ? '' : all)
      .replace(/\s+[-–—]\s+([^-–—]*)$/, (all, tail) => EDITION.test(tail) ? '' : all);
    if (next === out) break;
    out = next;
  }
  return out.trim() || String(s || '').trim();
}
// "Steely Dan; Someone" / "A feat. B" / "A, B" -> "Steely Dan" / "A" / "A"
function leadArtist(s) { return String(s || '').split(/\s*(?:;|\/|,|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)[0].trim() || String(s || '').trim(); }

// one stable id per recording, for the cache and for "is this still the same track?"
function trackKey(track, durationMs) {
  if (!track || !track.title) return '';
  return [fold(track.artist), fold(track.title), fold(track.album), Math.round((durationMs || 0) / 1000)].join('|');
}
// is there enough to look a track up? (radio streams and inputs often have no artist)
function searchable(track, durationMs) { return !!(track && tidy(track.title) && tidy(track.artist) && durationMs > 20000); }

// ---------- the result every screen draws ----------
// kind: 'synced' (lines carry times) | 'plain' (words only) | 'instrumental' | 'none'
function result(kind, source, lines) { return { kind, source: source || null, lines: lines || [] }; }
function fromLrcText(text, source) {
  const p = parseLrc(text);
  if (p.synced.filter(l => l.text).length >= 2) return result('synced', source, p.synced);
  const words = (p.synced.length ? p.synced.map(l => l.text) : p.plain);
  if (words.filter(Boolean).length >= 2) return result('plain', source, words.map(text => ({ t: null, text })));
  return null;
}

// ---------- the T8's own lyrics ----------
// The player keeps a lyric for some tracks and says so in getState ("hasLyric"). It hands the words over
// from the same read-only API as everything else the HUD asks, in the way Eversolo's own app asks:
// getLyric with the playing track's id and type, the duration exactly as getState reports it, and the
// track number. Only for tracks the T8 plays itself (they have a library id).
function t8LyricRequest(state, raw) {
  const id = state && state.track ? state.track.id : null;
  if (id === null || id === undefined || id === '' || !raw || raw.hasLyric === false) return null;
  const pm = raw.playingMusic || {}, pt = raw.playingTrack || null;
  const int = v => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
  return '/ZidooMusicControl/v2/getLyric?id=' + encodeURIComponent(id) + '&type=' + int(pm.type) + '&duration=' + int(raw.duration) + '&number=' + int(pt ? pt.number : 0);
}
// Lyric files are not always UTF-8 (older ones are often Windows-1252, some UTF-16): read them as what they are.
function decodeText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const as = (enc, fatal) => new TextDecoder(enc, { fatal: !!fatal }).decode(b);
  try {
    if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) return as(b[0] === 0xff ? 'utf-16le' : 'utf-16be');
    return as('utf-8', true);
  } catch (e) { /* not UTF-8 */ }
  try { return as('windows-1252'); } catch (e) { return Array.from(b, c => String.fromCharCode(c)).join(''); }
}
// The answer is the lyric file itself: LRC text. (It can also be KRC, a packed karaoke format the HUD
// does not read, or a small JSON status when there is nothing; both count as "no lyrics".)
function t8LyricText(body) {
  const text = String(body || '').replace(/^﻿/, '');
  if (!text.trim() || /^krc/i.test(text) || /^\s*[{<]/.test(text) || /[\u0000-\u0008]/.test(text.slice(0, 400))) return null;
  return text;
}

// ---------- LRCLIB ----------
const q = o => Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
// The requests to try, most exact first. Only these two API paths are ever used.
function lrclibRequests(track, durationMs) {
  const sec = Math.round(durationMs / 1000), title = tidy(track.title), artist = tidy(track.artist), album = tidy(track.album);
  const out = [];
  if (album) out.push('/api/get?' + q({ track_name: title, artist_name: artist, album_name: album, duration: sec }));
  out.push('/api/search?' + q({ track_name: title, artist_name: artist }));
  const t2 = baseTitle(title), a2 = leadArtist(artist);
  if (t2 !== title || a2 !== artist) out.push('/api/search?' + q({ track_name: t2, artist_name: a2 }));
  return out;
}
// one LRCLIB record -> a result, or null when it does not fit this recording
const SYNC_TOLERANCE_S = 3; // timed lyrics made for a different cut would run early or late
function lrclibRecord(rec, track, durationMs, exact) {
  if (!rec || typeof rec !== 'object') return null;
  if (!exact) {
    const sameTitle = fold(baseTitle(rec.trackName)) === fold(baseTitle(track.title));
    const sameArtist = fold(leadArtist(rec.artistName)) === fold(leadArtist(track.artist)) || fold(rec.artistName) === fold(track.artist);
    if (!sameTitle || !sameArtist) return null;
  }
  const off = Math.abs(Number(rec.duration) - durationMs / 1000);
  const timed = Number.isFinite(off) && off <= SYNC_TOLERANCE_S;
  if (rec.instrumental) return timed ? Object.assign(result('instrumental', 'lrclib', []), { off }) : null;
  let r = null;
  if (timed && rec.syncedLyrics) r = fromLrcText(rec.syncedLyrics, 'lrclib');
  if (!r && rec.plainLyrics) { const p = fromLrcText(rec.plainLyrics, 'lrclib'); if (p) r = result('plain', 'lrclib', p.lines.map(l => ({ t: null, text: l.text }))); }
  if (!r && rec.syncedLyrics) { const p = fromLrcText(rec.syncedLyrics, 'lrclib'); if (p) r = result('plain', 'lrclib', p.lines.filter(l => l.text).map(l => ({ t: null, text: l.text }))); }
  return r ? Object.assign(r, { off: Number.isFinite(off) ? off : 999 }) : null;
}
// an LRCLIB answer (one record from /api/get, or a list from /api/search) -> the best result or null
function fromLrclib(json, track, durationMs, exact) {
  if (Array.isArray(json)) {
    const rank = r => (r.kind === 'synced' ? 0 : r.kind === 'instrumental' ? 1 : 2);
    const fits = json.slice(0, 40).map(rec => lrclibRecord(rec, track, durationMs, false)).filter(Boolean)
      .sort((a, b) => rank(a) - rank(b) || a.off - b.off);
    return fits[0] || null;
  }
  return lrclibRecord(json, track, durationMs, !!exact);
}

// ---------- the lookup ----------
// io.t8(track)      -> lyric text the T8 holds for the playing track, or null   (local network only)
// io.lrclib(path)   -> parsed JSON from https://lrclib.net<path>, or null       (only called when online)
// Returns a result object; kind 'none' when nothing honest could be found.
async function find(track, durationMs, io, opts) {
  opts = opts || {};
  if (!track || !tidy(track.title)) return result('none');
  try {
    const own = io.t8 ? await io.t8(track) : null;
    const r = own ? fromLrcText(own, 't8') : null;
    if (r) return r;
  } catch (e) { /* the T8 has none: carry on */ }
  if (opts.online && io.lrclib && searchable(track, durationMs)) {
    const reqs = lrclibRequests(track, durationMs);
    for (let i = 0; i < reqs.length; i++) {
      let json = null;
      try { json = await io.lrclib(reqs[i]); } catch (e) { json = null; }
      const r = json ? fromLrclib(json, track, durationMs, reqs[i].startsWith('/api/get?')) : null;
      if (r) { delete r.off; return r; }
    }
  }
  return result('none');
}

// which line is being sung at `ms`? -1 before the first line
function lineAt(lines, ms) {
  let lo = 0, hi = lines.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].t <= ms) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at;
}

module.exports = { LRCLIB_HOST, parseLrc, fold, baseTitle, leadArtist, trackKey, searchable, fromLrcText, decodeText, t8LyricRequest, t8LyricText, lrclibRequests, fromLrclib, find, lineAt };
