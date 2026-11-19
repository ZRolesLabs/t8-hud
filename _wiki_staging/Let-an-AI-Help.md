<p align="center"><img src="https://raw.githubusercontent.com/ZRolesLabs/t8-hud/main/docs/wiki/banner-ai.png" alt="Let an AI help" width="100%"></p>

Not a settings person? Hand the job to an AI assistant, like [Claude](https://claude.ai/). Pick the prompt for the version you want, copy it, paste it in, and it walks you through every step, one at a time, waiting for you after each one.

> [!TIP]
> If the assistant can't open web pages, it will say so. Paste it the matching wiki page ([Install on Google TV](Install-on-Google-TV) or [Browser version](Browser-Version)) and carry on.

## ▸ Google TV app

```text
I want to install the T8 HUD Google TV app (https://github.com/ZRolesLabs/t8-hud),
a read-only "now playing" display for my Eversolo T8. It's not on the Play
Store: it's sideloaded from GitHub Releases with the Downloader app.

My TV device is: [e.g. Google TV Streamer / Chromecast with Google TV / Sony TV]
  (if I left this blank, ask me first)

Read the "Google TV app" section of the repo's README first and follow it.
If you can't open web pages, say so and I'll paste that section in for you.

I'm not technical. Walk me through it ONE step at a time and wait for my
reply after each step. Start every step with the device it happens on,
e.g. "[TV]" or "[Phone]". Give exact menu names and the exact text to type,
never "something like". Menu names differ a bit between TV models: if what
I see doesn't match, ask me to describe or photograph the screen.

Steps to cover:
1. Install Downloader by AFTVnews from the Play Store on the TV (NOT the
   lookalikes such as "Downloader TV: APK Installer").
2. Turn on developer mode (About → Android TV OS build, 7 presses).
3. Allow Downloader under Unknown sources (called "Install unknown apps" on
   some TVs).
4. Download and install the APK from the README's address.
5. Open T8 HUD and check it finds my T8 (the T8 must be on, not in standby).
6. Show me how to open the setup page from my phone (press OK on the
   remote, pick Settings, then scan the QR code with my phone camera; the phone must be on
   the same Wi-Fi as the TV).

If the app can't find the T8, check the README's Troubleshooting section,
then ask me what the screen says before guessing.
```

## ▸ Browser version (always-on computer)

Fill in the two blanks if you know them; if not, leave them and the assistant will ask you.

```text
I want to install T8 HUD (https://github.com/ZRolesLabs/t8-hud), a read-only
"now playing" display for my Eversolo T8 that shows in my TV's web browser.

My always-on computer is: [Windows 11 / macOS / Raspberry Pi / Linux]
  (if I left this blank, ask me before step 1)
My TV device and browser is: [e.g. Google TV with TV Bro]
  (if I left this blank, ask me before step 5)

Read the repo's README first and follow it. Its commands are tested.

I'm not technical. Please walk me through it ONE step at a time and wait
for my reply after each step. Start every step with the device it happens
on, e.g. "[PC]" or "[TV]". Give exact clicks and copy-paste
commands, never "something like". Warn me clearly before any step that
needs an administrator / sudo window. Don't ask me for IP addresses: the
HUD finds the T8 itself and prints the address for the TV.

Steps to cover:
1. Install Node.js (LTS) and download and unzip the repo into a folder
   called t8hud.
2. Run node server.js in that folder and read me the "On the TV, open"
   address it prints.
3. Open http://localhost:8080/setup on the same computer. If my T8 isn't
   connected yet, press Find my T8 and Save. Everything else is optional.
4. Make it start at boot, using the README's "Run it at boot" recipe for
   my computer. First stop the copy from step 2 (Ctrl+C in that window),
   or the two will fight over port 8080. Allow port 8080 through the
   firewall for my local network only, and stop the computer from going
   to sleep (the recipe covers both).
5. Only now, on the TV: type the "Open this on your TV" address into
   the TV's browser. Steps 1 to 4 all happen on the computer.
6. Help me stop the TV or TV box from sleeping or going to its
   screensaver (see the README's Troubleshooting section).

If anything goes wrong at any step (T8 not found, TV can't connect,
screen goes dark, page freezes), check the README's Troubleshooting
section first, then ask me to paste the exact output before guessing.
```

## ▸ Stuck halfway?

Ask the assistant to check [Troubleshooting](Troubleshooting) with you, or bring the question to **[Discussions → Help](https://github.com/ZRolesLabs/t8-hud/discussions)**. Humans welcome too.
