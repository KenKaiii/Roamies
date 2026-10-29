# Brand art

The app icon and the DMG installer background, drawn with the Sidekick's own LED-dither renderer so
they match the app.

1. Open `render.html` in a browser and download every image into one folder.
2. Run `./install.sh <that folder>` (macOS: needs the Tauri CLI, `iconutil` and `tiffutil`).
3. Rebuild: `cd ../tauri && TAURI_BUNDLES=app,dmg ./build.sh`.

Notes:

- Icon sizes 16–64 px use a simplified glowing blob, because the dithered LED face turns to noise
  that small.
- Finder always draws DMG icon labels in black and has no setting for it, so the background puts a
  lit name plate behind each label. Its position assumes the icon spots in
  `tauri/src-tauri/tauri.macos.conf.json`; move both together.
