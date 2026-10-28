#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
APP=Roamie.app
mkdir -p "$APP/Contents/MacOS"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos14.0" -framework AppKit -o "$APP/Contents/MacOS/Roamie" Sources/main.swift
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.kenkai.roamie</string>
  <key>CFBundleName</key><string>Roamie</string>
  <key>CFBundleExecutable</key><string>Roamie</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
PLIST
codesign -s - --force "$APP" >/dev/null 2>&1
echo "Built $APP. Run: open $APP"
