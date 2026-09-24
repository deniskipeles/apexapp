#!/bin/bash
set -e

# ==============================================================================
# CONFIGURATION (macOS Intel x86_64)
# ==============================================================================
TARGET_TRIPLE="x86_64-apple-darwin"
HF_DATASET="kipeles/apexkit-releases"
APEXKIT_VERSION="v0.1.0-beta.1"
VARIANT="perf" # "perf" (23.4 MB) or "small" (18.8 MB)
FRP_VER="0.71.0" # Pinned to bypass GitHub API rate limits in CI

TARGET_DIR="src-tauri/binaries"
mkdir -p "$TARGET_DIR"

echo "🚀 Starting macOS Intel (${TARGET_TRIPLE}) Build..."

# 1. Rust Target
if ! command -v cargo &> /dev/null; then
    echo "🦀 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

echo "🦀 Adding Rust target: ${TARGET_TRIPLE}..."
rustup target add "$TARGET_TRIPLE"
rm -f src-tauri/.cargo/config.toml

# 2. Download ApexKit (x86_64 Apple from Hugging Face)
APEX_ARCHIVE="apexkit-${TARGET_TRIPLE}-${VARIANT}.tar.gz"
HF_URL="https://huggingface.co/datasets/${HF_DATASET}/resolve/main/${APEXKIT_VERSION}/${APEX_ARCHIVE}?download=true"
APEX_TARGET_FILE="${TARGET_DIR}/apexkit-${TARGET_TRIPLE}"

echo "📥 Downloading ApexKit (${TARGET_TRIPLE}-${VARIANT}) from Hugging Face..."
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

HTTP_CODE=$(curl -L -w "%{http_code}" "$HF_URL" -o "$TEMP_DIR/$APEX_ARCHIVE")
if [ "$HTTP_CODE" -ne 200 ]; then
    echo "❌ Failed to download ApexKit (HTTP $HTTP_CODE)"
    exit 1
fi

tar -xzf "$TEMP_DIR/$APEX_ARCHIVE" -C "$TEMP_DIR"
FOUND_BIN=$(find "$TEMP_DIR" -type f \( -name "apexkit" -o -name "apexkit.exe" \) | head -n 1)
mv "$FOUND_BIN" "$APEX_TARGET_FILE"
chmod +x "$APEX_TARGET_FILE"
echo "✅ ApexKit sidecar ready."

# 3. Download Cloudflared (macOS amd64)
CF_TARGET_FILE="${TARGET_DIR}/cloudflared-${TARGET_TRIPLE}"
if [ ! -f "$CF_TARGET_FILE" ]; then
    echo "📥 Downloading cloudflared (macOS amd64)..."
    curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz" -o "$TEMP_DIR/cloudflared.tgz"
    tar -xzf "$TEMP_DIR/cloudflared.tgz" -C "$TEMP_DIR"
    mv "$TEMP_DIR/cloudflared" "$CF_TARGET_FILE"
    chmod +x "$CF_TARGET_FILE"
fi
echo "✅ Cloudflared sidecar ready."

# 4. Download FRPC (macOS amd64) - Direct static download (No API rate limits)
FRPC_TARGET_FILE="${TARGET_DIR}/frpc-${TARGET_TRIPLE}"
if [ ! -f "$FRPC_TARGET_FILE" ]; then
    echo "📥 Downloading frpc v${FRP_VER} (macOS amd64)..."
    curl -L "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_darwin_amd64.tar.gz" -o "$TEMP_DIR/frp.tar.gz"
    tar -xzf "$TEMP_DIR/frp.tar.gz" -C "$TEMP_DIR"
    mv "$TEMP_DIR/frp_${FRP_VER}_darwin_amd64/frpc" "$FRPC_TARGET_FILE"
    chmod +x "$FRPC_TARGET_FILE"
fi
echo "✅ frpc sidecar ready."

# 5. Clear quarantine flags on macOS
if command -v xattr &> /dev/null; then
    xattr -cr "$TARGET_DIR" 2>/dev/null || true
fi

# 6. Build
rm -f src-tauri/Cargo.lock
npm install

echo "🚀 Building Tauri bundle for ${TARGET_TRIPLE}..."
npm run tauri build -- --target "$TARGET_TRIPLE"

echo ""
echo "🎉 Build complete!"
ls -lh "src-tauri/target/${TARGET_TRIPLE}/release/bundle/dmg/"*.dmg 2>/dev/null || true