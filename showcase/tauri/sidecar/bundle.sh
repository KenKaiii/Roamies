#!/bin/bash
# Bundles the sidekick brain into dist/ so the app ships one JS file instead of node_modules.
# Optional voice deps stay external (never loaded); zstd-wasm loads its .wasm from disk, so it's copied.
set -euo pipefail
cd "$(dirname "$0")"
# esbuild: $ESBUILD, then PATH, then a local install, then a GG Coder checkout's copy.
ES="${ESBUILD:-$(command -v esbuild || ls node_modules/.bin/esbuild 2>/dev/null || ls -d "$HOME"/Documents/UnstableMind/gg-coder/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | tail -1)}"
[ -x "$ES" ] || { echo "esbuild not found; set ESBUILD=/path/to/esbuild" >&2; exit 1; }
rm -rf dist && mkdir -p dist/node_modules/@bokuweb
"$ES" sidekick.mjs --bundle --platform=node --format=esm --target=node22 --outfile=dist/sidekick.mjs \
  --external:@huggingface/transformers --external:ogg-opus-decoder --external:@bokuweb/zstd-wasm \
  --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  --log-level=warning
cp -R node_modules/@bokuweb/zstd-wasm dist/node_modules/@bokuweb/
echo '{"type":"module"}' > dist/package.json
