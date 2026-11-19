# Security policy

T8 HUD is a small, read-only display that lives on your own network. We take its security seriously anyway, because "it's only on the LAN" is how a lot of bad things start.

## Supported versions

| Version | Supported |
| --- | --- |
| 3.0.x (current) | ✅ security fixes |
| 1.x and 2.x | ❌ please update to the latest release |

Fixes ship as a new release. The Google TV app picks it up by itself; the browser version updates by unzipping the new release over the old one.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Report it privately instead:

1. Go to the **[Security tab](https://github.com/ZRolesLabs/t8-hud/security)** of this repo.
2. Press **Report a vulnerability** (or go straight to **[the private report form](https://github.com/ZRolesLabs/t8-hud/security/advisories/new)**).
3. Tell us what you found, the version (and Google TV app or browser version), and the steps to reproduce it. A proof of concept helps, but plain words are fine.

Only the maintainer sees the report. What to expect:

- A first reply within **7 days**.
- A fix or a clear plan within **30 days** for anything real. It's a one-person lab, so a complicated one can take longer, and we'll tell you if it does.
- Credit in the release notes and the advisory, if you want it. Say so in the report.

Please give us a fair chance to ship a fix before you publish details, and don't test against anyone's network or T8 but your own.

## What's in scope

- The HUD server (`server.js`, `lib/`) and the pages it serves, including the setup page and `/api/raw`.
- The Google TV app (`android/`), including its built-in setup page and self-update.
- Anything that would let someone outside your home network reach the HUD, change its settings, or make it fetch or run something it shouldn't.
- Release integrity: a way to get a TV to install an APK that didn't come from this repo's releases.

Out of scope: the Eversolo T8 itself and its firmware (report those to Eversolo), LRCLIB's servers, the streaming services' image servers, and problems that need someone already in full control of your computer or TV.

## How T8 HUD is built (so you know what to poke at)

- **Read-only.** It reads the T8's local API (port 9529) and never sends the player a command.
- **No accounts, no cloud sign-in, no tracking, no telemetry, no ads, no analytics.** There is nothing to log in to and nothing that phones home about you.
- **Your network only.** The HUD and setup page listen on port 8080 for your home network. There is no login on the setup page by design; it only changes how the HUD looks, and changes are only accepted from local addresses. Don't forward port 8080 to the internet.
- **The only internet traffic:** cover art for streamed tracks (from the streaming service's own image server), the Google TV app's update check against this repo's GitHub Releases, and, only if you switch it on, the lyrics lookup.
- **Lyrics are off by default.** The online lookup on [LRCLIB](https://lrclib.net) is a second switch, also off by default. When on, it sends only the track's title, artist, album and length, once per track, with no ID or cookies.
- **No npm dependencies.** The server is plain Node.js, so there's no package supply chain to inherit.

Un-enshittified on purpose. If you find a way it isn't, we want to hear about it.
