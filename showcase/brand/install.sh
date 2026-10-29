#!/bin/bash
# Installs brand art downloaded from render.html into the Tauri app.
# Usage: ./install.sh <folder with icon-{16,32,64,128,256,512,1024}.png and dmg-background{,@2x}.png>
set -euo pipefail
SRC="${1:?usage: ./install.sh <download folder>}"
cd "$(dirname "$0")/../tauri/src-tauri"
for s in 16 32 64 128 256 512 1024; do [ -f "$SRC/icon-$s.png" ] || { echo "missing $SRC/icon-$s.png" >&2; exit 1; }; done

# Base set (Windows Square*Logo, ico fallback), then the hand-tuned sizes on top.
cargo tauri icon "$SRC/icon-1024.png" -o icons >/dev/null
rm -rf icons/android icons/ios
cp "$SRC/icon-32.png" icons/32x32.png
cp "$SRC/icon-64.png" icons/64x64.png
cp "$SRC/icon-128.png" icons/128x128.png
cp "$SRC/icon-256.png" icons/128x128@2x.png
cp "$SRC/icon-512.png" icons/icon.png

# macOS .icns from the per-size renders (16-64 use the simplified blob that stays readable).
SET="$(mktemp -d)/icon.iconset"; mkdir -p "$SET"
for pair in 16:16x16 32:16x16@2x 32:32x32 64:32x32@2x 128:128x128 256:128x128@2x 256:256x256 512:256x256@2x 512:512x512 1024:512x512@2x; do
  cp "$SRC/icon-${pair%%:*}.png" "$SET/icon_${pair#*:}.png"
done
iconutil -c icns "$SET" -o icons/icon.icns

# Windows .ico from the same renders, if Pillow is around (otherwise Tauri's generated one stays).
python3 - "$SRC" <<'PY' || echo "Pillow not found: kept the generated icon.ico"
import sys
from PIL import Image
s = sys.argv[1]
imgs = [Image.open(f'{s}/icon-{n}.png').convert('RGBA') for n in (16, 32, 64, 128, 256)]
imgs.insert(1, imgs[1].resize((24, 24), Image.LANCZOS)); imgs.insert(3, imgs[3].resize((48, 48), Image.LANCZOS))
imgs[-1].save('icons/icon.ico', format='ICO', sizes=[(i.width, i.height) for i in imgs], append_images=imgs[:-1])
PY

# DMG background: 1x + 2x in one TIFF so Finder picks the sharp one on Retina.
mkdir -p dmg
tiffutil -cathidpicheck "$SRC/dmg-background.png" "$SRC/dmg-background@2x.png" -out dmg/background.tiff
echo "Installed. Rebuild with: cd showcase/tauri && TAURI_BUNDLES=app,dmg ./build.sh"
