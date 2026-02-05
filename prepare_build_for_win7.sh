#!/bin/bash
set -e

echo "🚀 Starting Windows 7 (Offline) Build Setup..."

# 1. Install System Dependencies
echo "📦 Installing build dependencies..."
sudo apt-get update
sudo apt-get install -y build-essential curl wget jq file libssl-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev xdg-utils nsis lld llvm clang unzip

# 2. Install Rust
if ! command -v cargo &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# rustup install 1.75.0
# rustup default 1.75.0
rustup target add x86_64-pc-windows-msvc

# 3. Install Cross Compilation Tools
if ! command -v cargo-xwin &> /dev/null; then cargo install cargo-xwin; fi
if ! command -v xwin &> /dev/null; then cargo install xwin; fi

# 4. Configure Linker for Win7 Target
mkdir -p src-tauri/.cargo
cat > src-tauri/.cargo/config.toml <<EOF
[target.x86_64-pc-windows-msvc]
linker = "lld-link"
runner = "cargo-xwin"
EOF

# ==========================================
# 5. DOWNLOAD LATEST APEXKIT (SIDECAR)
# ==========================================
SIDECAR_NAME="apexkit" 
REPO_OWNER="deniskipeles"
REPO_NAME="apex-kit"
TARGET_DIR="src-tauri/binaries"
TARGET_FILE="${TARGET_DIR}/${SIDECAR_NAME}-x86_64-pc-windows-msvc.exe"
mkdir -p "$TARGET_DIR"

AUTH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"

if [ -z "$AUTH_TOKEN" ]; then
    echo "❌ Error: GITHUB_TOKEN is not set. Cannot download private sidecar."
    exit 1
fi

echo "🔍 Fetching latest Windows release metadata..."
RELEASE_JSON=$(curl -s -H "Authorization: token $AUTH_TOKEN" "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases?per_page=1")
ASSET_ID=$(echo "$RELEASE_JSON" | grep -B 20 "windows" | grep '"id":' | head -n 1 | awk '{print $2}' | tr -d ',')

if [ -z "$ASSET_ID" ] || [ "$ASSET_ID" = "null" ]; then
    echo "❌ Error: Could not find Windows binary in latest release."
    exit 1
fi

echo "📥 Downloading ApexKit (ID: $ASSET_ID)..."
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
echo "✅ ApexKit sidecar updated."

# ==========================================
# 6. DOWNLOAD CLOUDFLARED (SIDECAR)
# ==========================================
CF_WIN_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
CF_TARGET_FILE="${TARGET_DIR}/cloudflared-x86_64-pc-windows-msvc.exe"

if [ ! -f "$CF_TARGET_FILE" ]; then
    echo "📥 Downloading cloudflared (Windows)..."
    curl -L "$CF_WIN_URL" -o "$CF_TARGET_FILE"
    chmod +x "$CF_TARGET_FILE"
fi
echo "✅ Cloudflared sidecar updated."

# ==========================================
# 7. DOWNLOAD & EXTRACT WEBVIEW2 FIXED RUNTIME (WIN 7)
# ==========================================
sudo apt-get install -y cabextract

WEBVIEW_DIR="src-tauri/webview2"
FIXED_PATH="$WEBVIEW_DIR/fixed"
mkdir -p "$FIXED_PATH"

if [ ! -f "$FIXED_PATH/msedgewebview2.exe" ]; then
    echo "📥 Downloading WebView2 Fixed Version..."
    URL="https://github.com/westinyang/WebView2RuntimeArchive/releases/download/109.0.1518.78/Microsoft.WebView2.FixedVersionRuntime.109.0.1518.78.x64.cab"
    curl -L -o "webview2.cab" "$URL"
    
    echo "📂 Extracting Fixed Runtime..."
    cabextract -d "$FIXED_PATH" "webview2.cab"
    
    # [NEW] FLATTEN DIRECTORY
    # cabextract creates a subfolder named "Microsoft.WebView2.FixedVersionRuntime..."
    # We find that folder and move everything inside it up to $FIXED_PATH
    SUBFOLDER=$(find "$FIXED_PATH" -maxdepth 1 -type d -name "Microsoft.WebView2.*" | head -n 1)
    if [ -n "$SUBFOLDER" ]; then
        echo "🧹 Flattening directory structure..."
        mv "$SUBFOLDER"/* "$FIXED_PATH/"
        rmdir "$SUBFOLDER"
    fi
    
    rm "webview2.cab"
    echo "✅ WebView2 Fixed Runtime ready at $FIXED_PATH"
else
    echo "✅ WebView2 Fixed Runtime already prepared."
fi

# 9. Build
# 9. Build with Dynamic Patching
npm install

echo "🗑️ Removing newer Cargo.lock to prevent version conflict..."
# This forces Rust to generate a compatible version lockfile
rm -f src-tauri/Cargo.lock

echo "🛠️ Temporarily patching tauri.conf.json for Offline WebView2..."
cp src-tauri/tauri.conf.json src-tauri/tauri.conf.json.bak

# Inject the webView2Container path
# jq '.bundle.windows.nsis.webView2Container = "webview2/MicrosoftEdgeWebView2RuntimeInstallerX64.exe"' src-tauri/tauri.conf.json > temp_tauri_conf.json && mv temp_tauri_conf.json src-tauri/tauri.conf.json
# [UPDATE]: New JQ logic to set webviewInstallMode
jq '.bundle.windows.webviewInstallMode = {
  "type": "fixedRuntime",
  "path": "./webview2/fixed/"
}' src-tauri/tauri.conf.json > temp_tauri_conf.json && mv temp_tauri_conf.json src-tauri/tauri.conf.json

# Build
echo "🚀 BUILDING WINDOWS 7 OFFLINE INSTALLER..."
# (
#   RUSTFLAGS="-Lnative=$(pwd)/xwin/crt/lib/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/um/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/ucrt/x86_64" \
#   npm run tauri build -- --target x86_64-pc-windows-msvc
# ) || BUILD_FAILED=true
RUSTFLAGS="-Lnative=$(pwd)/xwin/crt/lib/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/um/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/ucrt/x86_64" \
npm run tauri build -- --target x86_64-pc-windows-msvc

# Clean up
echo "🧹 Reverting tauri.conf.json..."
mv src-tauri/tauri.conf.json.bak src-tauri/tauri.conf.json

# if [ "$BUILD_FAILED" = true ]; then
#     echo "❌ Build failed!"
#     exit 1
# fi

echo "✅ DONE"
echo "📁 Installer located in: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/"