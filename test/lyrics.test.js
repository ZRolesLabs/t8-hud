'use strict';
// Checks the lyrics logic: LRC parsing, which LRCLIB answers are accepted, and the lookup order. Run: npm test
const assert = require('assert');
const fs = require('fs'), path = require('path');
const L = require('../lib/lyrics');

// ---- LRC parsing ----
const p = L.parseLrc('﻿[ti:Song]\r\n[ar:Someone]\n[offset:500]\n[00:12.50]First line\n[00:20.00][01:05.25]Chorus <00:20.50>with <00:21.00>word times\n[00:30:75]Colon hundredths\n[01:00.123]Milliseconds\n[00:40]\n');
assert.deepStrictEqual(p.synced.map(l => l.t), [12000, 19500, 30250, 39500, 59623, 64750]); // sorted, offset applied
assert.strictEqual(p.synced[1].text, 'Chorus with word times');   // enhanced-LRC word stamps are dropped
assert.strictEqual(p.synced[3].text, '');                         // a timed empty line marks a pause
assert.strictEqual(p.synced[5].text, 'Chorus with word times');   // two stamps, one line
assert.deepStrictEqual(L.parseLrc('Line one\n\n\nLine two\n').plain, ['Line one', '', 'Line two']);
assert.strictEqual(L.fromLrcText('[00:01.00]a\n[00:02.00]b', 't8').kind, 'synced');
assert.strictEqual(L.fromLrcText('just\nwords\nhere', 't8').kind, 'plain');
assert.strictEqual(L.fromLrcText('[ar:x]\n', 't8'), null);
assert.strictEqual(L.fromLrcText('', 't8'), null);

// the bundled preview lines parse, and are in order
const demo = L.fromLrcText(fs.readFileSync(path.join(__dirname, '..', 'samples', 'demo-lyrics.lrc'), 'utf8'), 'sample');
assert.strictEqual(demo.kind, 'synced');
assert.ok(demo.lines.length > 30 && demo.lines.every((l, i) => !i || l.t >= demo.lines[i - 1].t));

// ---- matching ----
assert.strictEqual(L.baseTitle('Deacon Blues (2023 Remaster)'), 'Deacon Blues');
assert.strictEqual(L.baseTitle('Mr. Blue Sky - 2012 Version'), 'Mr. Blue Sky');
assert.strictEqual(L.baseTitle('Hello (Goodbye)'), 'Hello (Goodbye)');               // part of the name: kept
assert.strictEqual(L.baseTitle('Song [Mono] (Live at the Roxy)'), 'Song');
assert.strictEqual(L.leadArtist('Queen feat. David Bowie'), 'Queen');
assert.strictEqual(L.fold('Beyoncé & JAY‐Z’s'), 'beyonce and jay zs');
assert.strictEqual(L.trackKey({ title: 'A', artist: 'B', album: 'C' }, 61400), 'b|a|c|61');
assert.strictEqual(L.searchable({ title: 'A', artist: '' }, 200000), false);          // radio / inputs: nothing to look up
assert.strictEqual(L.searchable({ title: 'A', artist: 'B' }, 200000), true);

const track = { title: 'Deacon Blues (Remastered)', artist: 'Steely Dan', album: 'Aja' };
const reqs = L.lrclibRequests(track, 456400);
assert.strictEqual(reqs[0], '/api/get?track_name=Deacon%20Blues%20(Remastered)&artist_name=Steely%20Dan&album_name=Aja&duration=456');
assert.strictEqual(reqs[2], '/api/search?track_name=Deacon%20Blues&artist_name=Steely%20Dan');
assert.ok(reqs.every(r => /^\/api\/(get|search)\?/.test(r)));

// ---- which LRCLIB answers are accepted ----
const rec = (o = {}) => ({ trackName: 'Deacon Blues', artistName: 'Steely Dan', albumName: 'Aja', duration: 456, instrumental: false, plainLyrics: 'one\ntwo\nthree', syncedLyrics: '[00:10.00]one\n[00:20.00]two\n[00:30.00]three', ...o });
assert.strictEqual(L.fromLrclib(rec(), track, 456400, true).kind, 'synced');
// a different cut (more than 3 s off): the timing cannot be trusted, so the words are shown untimed
const other = L.fromLrclib(rec({ duration: 470 }), track, 456400, true);
assert.strictEqual(other.kind, 'plain');
assert.ok(other.lines.every(l => l.t === null));
// search results: the wrong song and the wrong artist are refused; the closest-length synced one wins
const list = [rec({ trackName: 'Deacon Blues Brothers' }), rec({ artistName: 'A Tribute Band' }), rec({ duration: 470 }), rec({ duration: 458, syncedLyrics: '[00:11.00]right one\n[00:21.00]two' }), rec({ duration: 453.5 })];
assert.strictEqual(L.fromLrclib(list, track, 456400).lines[0].text, 'right one');
assert.strictEqual(L.fromLrclib(list.slice(0, 2), track, 456400), null);
assert.strictEqual(L.fromLrclib([], track, 456400), null);
assert.strictEqual(L.fromLrclib(rec({ instrumental: true, plainLyrics: '', syncedLyrics: '' }), track, 456400, true).kind, 'instrumental');
assert.strictEqual(L.fromLrclib(rec({ plainLyrics: null, syncedLyrics: null }), track, 456400, true), null);

// ---- the T8's own lyric ----
const state = { track: { id: 6540 }, duration: 460160 };
assert.strictEqual(L.t8LyricRequest(state, { hasLyric: false, playingMusic: {} }), null);                // the T8 says it has none: not asked
assert.strictEqual(L.t8LyricRequest({ track: { id: null }, duration: 1 }, { hasLyric: true }), null);     // not a library track (a Connect stream)
assert.strictEqual(L.t8LyricRequest(state, { hasLyric: true, duration: 460160, playingMusic: { type: 1 } }), '/ZidooMusicControl/v2/getLyric?id=6540&type=1&duration=460160&number=0');
assert.strictEqual(L.t8LyricRequest(state, { hasLyric: true, duration: 460160, playingMusic: { type: 1 }, playingTrack: { number: 7 } }), '/ZidooMusicControl/v2/getLyric?id=6540&type=1&duration=460160&number=7');
assert.strictEqual(L.t8LyricRequest(state, require('../samples/getState-dsd64-deacon-blues.json')), '/ZidooMusicControl/v2/getLyric?id=6540&type=1&duration=460160&number=0');
assert.strictEqual(L.t8LyricText('[00:01.00]a\n[00:02.00]b'), '[00:01.00]a\n[00:02.00]b');
assert.strictEqual(L.t8LyricText('{"status":806,"msg":"The resource does not exist"}'), null);
assert.strictEqual(L.t8LyricText('krc1\u0004\u0001binary'), null);
assert.strictEqual(L.t8LyricText(''), null);

// ---- lookup order ----
(async () => {
  const asked = [];
  const io = { t8: async () => { asked.push('t8'); return '[00:01.00]from\n[00:02.00]the T8'; }, lrclib: async q => { asked.push(q); return rec(); } };
  let r = await L.find(track, 456400, io, { online: true });
  assert.strictEqual(r.source, 't8');
  assert.deepStrictEqual(asked, ['t8']);                         // the T8 had it: LRCLIB is never asked

  asked.length = 0; io.t8 = async () => { asked.push('t8'); return null; };
  r = await L.find(track, 456400, io, { online: false });
  assert.strictEqual(r.kind, 'none');
  assert.deepStrictEqual(asked, ['t8']);                         // online lookup off: nothing leaves the network

  asked.length = 0;
  r = await L.find(track, 456400, io, { online: true });
  assert.strictEqual(r.source, 'lrclib');
  assert.strictEqual(asked.length, 2);                           // the exact request answered: no search needed

  asked.length = 0; io.lrclib = async q => { asked.push(q); if (q.startsWith('/api/get')) return null; if (asked.length === 3) throw new Error('offline'); return q.includes('Remastered') ? [] : [rec()]; };
  r = await L.find(track, 456400, io, { online: true });
  assert.strictEqual(r.kind, 'synced');
  assert.strictEqual(asked.length, 4);                           // get, search, search without "(Remastered)"

  asked.length = 0; io.t8 = async () => { throw new Error('T8 asleep'); }; io.lrclib = async () => { throw new Error('offline'); };
  r = await L.find(track, 456400, io, { online: true });
  assert.strictEqual(r.kind, 'none');                            // every failure ends in "no lyrics", never an error on screen

  r = await L.find({ title: 'Radio stream', artist: '' }, 0, io, { online: true });
  assert.strictEqual(r.kind, 'none');
  console.log('lyrics tests passed');
})().catch(e => { console.error(e); process.exit(1); });
