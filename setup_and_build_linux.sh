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
REPO_NAME="apexkit" # Changed to public repo name

TARGET_DIR="src-tauri/binaries"
# Note: We name the file -gnu because that is our build target, 
# even though the source binary is -musl.
TARGET_FILE="${TARGET_DIR}/${SIDECAR_NAME}-x86_64-unknown-linux-gnu"
mkdir -p "$TARGET_DIR"

echo "🔍 Fetching latest release metadata from $REPO_OWNER/$REPO_NAME (Public Repo)..."

# 1. Get the latest release JSON (No Auth Token needed)
RELEASE_JSON=$(curl -s "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/latest")

# 2. Extract the browser_download_url for the linux-musl binary
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url":' | grep "linux-musl" | awk -F '"' '{print $4}' | head -n 1)

if [ -z "$DOWNLOAD_URL" ]; then
    echo "❌ Error: Could not find a 'linux-musl' binary download URL in the latest release."
    echo "Response preview: $(echo "$RELEASE_JSON" | head -n 20)"
    exit 1
fi

echo "📥 Downloading linux-musl Sidecar and renaming to gnu..."

# 3. Download the actual binary directly
HTTP_CODE=$(curl -L -w "%{http_code}" "$DOWNLOAD_URL" -o "$TARGET_FILE")

if [ "$HTTP_CODE" -ne 200 ]; then
    echo "❌ Download Failed with HTTP Status: $HTTP_CODE"
    exit 1
fi

chmod +x "$TARGET_FILE"
echo "✅ Sidecar updated: $TARGET_FILE"

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