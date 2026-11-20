#!/bin/bash
# Puts Microsoft's ONNX Runtime at src-tauri/onnxruntime/ for the voice helper, which loads it at run time (#128):
# Microsoft's build picks its fast paths (AVX2, AVX-512) by CPU when it runs, so it also works on CPUs without AVX2,
# unlike the prebuilt one the ort crate links by default. Taken from Microsoft's official NuGet package (one package
# for every platform), checked against a pinned SHA-256.
# ./fetch-onnxruntime.sh [target-triple]   (default: this machine's)
set -euo pipefail
cd "$(dirname "$0")"
ORT_VERSION="1.31.0"
NUPKG_SHA256="7e35fdb4f5adb62f01e60798e2e5ed05108f5fbbe1cca03fbcc37903cf7c5e3b"
TRIPLE="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
case "$TRIPLE" in
  x86_64-pc-windows-msvc) RID="win-x64"; LIB="onnxruntime.dll" ;;
  aarch64-pc-windows-msvc) RID="win-arm64"; LIB="onnxruntime.dll" ;;
  x86_64-unknown-linux-gnu) RID="linux-x64"; LIB="libonnxruntime.so" ;;
  aarch64-unknown-linux-gnu) RID="linux-arm64"; LIB="libonnxruntime.so" ;;
  aarch64-apple-darwin) RID="osx-arm64"; LIB="libonnxruntime.dylib" ;;
  *) echo "fetch-onnxruntime: no ONNX Runtime build for $TRIPLE" >&2; exit 1 ;;
esac
OUT_DIR="src-tauri/onnxruntime"
STAMP="$OUT_DIR/version"
if [ -f "$OUT_DIR/$LIB" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$ORT_VERSION $RID" ]; then exit 0; fi
mkdir -p "$OUT_DIR"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PKG="microsoft.ml.onnxruntime.$ORT_VERSION.nupkg"
echo "fetch-onnxruntime: ONNX Runtime $ORT_VERSION ($RID)" >&2
curl -fsSL --retry 3 -o "$TMP/$PKG" "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/$ORT_VERSION/$PKG"
if command -v sha256sum >/dev/null; then GOT="$(sha256sum "$TMP/$PKG" | cut -d' ' -f1)"; else GOT="$(shasum -a 256 "$TMP/$PKG" | cut -d' ' -f1)"; fi
[ "$GOT" = "$NUPKG_SHA256" ] || { echo "fetch-onnxruntime: checksum mismatch for $PKG" >&2; exit 1; }
ENTRY="runtimes/$RID/native/$LIB"
mkdir "$TMP/x"
if command -v unzip >/dev/null; then unzip -q "$TMP/$PKG" "$ENTRY" -d "$TMP/x"
else
  cp "$TMP/$PKG" "$TMP/ort.zip" # Expand-Archive only takes .zip
  powershell -NoProfile -Command "Expand-Archive -LiteralPath '$(cygpath -w "$TMP/ort.zip" 2>/dev/null || echo "$TMP/ort.zip")' -DestinationPath '$(cygpath -w "$TMP/x" 2>/dev/null || echo "$TMP/x")'"
fi
rm -f "$OUT_DIR"/onnxruntime.dll "$OUT_DIR"/libonnxruntime.*
cp "$TMP/x/$ENTRY" "$OUT_DIR/$LIB"
echo "$ORT_VERSION $RID" > "$STAMP"
