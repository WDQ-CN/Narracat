# Build Assets

Assets consumed by Electron packaging.

- `icon.svg`: source NarraCat app icon mark.
- `icon.iconset/`: macOS iconset PNGs generated from `icon.svg`.
- `icon.icns`: packaged macOS app icon referenced by `package.json` `build.mac.icon`.

The app icon uses a pure white rounded background behind the NarraCat mark so Finder, Dock, and DMG views do not render it on a gray system tile.

The iconset follows the macOS `.iconset` naming convention:

- 16, 32, 128, 256, and 512 point images.
- 1x and 2x PNGs for each point size, including a 1024x1024 `icon_512x512@2x.png`.
