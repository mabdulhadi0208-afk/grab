# Grab

Download any app without the browser. Search, hit **Get**, done.

Grab is part of the Lumen family. Since 2.2 it wears the family's calm Maison look: warm paper in light mode, deep ink in dark mode, Instrument Serif titles, hairlines and one quiet emerald accent, with a flow hover on every button and Lumen's press springs (`src/ui/jelly.js` is Lumen's `ui/jelly.js`, unchanged). Right-click any app, press ? for every shortcut, drop a download link on the window, and take your settings to another computer with Export and Import.

- **Mac** (Apple Silicon): pulls from Homebrew's public catalog of 7,000+ apps. Each entry has the vendor's official download link and, for most apps, a checksum. Grab downloads the app, checks the checksum, opens the DMG/zip and drops the app into `/Applications`. Homebrew itself isn't needed.
- **Windows 10/11**: searches the official winget catalog (the same index Microsoft's package manager uses) and installs silently through `winget`, which checks each installer's hash.
- **Updates**: finds apps you already have that are out of date. You can update them one at a time or all at once.
- **Paste a link**: paste any direct download link (.dmg, .zip, .pkg, .exe, .msi) and Grab downloads and installs it.
- Grab updates itself. Every release has to pass a CI gate before it ships: the real app installs real apps, then updates itself and must stay running afterwards.

## Download

- Mac: https://github.com/mabdulhadi0208-afk/grab/releases/latest/download/Grab-mac-arm64.dmg. Drag Grab to Applications, then right-click → Open the first time.
- Windows: https://github.com/mabdulhadi0208-afk/grab/releases/latest/download/Grab-win-x64.exe. If SmartScreen appears, click More info → Run anyway.

## Dev

```
npm install
npm start          # run the app
npm test           # unit tests (no Electron needed)
xvfb-run -a npx electron scripts/shots.js --no-sandbox   # screenshots of every screen, light and dark, with sample data
xvfb-run -a npx electron scripts/ui-test.js --no-sandbox # flow-hover contrast on every screen, light and dark, plus the 2.2 features
xvfb-run -a npx electron scripts/perf.js --no-sandbox    # first card, section switch and scroll frame times (GRAB_UI=<dir> measures another copy)
```

Pushing to `main` builds the Mac DMG and Windows installer, runs the release gate, and publishes a GitHub release tagged with the version from `package.json`. Bump the version before every release.
