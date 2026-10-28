#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
APP=Roamies.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos14.0" -framework AppKit -framework WebKit \
  -o "$APP/Contents/MacOS/Roamies" main.swift
cp ../desktop.html ../demo.js "$APP/Contents/Resources/web/"
cp -R ../roamies "$APP/Contents/Resources/web/"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.kenkai.roamies</string>
  <key>CFBundleName</key><string>Roamies</string>
  <key>CFBundleExecutable</key><string>Roamies</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
PLIST
codesign -s - --force --deep "$APP" >/dev/null 2>&1
echo "Built $APP"
