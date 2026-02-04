#!/bin/bash
set -e

echo "🚀 Starting Automated Windows Cross-Compilation Setup..."

# 1. Install System Dependencies & Unzip
echo "📦 Installing System Dependencies..."
sudo apt-get update
sudo apt-get install -y build-essential curl wget file libssl-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev xdg-utils nsis lld llvm clang unzip

# Handle WebKit
if sudo apt-get install -y libwebkit2gtk-4.1-dev; then
    echo "✅ WebKit 4.1 installed."
else
    echo "⚠️ WebKit 4.1 not found, trying 4.0..."
    sudo apt-get install -y libwebkit2gtk-4.0-dev
fi

# 2. Install Rust
if ! command -v cargo &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# 3. Configure Rust Targets
rustup target add x86_64-pc-windows-msvc
if ! command -v cargo-xwin &> /dev/null; then cargo install cargo-xwin; fi
if ! command -v xwin &> /dev/null; then cargo install xwin; fi

# 4. Configure Cargo Linker
mkdir -p src-tauri/.cargo
cat > src-tauri/.cargo/config.toml <<EOF
[target.x86_64-pc-windows-msvc]
linker = "lld-link"
runner = "cargo-xwin"
EOF

# ==========================================
# 5. DOWNLOAD LATEST APEXKIT RELEASE (SIDECAR)
# ==========================================
SIDECAR_NAME="apexkit" 
REPO_OWNER="deniskipeles"
REPO_NAME="apex-kit"

TARGET_DIR="src-tauri/binaries"
# Note: Tauri is strict. If we build for msvc, the sidecar MUST end in x86_64-pc-windows-msvc.exe
TARGET_FILE="${TARGET_DIR}/${SIDECAR_NAME}-x86_64-pc-windows-msvc.exe"
mkdir -p "$TARGET_DIR"

# Use GH_TOKEN from Workflow or fallback to GITHUB_TOKEN
AUTH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"

if [ -z "$AUTH_TOKEN" ]; then
    echo "❌ Error: GITHUB_TOKEN is not set. Cannot access private repository."
    exit 1
fi

echo "🔍 Fetching latest release metadata from $REPO_OWNER/$REPO_NAME..."

# 1. Get the latest release JSON
RELEASE_JSON=$(curl -s -H "Authorization: token $AUTH_TOKEN" \
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases?per_page=1")

# 2. Extract the Asset ID for the Windows binary (looking for "windows" in name)
# We use grep/awk to avoid dependency on 'jq' if it's missing, though most runners have it.
ASSET_ID=$(echo "$RELEASE_JSON" | grep -B 20 "windows" | grep '"id":' | head -n 1 | awk '{print $2}' | tr -d ',')

if [ -z "$ASSET_ID" ] || [ "$ASSET_ID" = "null" ]; then
    echo "❌ Error: Could not find a Windows binary in the latest release."
    echo "Response preview: $(echo "$RELEASE_JSON" | head -n 20)"
    exit 1
fi

echo "📥 Downloading Latest Sidecar Asset ID: $ASSET_ID..."

# 3. Download the actual binary using the GitHub Assets API
HTTP_CODE=$(curl -L -w "%{http_code}" \
  -H "Authorization: token $AUTH_TOKEN" \
  -H "Accept: application/octet-stream" \
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/assets/$ASSET_ID" \
  -o "$TARGET_FILE")

if [ "$HTTP_CODE" -ne 200 ]; then
    echo "❌ Download Failed with HTTP Status: $HTTP_CODE"
    exit 1
fi

echo "✅ Sidecar updated: $TARGET_FILE"
chmod +x "$TARGET_FILE"
# ==========================================

# ==========================================
# 5.5 DOWNLOAD CLOUDFLARED (SIDECAR)
# ==========================================
CF_BINARY_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
CF_TARGET_FILE="${TARGET_DIR}/cloudflared-x86_64-pc-windows-msvc.exe"

if [ ! -f "$CF_TARGET_FILE" ]; then
    echo "📥 Downloading cloudflared..."
    curl -L "$CF_BINARY_URL" -o "$CF_TARGET_FILE"
    chmod +x "$CF_TARGET_FILE"
fi
# ==========================================

# 6. Download Microsoft SDKs
echo "📥 Downloading Microsoft Windows SDKs..."
mkdir -p xwin

# FIX: Send the full word "yes" to satisfy the prompt
yes yes | xwin splat --output ./xwin

# 7. Build
npm install
echo "🚀 BUILDING TAURI APP..."
RUSTFLAGS="-Lnative=$(pwd)/xwin/crt/lib/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/um/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/ucrt/x86_64" \
npm run tauri build -- --target x86_64-pc-windows-msvc

echo "✅ DONE"
