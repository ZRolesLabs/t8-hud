# App icon and TV banner

`icons.js` holds the SVG sources (option C = the shipped icon and banner: Z Labs flask with "T8 HUD" in the cyan Labs badge, the same pill as Labs Browser "WEB").
`render.js` renders them to PNG with Playwright. Copy `BigShouldersDisplay.woff2` and `JetBrainsMono.woff2`
from `public/fonts/` next to the scripts, then for example:

    node render.js '[["icons.C",192,192,"ic_launcher.png"],["banners.C",320,180,"banner.png"]]'

## README / docs header

`readme-header.html` is the source of `docs/brand/zroleslabs-header.png` (the logo banner at the top of the README, the release notes and the issue forms). Render it at 1200×300, scale 2, with a transparent background.
