#!/bin/bash
set -e

# ==============================================================================
# CONFIGURATION (x86_64 Linux with MUSL Sidecar)
# ==============================================================================
HF_DATASET="kipeles/apexkit-releases"
APEXKIT_VERSION="v0.1.0-beta.1"
VARIANT="perf" # "perf" (25.9 MB) or "small" (19.9 MB)

TARGET_TRIPLE="x86_64-unknown-linux-gnu"
MUSL_NAME="x86_64-unknown-linux-musl"
CF_ARCH="amd64"
FRP_ARCH="amd64"

TARGET_DIR="src-tauri/binaries"
mkdir -p "$TARGET_DIR"

echo "🚀 Starting Linux x86_64 Build (using static musl sidecar)..."

# 1. System Dependencies (Debian / Ubuntu)
if command -v apt-get &> /dev/null; then
    echo "📦 Checking and installing system dependencies..."
    if command -v sudo &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y build-essential curl wget file libssl-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev xdg-utils unzip tar libcups2-dev
        if ! sudo apt-get install -y libwebkit2gtk-4.1-dev; then
            sudo apt-get install -y libwebkit2gtk-4.0-dev
        fi
    fi
fi

# 2. Rust Setup
if ! command -v cargo &> /dev/null; then
    echo "🦀 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

rustup target add "$TARGET_TRIPLE"
rm -f src-tauri/.cargo/config.toml

# 3. Download ApexKit (x86_64 musl from Hugging Face)
APEX_ARCHIVE="apexkit-${MUSL_NAME}-${VARIANT}.tar.gz"
HF_URL="https://huggingface.co/datasets/${HF_DATASET}/resolve/main/${APEXKIT_VERSION}/${APEX_ARCHIVE}?download=true"
APEX_BIN="${TARGET_DIR}/apexkit-${TARGET_TRIPLE}"
APEX_MUSL_BIN="${TARGET_DIR}/apexkit-${MUSL_NAME}"

echo "📥 Downloading ApexKit (${MUSL_NAME}-${VARIANT}) from Hugging Face..."
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

HTTP_CODE=$(curl -L -w "%{http_code}" "$HF_URL" -o "$TEMP_DIR/$APEX_ARCHIVE")
if [ "$HTTP_CODE" -ne 200 ]; then
    echo "❌ Download failed with HTTP $HTTP_CODE from $HF_URL"
    exit 1
fi

tar -xzf "$TEMP_DIR/$APEX_ARCHIVE" -C "$TEMP_DIR"
FOUND_BIN=$(find "$TEMP_DIR" -type f \( -name "apexkit" -o -name "apexkit.exe" \) | head -n 1)

cp "$FOUND_BIN" "$APEX_BIN"
cp "$FOUND_BIN" "$APEX_MUSL_BIN"
chmod +x "$APEX_BIN" "$APEX_MUSL_BIN"
echo "✅ ApexKit sidecar ready."

# 4. Download Cloudflared
CF_BIN="${TARGET_DIR}/cloudflared-${TARGET_TRIPLE}"
if [ ! -f "$CF_BIN" ]; then
    echo "📥 Downloading cloudflared (Linux amd64)..."
    curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o "$CF_BIN"
    cp "$CF_BIN" "${TARGET_DIR}/cloudflared-${MUSL_NAME}"
    chmod +x "$CF_BIN" "${TARGET_DIR}/cloudflared-${MUSL_NAME}"
fi
echo "✅ Cloudflared sidecar ready."

# 5. Download FRPC
FRPC_BIN="${TARGET_DIR}/frpc-${TARGET_TRIPLE}"
if [ ! -f "$FRPC_BIN" ]; then
    FRP_VER=$(curl -s "https://api.github.com/repos/fatedier/frp/releases/latest" | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
    echo "📥 Downloading frpc v${FRP_VER} (Linux amd64)..."
    curl -L "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_${FRP_ARCH}.tar.gz" -o "$TEMP_DIR/frp.tar.gz"
    tar -xzf "$TEMP_DIR/frp.tar.gz" -C "$TEMP_DIR"
    cp "$TEMP_DIR/frp_${FRP_VER}_linux_${FRP_ARCH}/frpc" "$FRPC_BIN"
    cp "$FRPC_BIN" "${TARGET_DIR}/frpc-${MUSL_NAME}"
    chmod +x "$FRPC_BIN" "${TARGET_DIR}/frpc-${MUSL_NAME}"
fi
echo "✅ frpc sidecar ready."

# 6. Build
rm -f src-tauri/Cargo.lock
npm install
echo "🚀 Building Tauri application for ${TARGET_TRIPLE}..."
npm run tauri build -- --target "$TARGET_TRIPLE"

echo "🎉 Build finished! Output bundle located in src-tauri/target/${TARGET_TRIPLE}/release/bundle/"