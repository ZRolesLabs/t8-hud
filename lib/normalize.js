'use strict';
const crypto = require('crypto');
// Turns the T8's raw getState payload into a clean, predictable model for the TV page.
// Field names on Eversolo/Zidoo firmware drift between versions and sources, so every
// value is read defensively and anything we can compute ourselves, we compute.

const LOSSY = /^(mp3|aac|m4a|ogg|opus|wma|vorbis)$/i;
const DSD_FILE = /^(dsf|dff|dsd|iso)$/i;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// "2.82 MHz" -> 2820000, "44.1 kHz" -> 44100, "192000" -> 192000
function parseRate(v) {
  const n = num(v);
  if (n === null || n <= 0) return null;
  const s = String(v).toLowerCase();
  if (s.includes('mhz')) return Math.round(n * 1e6);
  if (s.includes('khz') || n < 1000) return Math.round(n * 1000);
  return Math.round(n);
}

// "5.64 Mbps" -> 5640, "1411 kbps" -> 1411 (always kbps)
function parseKbps(v) {
  const n = num(v);
  if (n === null || n <= 0) return null;
  const s = String(v).toLowerCase();
  if (s.includes('mbps') || s.includes('mb/s')) return n * 1000;
  if (s.includes('bps') && !s.includes('k')) return n / 1000;
  return n;
}

// DSD rates are multiples of 44.1 kHz x 64 (2.8224 MHz)
function dsdMultiple(rateHz) {
  if (!rateHz) return null;
  const m = Math.round(rateHz / 44100);
  return [64, 128, 256, 512, 1024].includes(m) ? m : null;
}

// Streaming services the T8 can play from. The T8's own source label (playTypeSubtitle) can lag or
// stay "LOCAL" for in-app streaming, so we also look for the service in the stream's own URLs.
const SERVICES = [
  [/tidal/i, 'TIDAL'], [/qobuz/i, 'Qobuz'], [/spotify|scdn\.co/i, 'Spotify'], [/amazon|amzn/i, 'Amazon Music'],
  [/deezer|dzcdn/i, 'Deezer'], [/apple|airplay|mzstatic/i, 'AirPlay'], [/roon/i, 'Roon'], [/plex/i, 'Plex'],
  [/emby/i, 'Emby'], [/jellyfin/i, 'Jellyfin'], [/navidrome|subsonic/i, 'Navidrome'], [/jriver/i, 'JRiver'],
  [/soundcloud|sndcdn/i, 'SoundCloud'], [/youtube|ytimg|googleusercontent/i, 'YouTube Music'],
  [/radioparadise/i, 'Radio Paradise'], [/tunein|radiotime/i, 'TuneIn'], [/bluetooth/i, 'Bluetooth'],
];
const GENERIC_SOURCE = /^(local|)$/i;
function serviceIn(...vals) {
  for (const v of vals) {
    if (typeof v !== 'string' || !v) continue;
    for (const [re, name] of SERVICES) if (re.test(v)) return name;
  }
  return null;
}
// "Tidal connect" -> "TIDAL Connect"
function prettySource(sub) {
  if (!sub) return '';
  let out = sub;
  for (const [re, name] of SERVICES) out = out.replace(new RegExp('\\b' + name.split(' ')[0] + '\\b', 'i'), name.split(' ')[0]);
  return out.replace(/\bconnect\b/, 'Connect');
}
const isUrl = v => typeof v === 'string' && /^https?:\/\//i.test(v);
const isPath = v => typeof v === 'string' && /^\/[\w/.-]/.test(v) && !v.startsWith('//');
// every URL-ish string in an object (one level deep), for source sniffing
function urls(o) { return Object.values(o || {}).filter(v => typeof v === 'string' && (isUrl(v) || /:\/\//.test(v))); }

const INTERFACES = { IIS: 'I²S', I2S: 'I²S', USB: 'USB', SPDIF: 'S/PDIF', COAX: 'Coax', RCA: 'Coax', OPT: 'Optical', OPTICAL: 'Optical', AES: 'AES/EBU', XLR: 'AES/EBU', HDMI: 'HDMI' };

// "Aja (1977 Original Master · Analogue Productions SACD · DSD64)" -> name + tag parts
function splitAlbum(album) {
  const s = album || '';
  const m = s.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!m) return { name: s, tags: [] };
  return { name: m[1], tags: m[2].split(/[·|•]/).map(t => t.trim()).filter(Boolean) };
}

function provenance(tags, family, sacdArea) {
  const out = [];
  const isSacd = tags.some(t => /\bsacd\b/i.test(t));
  if (isSacd && family === 'dsd') out.push('SACD rip');
  if (isSacd && sacdArea === 1) out.push('Stereo area');
  if (isSacd && sacdArea === 2) out.push('Multichannel area');
  const label = tags.find(t => /productions|records|recordings|mofi|mobile fidelity|audio fidelity|esoteric|impex|craft/i.test(t));
  if (label) out.push(label.replace(/\s*\b(SACD|DSD\d*)\b/gi, '').trim());
  const year = tags.join(' ').match(/\b(19|20)\d\d\b/);
  if (year) out.push(`${year[0]} ${/master/i.test(tags.join(' ')) ? 'original master' : ''}`.trim());
  return out;
}

// short stable key for an art reference, so the page never sends a URL back to the bridge
function artKey(ref) { return ref.kind === 'id' && /^[\w-]{1,32}$/.test(ref.value) ? ref.value : 'x' + crypto.createHash('sha1').update(ref.kind + ':' + ref.value).digest('hex').slice(0, 20); }

function normalize(raw, now = Date.now()) {
  raw = raw || {};
  const pm = raw.playingMusic || {};
  const info = raw.everSoloPlayInfo || {};
  const ain = info.everSoloPlayAudioInfo || {};
  const aout = info.everSoloPlayOutputInfo || {};
  const vol = raw.volumeData || {};
  const dev = raw.deviceInfo || {};

  const state = raw.state === 3 ? 'playing' : raw.state === 4 ? 'paused' : 'idle';
  // souceType 3 = external input (coax/optical in): playingMusic is stale then.
  const externalInput = info.souceType === 3;

  // Who is playing? 5 = the T8's own player (local files and in-app streaming): playingMusic is live.
  // Other play types (AirPlay, Bluetooth, Spotify Connect, ...) leave playingMusic stale and put the
  // track in everSoloPlayAudioInfo instead.
  const playType = num(raw.playType ?? info.playType);
  const ainHasTrack = !!(ain.songName || ain.artistName);
  const fromAin = ainHasTrack && (playType !== 5 || !(pm.title || pm.name));
  const meta = fromAin ? { title: ain.songName, artist: ain.artistName, album: ain.albumName } : pm;

  // a connect source reporting "PCM" means the T8 only knows the decoded stream (Spotify Connect does
  // this): the real container and stream bitrate are unknown, so show neither rather than guess
  let ext = String((fromAin ? ain.audioDecodec : pm.extension) || '').toLowerCase();
  const decodedOnly = fromAin && ext === 'pcm';
  if (decodedOnly) ext = '';
  const codecRaw = String((fromAin ? ain.audioDecodec : pm.codec) || aout.outPutDecodec || '').trim();
  const pick = (...vals) => { for (const v of vals) if (v) return v; return null; };
  const rateHz = fromAin
    ? pick(parseRate(ain.audioSampleRate), parseRate(aout.outPutSampleRate))
    : pick(parseRate(pm.sampleRateNumber), parseRate(pm.sampleRate), parseRate(ain.audioSampleRate), parseRate(aout.outPutSampleRate));
  let bits = fromAin ? pick(num(ain.audioBitsPerSample), num(aout.outPutBits)) : pick(num(pm.bits), num(ain.audioBitsPerSample), num(aout.outPutBits));
  const channels = fromAin ? pick(num(ain.audioChannels), num(aout.outPutChannels)) : pick(num(pm.channels), num(ain.audioChannels), num(aout.outPutChannels));

  let family = 'pcm';
  if (DSD_FILE.test(ext) || /dsd/i.test(codecRaw)) family = 'dsd';
  else if (LOSSY.test(ext) || /aac|mp3|vorbis|opus|sbc|ldac|aptx/i.test(codecRaw)) family = 'lossy';
  if (family === 'dsd' && !bits) bits = 1;

  const dsdX = family === 'dsd' ? dsdMultiple(rateHz) : null;
  const tier = family === 'dsd' ? 'dsd' : family === 'lossy' ? 'lossy' : ((rateHz && rateHz > 48000) || (bits && bits > 16)) ? 'hires' : 'cd';

  const rawKbps = rateHz && bits && channels ? (rateHz * bits * channels) / 1000 : null;
  const ainKbps = num(ain.audioBitrate) ? (num(ain.audioBitrate) > 20000 ? num(ain.audioBitrate) / 1000 : num(ain.audioBitrate)) : null;
  const statedKbps = fromAin ? ainKbps : (parseKbps(pm.bitrate) || ainKbps);
  // no stated bitrate: the raw PCM rate is the real figure only when the stream is uncompressed
  const uncompressed = !decodedOnly && (family === 'dsd' || /^(wav|aiff?|pcm|)$/i.test(ext));
  const kbps = statedKbps || (uncompressed ? rawKbps : null);

  const outRate = num(aout.outPutSampleRate) || num(raw.currentOutput) || null;
  const outCodec = aout.outPutDecodec || null;
  const iface = INTERFACES[String(vol.volumeTag || '').toUpperCase()] || vol.volumeTag || null;

  const album = splitAlbum(meta.album);
  const fileMB = !fromAin && num(pm.fileSize) ? (String(pm.fileSize).toLowerCase().includes('gb') ? num(pm.fileSize) * 1024 : num(pm.fileSize)) : null;

  let codecLabel;
  if (family === 'dsd') codecLabel = dsdX ? `DSD${dsdX}` : 'DSD';
  else if (family === 'lossy') codecLabel = (codecRaw || ext || 'lossy').toUpperCase();
  else codecLabel = 'PCM';

  const track = externalInput ? null : {
    id: fromAin ? null : (pm.id ?? null),
    title: meta.title || meta.name || meta.songName || '',
    artist: meta.artist || meta.artistName || '',
    album: album.name || meta.albumName || '',
    albumTags: album.tags,
    provenance: provenance(album.tags, family, vol.sacdArea),
  };

  // source: the T8's own label, unless it says LOCAL while the stream's URLs name a service
  const sub = info.playTypeSubtitle || '';
  // (playingMusic only counts when it is the live track: after TIDAL Connect it still holds the last in-app stream)
  const sniffed = fromAin ? serviceIn(sub, ...urls(ain), info.icon) : serviceIn(pm.streamId, ...urls(pm), info.icon, sub);
  const label = (GENERIC_SOURCE.test(sub) && sniffed) ? sniffed : (prettySource(sub) || sniffed || null);
  const streaming = !!sniffed || fromAin;

  // cover art: the stream's own art URL first, then the T8's library art by track id
  let artRef = null;
  if (track) {
    const cands = fromAin ? [info.icon, ain.albumUrl, ain.albumArt, ain.coverUrl] : [pm.albumArt, pm.albumUrl, pm.coverUrl, pm.cover, info.icon];
    for (const c of cands) { if (isUrl(c)) { artRef = { kind: 'url', value: c }; break; } if (isPath(c)) { artRef = { kind: 'path', value: c }; break; } }
    if (!artRef && !fromAin && track.id !== null && track.id !== undefined && track.id !== '') artRef = { kind: 'id', value: String(track.id) };
  }
  const art = artRef ? '/art/' + artKey(artRef) : null;

  return {
    at: now,
    state,
    position: num(raw.position) ?? num(info.currentPosition) ?? 0,
    duration: num(raw.duration) ?? num(info.duration) ?? 0,
    source: { label, t8Label: sub || null, streaming, external: externalInput, playType, input: vol.intputTag ? String(vol.intputTag).split('-')[0] : null },
    track,
    art, artRef,
    format: {
      container: ext ? ext.toUpperCase() : null,
      family, tier, codecLabel,
      rateHz, bits, channels,
      kbps, rawKbps,
      dsdMultiple: dsdX,
      fileMB,
    },
    output: {
      codec: outCodec,
      rateHz: outRate,
      interface: iface,
      matchesSource: !!(outRate && rateHz && outRate === rateHz),
      dsdOut: !!vol.isDsdOut,
    },
    volume: { display: vol.display || null, locked: !!vol.isLock, mute: !!vol.isMute, current: num(vol.currenttVolume), max: num(vol.maxVolume) },
    flags: { eq: !!raw.eqActive, dsp: !!raw.dspActive, sub: !!raw.subActive, mqa: !!raw.mqaMode, replayGain: (!fromAin && pm.replayGain) || null },
    device: { name: dev.deviceName || null, model: dev.model || null, version: dev.version || vol.version || null },
    raw: {
      state: raw.state, playType, playTypeSubtitle: sub || undefined, extension: pm.extension, codec: pm.codec, sampleRateNumber: pm.sampleRateNumber, bits: pm.bits,
      channels: pm.channels, bitrate: pm.bitrate, fileSize: pm.fileSize, outPutDecodec: aout.outPutDecodec,
      outPutSampleRate: aout.outPutSampleRate, currentOutput: raw.currentOutput, volumeTag: vol.volumeTag,
      intputTag: vol.intputTag, display: vol.display, eqActive: raw.eqActive, dspActive: raw.dspActive,
      sacdArea: vol.sacdArea, version: dev.version,
      ...(fromAin ? { audioDecodec: ain.audioDecodec, audioSampleRate: ain.audioSampleRate, audioBitsPerSample: ain.audioBitsPerSample, note: 'track from everSoloPlayAudioInfo' } : {}),
    },
  };
}

module.exports = { normalize, parseRate, parseKbps, splitAlbum, artKey };
