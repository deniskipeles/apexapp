#!/bin/bash
set -e

echo "🚀 Starting Native Linux Build Setup..."

# 1. Install System Dependencies
echo "📦 Installing System Dependencies..."
sudo apt-get update
sudo apt-get install -y build-essential curl wget file libssl-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev xdg-utils unzip

# Handle WebKit for Linux
if sudo apt-get install -y libwebkit2gtk-4.1-dev; then
    echo "✅ WebKit 4.1 installed."
else
    echo "⚠️ WebKit 4.1 not found, trying 4.0..."
    sudo apt-get install -y libwebkit2gtk-4.0-dev
fi

# 2. Install Rust (if not present)
if ! command -v cargo &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# 3. Configure Native Linux Target
rustup target add x86_64-unknown-linux-gnu

# 4. Clean up any Windows-specific cargo config that might interfere
rm -f src-tauri/.cargo/config.toml

# ==========================================
# 5. DOWNLOAD LATEST APEXKIT RELEASE (LINUX SIDECAR)
# ==========================================
SIDECAR_NAME="apexkit" 
REPO_OWNER="deniskipeles"
REPO_NAME="apexkit" 

TARGET_DIR="src-tauri/binaries"
TARGET_FILE="${TARGET_DIR}/${SIDECAR_NAME}-x86_64-unknown-linux-gnu"
mkdir -p "$TARGET_DIR"

echo "🔍 Fetching latest release metadata from $REPO_OWNER/$REPO_NAME (Public Repo)..."

RELEASE_JSON=$(curl -s "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/latest")
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url":' | grep "linux-musl" | awk -F '"' '{print $4}' | head -n 1)

if [ -z "$DOWNLOAD_URL" ]; then
    echo "❌ Error: Could not find a 'linux-musl' binary download URL in the latest release."
    exit 1
fi

echo "📥 Downloading linux-musl Sidecar from: $DOWNLOAD_URL"

TEMP_DIR=$(mktemp -d)
TEMP_FILE="$TEMP_DIR/downloaded_file"

HTTP_CODE=$(curl -L -w "%{http_code}" "$DOWNLOAD_URL" -o "$TEMP_FILE")

if [ "$HTTP_CODE" -ne 200 ]; then
    echo "❌ Download Failed with HTTP Status: $HTTP_CODE"
    rm -rf "$TEMP_DIR"
    exit 1
fi

if [[ "$DOWNLOAD_URL" == *.tar.gz ]]; then
    echo "📦 Extracting .tar.gz archive..."
    tar -xzf "$TEMP_FILE" -C "$TEMP_DIR"
    find "$TEMP_DIR" -type f \( -name "apexkit" -o -name "apexkit.exe" \) -exec mv {} "$TARGET_FILE" \;
elif [[ "$DOWNLOAD_URL" == *.zip ]]; then
    echo "📦 Extracting .zip archive..."
    unzip -q "$TEMP_FILE" -d "$TEMP_DIR"
    find "$TEMP_DIR" -type f \( -name "apexkit" -o -name "apexkit.exe" \) -exec mv {} "$TARGET_FILE" \;
else
    echo "📄 Raw binary detected..."
    mv "$TEMP_FILE" "$TARGET_FILE"
fi

chmod +x "$TARGET_FILE"
rm -rf "$TEMP_DIR"
echo "✅ Sidecar updated and ready: $TARGET_FILE"

# ==========================================
# 5.5 DOWNLOAD CLOUDFLARED (LINUX SIDECAR)
# ==========================================
CF_BINARY_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
CF_TARGET_FILE="${TARGET_DIR}/cloudflared-x86_64-unknown-linux-gnu"

if [ ! -f "$CF_TARGET_FILE" ]; then
    echo "📥 Downloading cloudflared for Linux..."
    curl -L "$CF_BINARY_URL" -o "$CF_TARGET_FILE"
    chmod +x "$CF_TARGET_FILE"
fi
echo "✅ Cloudflared Linux sidecar updated."

# ==========================================
# 5.6 DOWNLOAD FRPC (LINUX SIDECAR)
# ==========================================
FRP_VER=$(curl -s "https://api.github.com/repos/fatedier/frp/releases/latest" | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
FRPC_TARGET_FILE="${TARGET_DIR}/frpc-x86_64-unknown-linux-gnu"

if [ ! -f "$FRPC_TARGET_FILE" ]; then
    echo "📥 Downloading frpc v${FRP_VER} for Linux..."
    curl -L "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_amd64.tar.gz" -o frp.tar.gz
    tar -xzf frp.tar.gz
    mv "frp_${FRP_VER}_linux_amd64/frpc" "$FRPC_TARGET_FILE"
    chmod +x "$FRPC_TARGET_FILE"
    rm -rf frp*
fi
echo "✅ frpc Linux sidecar updated."
# ==========================================

echo "🗑️ Removing newer Cargo.lock to prevent version conflict..."
# This forces Rust to generate a compatible version lockfile
rm -f src-tauri/Cargo.lock

# ==========================================
# 6. Build
npm install
echo "🚀 BUILDING TAURI APP (AppImage/Deb)..."
npm run tauri build

echo "✅ DONE"
echo "📁 Linux bundles are located in src-tauri/target/release/bundle/"