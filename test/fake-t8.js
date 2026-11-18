'use strict';
// A stand-in T8 for testing the bridge without the hardware: serves a captured payload
// and the demo cover the same quirky way the real T8 does (JPEG with no Content-Type).
//   node test/fake-t8.js            local DSD64 file (library art by track id)
//   SAMPLE=tidal|spotify node test/fake-t8.js   TIDAL / Spotify Connect (stream cover URL; pointed back at this
//                                       fake so the test needs no internet)
//   LYRICS=1 node test/fake-t8.js   also answers getLyric the way the T8 does (the lyric file as plain LRC text),
//                                   with the sample lines from samples/demo-lyrics.lrc
//   POSITION=200 sets where in the track (seconds) the fake starts playing; TITLE="..." swaps the track title
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = Number(process.env.FAKE_PORT || 19529);
const SAMPLES = { local: 'getState-dsd64-deacon-blues.json', tidal: 'getState-tidal-connect-flac.json', spotify: 'getState-spotify-connect.json' };
let text = fs.readFileSync(path.join(__dirname, '..', 'samples', SAMPLES[process.env.SAMPLE || 'local']), 'utf8');
text = text.replace(/https:\/\/(resources\.tidal\.com\/images|i\.scdn\.co\/image)\/[^"]+/g, `http://127.0.0.1:${PORT}/cover.jpg`);
const raw = JSON.parse(text);
const cover = fs.readFileSync(path.join(__dirname, '..', 'samples', 'demo-cover.jpg'));
if (process.env.POSITION) raw.position = Number(process.env.POSITION) * 1000;
if (process.env.TITLE) { if (raw.playType === 5) raw.playingMusic.title = process.env.TITLE; else raw.everSoloPlayInfo.everSoloPlayAudioInfo.songName = process.env.TITLE; }
const lyric = process.env.LYRICS ? fs.readFileSync(path.join(__dirname, '..', 'samples', 'demo-lyrics.lrc')) : null;
raw.hasLyric = !!lyric && !!(raw.playingMusic && raw.playType === 5);
const start = Date.now() - raw.position;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/ZidooMusicControl/v2/getState') {
    raw.position = (Date.now() - start) % raw.duration;
    res.end(JSON.stringify(raw));
  } else if ((u.pathname === '/ZidooMusicControl/v2/getImage' && u.searchParams.get('type') === '0') || u.pathname === '/cover.jpg') {
    res.end(cover);
  } else if (u.pathname === '/ZidooMusicControl/v2/getLyric' && lyric && u.searchParams.get('id') === String(raw.playingMusic.id)) {
    res.end(lyric);
  } else res.end('{"status":806,"msg":"The resource does not exist"}');
}).listen(PORT, () => console.log('fake T8 on', PORT));
