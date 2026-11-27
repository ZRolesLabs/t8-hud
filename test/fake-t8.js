'use strict';
// A stand-in T8 for testing the bridge without the hardware: serves a captured payload
// and the demo cover the same quirky way the real T8 does (JPEG with no Content-Type).
//   node test/fake-t8.js            local DSD64 file (library art by track id)
//   SAMPLE=tidal|spotify node test/fake-t8.js   TIDAL / Spotify Connect (stream cover URL; pointed back at this
//                                       fake so the test needs no internet)
//   LYRICS=1 node test/fake-t8.js   also answers getLyric the way the T8 does (the lyric file as plain LRC text),
//                                   with the sample lines from samples/demo-lyrics.lrc
//   SAMPLE=dlna node test/fake-t8.js   a Windows "Cast to device" DLNA cast; also runs the T8's UPnP renderer on
//                                   :1848 (description.xml + GetPositionInfo) so the bridge can read the format
//   POSITION=200 sets where in the track (seconds) the fake starts playing; TITLE="..." swaps the track title
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = Number(process.env.FAKE_PORT || 19529);
const SAMPLES = { dlna: 'getState-dlna-windows-lpcm.json', local: 'getState-dsd64-deacon-blues.json', tidal: 'getState-tidal-connect-flac.json', spotify: 'getState-spotify-connect.json' };
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

if (process.env.SAMPLE === 'dlna') {
  const soap = fs.readFileSync(path.join(__dirname, '..', 'samples', 'upnp-positioninfo-windows-lpcm.xml'));
  const desc = '<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Fake T8</friendlyName><serviceList>'
    + '<service><serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType><controlURL>/ConnectionManager/0/control.xml</controlURL></service>'
    + '<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/AVTransport/0/control.xml</controlURL></service>'
    + '</serviceList></device></root>';
  http.createServer((req, res) => {
    if (req.url === '/description.xml') { res.writeHead(200, { 'Content-Type': 'text/xml' }); return res.end(desc); }
    if (req.method === 'POST' && req.url === '/AVTransport/0/control.xml' && /GetPositionInfo/.test(req.headers.soapaction || '')) { res.writeHead(200, { 'Content-Type': 'text/xml' }); return res.end(soap); }
    res.writeHead(404); res.end();
  }).listen(1848, () => console.log('fake T8 UPnP renderer on :1848'));
}
