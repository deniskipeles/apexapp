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
REPO_NAME="apex-kit"

TARGET_DIR="src-tauri/binaries"
# Note: We name the file -gnu because that is our build target, 
# even though the source binary is -musl.
TARGET_FILE="${TARGET_DIR}/${SIDECAR_NAME}-x86_64-unknown-linux-gnu"
mkdir -p "$TARGET_DIR"

AUTH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"

if [ -z "$AUTH_TOKEN" ]; then
    echo "❌ Error: GITHUB_TOKEN is not set. Cannot access private repository."
    exit 1
fi

echo "🔍 Fetching latest release metadata from $REPO_OWNER/$REPO_NAME..."

RELEASE_JSON=$(curl -s -H "Authorization: token $AUTH_TOKEN" \
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases?per_page=1")

# [UPDATE]: Search for "linux-musl" in the asset name
ASSET_ID=$(echo "$RELEASE_JSON" | grep -B 20 "linux-musl" | grep '"id":' | head -n 1 | awk '{print $2}' | tr -d ',')

if [ -z "$ASSET_ID" ] || [ "$ASSET_ID" = "null" ]; then
    echo "❌ Error: Could not find a 'linux-musl' binary in the latest release."
    echo "Response preview: $(echo "$RELEASE_JSON" | head -n 20)"
    exit 1
fi

echo "📥 Downloading linux-musl Sidecar and renaming to gnu..."

HTTP_CODE=$(curl -L -w "%{http_code}" \
  -H "Authorization: token $AUTH_TOKEN" \
  -H "Accept: application/octet-stream" \
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/assets/$ASSET_ID" \
  -o "$TARGET_FILE")

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

# 6. Build
npm install
echo "🚀 BUILDING TAURI APP (AppImage/Deb)..."
npm run tauri build

echo "✅ DONE"
echo "📁 Linux bundles are located in src-tauri/target/release/bundle/"