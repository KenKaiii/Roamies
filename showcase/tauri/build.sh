#!/bin/bash
# Syncs the shared web files into dist/, then bundles with the Tauri CLI.
# ./build.sh        release bundle (Roamies.app on macOS, the installer on Windows, .AppImage/.deb/.rpm on Linux)
# ./build.sh dev    debug binary only, faster
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist
cp ../desktop.html dist/
cp -R ../roamies ../onboarding ../panel dist/
../tauri/sidecar/bundle.sh
# Ship a Node.js runtime with the app, for the target being built (--target <triple>, else this machine).
TARGET=""; prev=""; for a in "$@"; do [ "$prev" = "--target" ] && TARGET="$a"; prev="$a"; done
MODE="${1:-}"; [ $# -gt 0 ] && shift
../tauri/sidecar/fetch-node.sh ${TARGET:+"$TARGET"}
# Windows helpers: voice (Parakeet speech on the PC) and hands (windows, capture, UI Automation, OCR); macOS
# builds its Swift twins in build.rs. Linux has the voice helper only (the same Rust one as Windows).
# Always optimised: a debug voice build is far too slow at reading speech.
TRIPLE="${TARGET:-$(rustc -vV | sed -n 's/^host: //p')}"
# The voice helper loads Microsoft's ONNX Runtime, shipped beside it (fetch-onnxruntime.sh says why).
case "$TRIPLE" in *-windows-*|*-linux-*) ./fetch-onnxruntime.sh "$TRIPLE" ;; esac
case "$TRIPLE" in
  *-windows-*)
    mkdir -p src-tauri/binaries
    # ONNX Runtime in the voice helper needs the Visual C++ runtime, which a fresh Windows can lack (#121): it's
    # installed beside the helpers (app-local, as Microsoft allows), copied from this build machine.
    mkdir -p src-tauri/vcruntime
    sys32="$(cygpath -u "${SYSTEMROOT:-C:\\Windows}")/System32"
    for dll in msvcp140.dll msvcp140_1.dll vcruntime140.dll vcruntime140_1.dll; do cp "$sys32/$dll" src-tauri/vcruntime/; done
    for h in voice hands; do
      cargo build --release --locked --manifest-path "src-tauri/$h-win/Cargo.toml" --target "$TRIPLE"
      cp "src-tauri/$h-win/target/$TRIPLE/release/roamies-$h.exe" "src-tauri/binaries/roamies-$h-$TRIPLE.exe"
    done ;;
  *-linux-*)
    mkdir -p src-tauri/binaries
    cargo build --release --locked --manifest-path src-tauri/voice-win/Cargo.toml --target "$TRIPLE"
    cp "src-tauri/voice-win/target/$TRIPLE/release/roamies-voice" "src-tauri/binaries/roamies-voice-$TRIPLE"
    # The hands helper is a Python script (hands-linux/README.md says what it needs). Tauri bundles it as an
    # external binary, and in dev it goes beside the debug app, which is where the app looks for it.
    install -m 755 src-tauri/hands-linux/roamies-hands "src-tauri/binaries/roamies-hands-$TRIPLE"
    if [ "$MODE" = dev ]; then
      DEV="src-tauri/target/debug"; [ -n "$TARGET" ] && DEV="src-tauri/target/$TARGET/debug"
      mkdir -p "$DEV"
      install -m 755 src-tauri/hands-linux/roamies-hands "$DEV/roamies-hands"
    fi ;;
esac
cd src-tauri
# macOS signing: APPLE_SIGNING_IDENTITY if set, else the first Developer ID Application certificate in
# the keychain, else ad-hoc. A stable identity keeps macOS permissions across rebuilds.
if [ "$(uname)" = "Darwin" ] && [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)"
  export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
fi
# Linux: build the GTK layer-shell overlay host. It's one of this package's binaries (src/bin), so Cargo leaves it
# beside the app binary, which is where the app looks for it, and Tauri bundles it with the app (not as an external
# binary too: rpm refuses the same file twice).
case "$TRIPLE" in
  *-linux-*)
    if [ "$MODE" = dev ]; then
      cargo build --locked ${TARGET:+--target "$TARGET"} --bin roamies-overlay
    else
      cargo build --release --locked ${TARGET:+--target "$TARGET"} --bin roamies-overlay
    fi ;;
esac
# ./build.sh release --target <triple> builds for one target (used by the release workflow).
if [ "$MODE" = "dev" ]; then cargo build; else cargo tauri build ${TAURI_BUNDLES:+--bundles $TAURI_BUNDLES} "$@"; fi
