'use strict';
// Checks the normalizer against a real T8 payload plus a few edge cases. Run: npm test
const assert = require('assert');
const { normalize, parseRate, parseKbps } = require('../lib/normalize');
const raw = require('../samples/getState-dsd64-deacon-blues.json');

const s = normalize(raw, 0);
assert.strictEqual(s.state, 'playing');
assert.strictEqual(s.track.title, 'Deacon Blues');
assert.strictEqual(s.track.album, 'Aja');
assert.deepStrictEqual(s.track.provenance, ['SACD rip', 'Stereo area', 'Analogue Productions', '1977 original master']);
assert.strictEqual(s.format.family, 'dsd');
assert.strictEqual(s.format.codecLabel, 'DSD64');
assert.strictEqual(s.format.rateHz, 2822400);
assert.strictEqual(s.format.bits, 1);
assert.strictEqual(s.format.tier, 'dsd');
assert.strictEqual(Math.round(s.format.rawKbps), 5645);
assert.strictEqual(s.output.interface, 'I²S');
assert.strictEqual(s.output.matchesSource, true);
assert.strictEqual(s.flags.eq, true);
assert.strictEqual(s.art, '/art/6540');

assert.strictEqual(parseRate('44.1 kHz'), 44100);
assert.strictEqual(parseRate('2,82 MHz'), 2820000); // French-style decimal comma
assert.strictEqual(parseRate('192000'), 192000);
assert.strictEqual(parseKbps('1411 kbps'), 1411);

const cd = normalize({ state: 3, playingMusic: { title: 'x', extension: 'flac', sampleRateNumber: '44100', bits: '16', channels: 2 } });
assert.strictEqual(cd.format.tier, 'cd');
assert.strictEqual(Math.round(cd.format.rawKbps), 1411);
assert.strictEqual(cd.format.kbps, null); // FLAC with no stated bitrate: unknown, not the raw rate
const hr = normalize({ state: 3, playingMusic: { title: 'x', extension: 'flac', sampleRate: '192 kHz', bits: '24', channels: 2 } });
assert.strictEqual(hr.format.tier, 'hires');
const ext = normalize({ state: 3, playingMusic: { title: 'stale' }, everSoloPlayInfo: { souceType: 3, playTypeSubtitle: 'Coaxial In' } });
assert.strictEqual(ext.track, null);
assert.strictEqual(normalize({}).state, 'idle');

// TIDAL Connect (captured 2026-11-04): playType 6, the live track is in everSoloPlayAudioInfo and
// playingMusic still holds an older in-app TIDAL track that must not be shown
const tc = normalize(require('../samples/getState-tidal-connect-flac.json'), 0);
assert.strictEqual(tc.source.label, 'TIDAL Connect');
assert.strictEqual(tc.track.title, 'Bloody Well Right');
assert.strictEqual(tc.track.artist, 'Supertramp');
assert.strictEqual(tc.track.album, 'Crime Of The Century');
assert.strictEqual(tc.artRef.kind, 'url');
assert.ok(tc.artRef.value.includes('9c342e3c'));
assert.ok(/^\/art\/x[0-9a-f]{20}$/.test(tc.art));
assert.strictEqual(tc.format.container, 'FLAC');
assert.strictEqual(tc.format.rateHz, 192000);
assert.strictEqual(tc.format.bits, 24);
assert.strictEqual(tc.format.tier, 'hires');
assert.strictEqual(tc.format.kbps, null); // T8 gives no bitrate here: show nothing rather than the raw PCM rate
assert.strictEqual(tc.format.rawKbps, 9216);
assert.strictEqual(tc.format.fileMB, null);
assert.strictEqual(tc.output.matchesSource, true);

// TIDAL inside the T8's own player: playType 5, T8 says LOCAL, the stream URLs say TIDAL
const inApp = JSON.parse(JSON.stringify(require('../samples/getState-tidal-connect-flac.json')));
inApp.playType = 5; inApp.everSoloPlayInfo.playType = 5; inApp.everSoloPlayInfo.playTypeSubtitle = 'LOCAL';
inApp.everSoloPlayInfo.everSoloPlayAudioInfo = {};
const ia = normalize(inApp, 0);
assert.strictEqual(ia.source.label, 'TIDAL');
assert.strictEqual(ia.track.title, 'Ahead By A Century');
assert.ok(ia.artRef.value.includes('bf634daa'));
assert.strictEqual(Math.round(ia.format.kbps), 926);
assert.strictEqual(ia.format.bits, 16);

// AirPlay / Bluetooth style: track only in everSoloPlayAudioInfo, art as a path on the T8
const ap = normalize({ state: 3, playType: 4, playingMusic: { title: 'stale', id: 9 }, everSoloPlayInfo: { playTypeSubtitle: 'AirPlay', icon: '/ZidooMusicControl/v2/getAirplayImage?x=1', everSoloPlayAudioInfo: { songName: 'Live', artistName: 'Someone', audioSampleRate: 44100, audioBitsPerSample: 16, audioChannels: 2, audioDecodec: 'ALAC' } } }, 0);
assert.strictEqual(ap.track.title, 'Live');
assert.strictEqual(ap.artRef.kind, 'path');
assert.strictEqual(ap.source.label, 'AirPlay');

// Spotify Connect (captured 2026-11-04): playType 6, T8 reports only the decoded PCM, cover on i.scdn.co
const sp = normalize(require('../samples/getState-spotify-connect.json'), 0);
assert.strictEqual(sp.source.label, 'Spotify Connect');
assert.strictEqual(sp.track.title, 'Action');
assert.strictEqual(sp.track.artist, 'Streetheart');
assert.ok(sp.artRef.value.startsWith('https://i.scdn.co/'));
assert.strictEqual(sp.format.rateHz, 44100);
assert.strictEqual(sp.format.bits, 16);
assert.strictEqual(sp.format.container, null);
assert.strictEqual(sp.format.kbps, null);
assert.strictEqual(Math.round(sp.format.rawKbps), 1411);
console.log('normalize: all checks passed');
