#!/bin/bash
set -e

TARGET_DIR="src-tauri/binaries"
mkdir -p "$TARGET_DIR"

echo "🍎 Preparing macOS Sidecars (Placeholders)..."

# 1. Create a tiny Dummy Mach-O binary for apexkit
# This is a base64 string of a minimal 'do nothing' Mac executable
# It allows the bundler to finish even if the binary doesn't do anything yet.
DUMMY_MACHO="yv66vgAAADcAAAAEAAAAAAAAAAQAAAADAAAAMAEAAAQAAAAQAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZAAAAAQAAAAQAAAAQAAAAEAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABkAAAABAAAAAgAAAAEAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGQAAAAEAAAADAAAAAQAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABkAAAABAAAABAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="

echo "$DUMMY_MACHO" | base64 -d > "${TARGET_DIR}/apexkit-x86_64-apple-darwin"
echo "$DUMMY_MACHO" | base64 -d > "${TARGET_DIR}/apexkit-aarch64-apple-darwin"

# 2. Download Real cloudflared for Mac
echo "📥 Downloading cloudflared for macOS (Intel & Apple Silicon)..."

# Intel
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz | tar xz
mv cloudflared "${TARGET_DIR}/cloudflared-x86_64-apple-darwin"

# Apple Silicon (M1/M2/M3)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz | tar xz
mv cloudflared "${TARGET_DIR}/cloudflared-aarch64-apple-darwin"

chmod +x ${TARGET_DIR}/*-apple-darwin

echo "✅ macOS sidecars are ready in $TARGET_DIR"