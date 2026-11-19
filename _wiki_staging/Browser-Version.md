<p align="center"><img src="https://raw.githubusercontent.com/ZRolesLabs/t8-hud/main/docs/wiki/banner-browser.png" alt="Browser version" width="100%"></p>

A tiny server on an always-on computer, and **any web browser at home shows the HUD**: a TV, tablet, phone or laptop. No npm packages, no accounts, fonts bundled.

> 🤖 Not a command-line person? [Let an AI install it for you](Let-an-AI-Help#browser-version-always-on-computer).

## ▸ What you need

- An **Eversolo T8** (the T10 and other Eversolo players very likely work too, see [Works with](Works-With#other-eversolo-players)).
- An **always-on computer** on the same network (Windows, Mac, Linux or a Raspberry Pi) with **Node.js 18 or newer**. The HUD uses almost no CPU, so an old laptop, a mini PC in the media cabinet or a Pi is plenty.
- A **screen with a web browser**: TV Bro on Google TV, the TV's own browser, or a tablet's browser.

## ▸ Quick start

You don't need to know any IP addresses. The HUD finds your T8 by itself and tells you what to type on the TV. Steps 1 to 4 happen on the computer; the TV only ever opens the final address.

1. Install **Node.js** (the LTS version from [nodejs.org](https://nodejs.org)).
2. Download the repo (green **Code** button → **Download ZIP**), unzip it, and rename the folder to `t8hud`, for example `C:\t8hud`.
3. Start it from that folder:
   ```
   node server.js
   ```
   It prints the address to use, for example `On the TV, open: http://192.168.1.20:8080`.
4. On that same computer, open `http://localhost:8080/setup`. If the T8 isn't found yet, press **Find my T8**, pick it, and press **Save**. Everything else is optional.
5. The top of the setup page shows **Open this on your TV**. Type that address into your TV's browser. Done.

> [!TIP]
> Give the T8 a static IP or a router reservation. The HUD finds the T8 again by itself if its address changes, but a fixed address means no gap while it searches.

**"Same network" means the same subnet.** Find my T8 checks every address on the computer's own network, so it won't reach a T8 on a guest Wi-Fi, a separate VLAN, or a Wi-Fi with client / AP isolation on. If it finds nothing, type the T8's address by hand (the T8 shows it under Settings → Network Settings).

No T8 handy? `node server.js --demo` replays a recorded T8.

## ▸ Run it at boot

<details>
<summary><b>🪟 Windows</b> (scheduled task + LAN-only firewall rule)</summary>

In an **administrator** PowerShell (🔴 PowerShell (Admin)), with the HUD in `C:\t8hud`:

```powershell
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"`"$node`" server.js >> C:\t8hud\hud.log 2>&1`"" -WorkingDirectory "C:\t8hud"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName "T8 HUD" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
New-NetFirewallRule -DisplayName "T8 HUD (LAN only)" -Direction Inbound -Protocol TCP -LocalPort 8080 -RemoteAddress LocalSubnet -Action Allow -Profile Any
Start-ScheduledTask -TaskName "T8 HUD"
```

The firewall rule matters: Windows often marks home Ethernet as a *Public* network, and without the rule the TV can't connect. It only allows devices on your own subnet.

**Stop Windows sleeping:** Settings → System → Power (or Power & battery) → Screen and sleep → every "put my device to sleep" option to **Never**. The screen can still turn off.

**Update later:** unzip the new version over `C:\t8hud`, then in an admin PowerShell:

```powershell
Stop-Process -Name node -Force; Start-ScheduledTask "T8 HUD"
```
</details>

<details>
<summary><b>🍓 Raspberry Pi / Linux</b> (systemd)</summary>

With the HUD unzipped to `~/t8hud`, paste this into a terminal (it asks for your password once, for `sudo`):

```bash
sudo tee /etc/systemd/system/t8hud.service > /dev/null <<EOF
[Unit]
Description=T8 HUD
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$HOME/t8hud
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now t8hud
systemctl status t8hud --no-pager
```

The last line should say `active (running)`. The log is at `journalctl -u t8hud`.

- **Firewall:** Raspberry Pi OS has none switched on. With `ufw`, allow your own network only, for example `sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp`.
- **Sleep:** a Pi never sleeps. On a Linux desktop or laptop: `sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target`.
- **Update later:** unzip over `~/t8hud`, then `sudo systemctl restart t8hud`.
</details>

<details>
<summary><b>🍎 Mac</b> (launchd, untested by the author, reports welcome)</summary>

With the HUD unzipped to `~/t8hud`, paste this into Terminal:

```bash
cat > ~/Library/LaunchAgents/com.t8hud.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.t8hud</string>
  <key>ProgramArguments</key><array><string>$(command -v node)</string><string>server.js</string></array>
  <key>WorkingDirectory</key><string>$HOME/t8hud</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/t8hud/hud.log</string>
  <key>StandardErrorPath</key><string>$HOME/t8hud/hud.log</string>
</dict></plist>
EOF
launchctl load ~/Library/LaunchAgents/com.t8hud.plist
```

- It starts when you log in, so turn on automatic login (System Settings → Users & Groups) if the Mac restarts on its own.
- **Firewall:** if macOS asks whether `node` may accept incoming connections, click **Allow**.
- **Sleep:** `sudo pmset -a sleep 0`, or on a laptop, System Settings → Battery → Options → "Prevent automatic sleeping on power adapter when the display is off".
- **Update later:** unzip over `~/t8hud`, then `launchctl unload` and `launchctl load` the plist above.
</details>

## ▸ Tablets, phones and laptops

Any browser at home can show the HUD at `http://<computer-IP>:8080`. The screen is a fixed 16:9 frame that scales to fit.

| Screen | Tip |
| --- | --- |
| **Tablet, landscape** | Looks just like the TV. Set screen timeout to **Never** (or "stay awake while charging") and use full screen or **Add to Home screen** to hide the address bar. |
| **Phone, portrait** | Works, with black bars top and bottom. |
| **Laptop / PC** | The mouse pointer hides after 3 seconds and comes back when you move it. |

## ▸ On the TV

Every setting lives on the [setup page](Setup-Page), so there are no remote shortcuts to learn (TV browsers all handle remote keys differently). With nothing playing for a while, the page goes to **Night** by itself. It shifts a few pixels every few minutes to protect OLED panels, reconnects by itself after a network blip, and reloads by itself after you update the HUD.

<p align="right"><b><a href="Setup-Page">Next: The setup page ▸</a></b></p>
