#!/bin/bash
# Syncs the shared web files into dist/, then bundles with the Tauri CLI.
# ./build.sh        release bundle (Roamies.app on macOS, .msi/.exe on Windows, .deb/.AppImage on Linux)
# ./build.sh dev    debug binary only, faster
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist
cp ../desktop.html dist/
cp -R ../roamies dist/
../tauri/sidecar/bundle.sh
cd src-tauri
if [ "${1:-}" = "dev" ]; then cargo build; else cargo tauri build ${TAURI_BUNDLES:+--bundles $TAURI_BUNDLES}; fi
