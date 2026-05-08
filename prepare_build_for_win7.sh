#!/bin/bash
set -e

# --- Configuration ---
WEBVIEW2_VERSION="109.0.1518.78"
WEBVIEW2_CAB_URL="https://github.com/westinyang/WebView2RuntimeArchive/releases/download/${WEBVIEW2_VERSION}/Microsoft.WebView2.FixedVersionRuntime.${WEBVIEW2_VERSION}.x64.cab"
TARGET_TRIPLE="x86_64-pc-windows-msvc"
# ---------------------

echo "🚀 Starting Windows 7 (Offline) Build Setup..."

# 1. Install System Dependencies (Linux only)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "📦 Installing build dependencies..."
    if command -v sudo &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y build-essential curl wget jq file libssl-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev xdg-utils nsis lld llvm clang unzip cabextract
    else
        echo "⚠️  sudo not found, assuming dependencies are pre-installed."
    fi
fi

# 2. Install Rust target
echo "🦀 Adding Rust target ${TARGET_TRIPLE}..."
rustup target add ${TARGET_TRIPLE}

# 3. Install Cross Compilation Tools
echo "🛠️  Checking/Installing cross-compilation tools..."
if ! command -v cargo-xwin &> /dev/null; then cargo install cargo-xwin; fi
if ! command -v xwin &> /dev/null; then cargo install xwin; fi

# 4. Prepare xwin (SDK/CRT)
if [ ! -d "xwin" ]; then
    echo "📥 Downloading Windows SDK/CRT via xwin..."
    xwin --accept-license splat --output xwin
fi

# 5. Configure Linker for Win7 Target
echo "🔗 Configuring linker..."
mkdir -p src-tauri/.cargo
cat > src-tauri/.cargo/config.toml <<EOT
[target.${TARGET_TRIPLE}]
linker = "lld-link"
runner = "cargo-xwin"
EOT

# 6. DOWNLOAD SIDECARS
TARGET_DIR="src-tauri/binaries"
mkdir -p "$TARGET_DIR"

# ApexKit
SIDECAR_NAME="apexkit"
REPO_OWNER="deniskipeles"
REPO_NAME="apex-kit"
TARGET_FILE="${TARGET_DIR}/${SIDECAR_NAME}-${TARGET_TRIPLE}.exe"

echo "🔍 Fetching latest Windows release metadata for ApexKit..."
RELEASE_JSON=$(curl -s "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/latest")
# Improved JQ query to handle nulls and fetch download URL
ASSET_DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r '.assets // [] | .[] | select(.name | contains("windows") or contains("pc-windows-msvc")) | .browser_download_url' | head -n 1)

if [ -z "$ASSET_DOWNLOAD_URL" ] || [ "$ASSET_DOWNLOAD_URL" = "null" ]; then
    echo "⚠️  Could not find Windows binary in latest release of $REPO_NAME. Skipping download."
else
    echo "📥 Downloading ApexKit from $ASSET_DOWNLOAD_URL..."
    curl -L "$ASSET_DOWNLOAD_URL" -o "$TARGET_FILE"
    chmod +x "$TARGET_FILE"
    echo "✅ ApexKit sidecar updated."
fi

# Cloudflared
CF_WIN_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
CF_TARGET_FILE="${TARGET_DIR}/cloudflared-${TARGET_TRIPLE}.exe"

if [ ! -f "$CF_TARGET_FILE" ]; then
    echo "📥 Downloading cloudflared (Windows)..."
    curl -L "$CF_WIN_URL" -o "$CF_TARGET_FILE"
    chmod +x "$CF_TARGET_FILE"
fi
echo "✅ Cloudflared sidecar updated."

# 7. DOWNLOAD & EXTRACT WEBVIEW2 FIXED RUNTIME
echo "🌐 Preparing WebView2 Fixed Runtime..."
WEBVIEW_DIR="src-tauri/webview2"
FIXED_PATH="$WEBVIEW_DIR/fixed"

if [ ! -d "$FIXED_PATH" ] || [ -z "$(ls -A "$FIXED_PATH")" ]; then
    mkdir -p "$FIXED_PATH"
    if command -v cabextract &> /dev/null; then
        echo "📥 Downloading WebView2 CAB..."
        curl -L -o "webview2.cab" "$WEBVIEW2_CAB_URL"
        echo "📂 Extracting Fixed Runtime..."
        cabextract -d "$FIXED_PATH" "webview2.cab"

        SUBFOLDER=$(find "$FIXED_PATH" -maxdepth 1 -type d -name "Microsoft.WebView2.*" | head -n 1)
        if [ -n "$SUBFOLDER" ]; then
            echo "🧹 Flattening directory structure..."
            mv "$SUBFOLDER"/* "$FIXED_PATH/"
            rmdir "$SUBFOLDER"
        fi
        rm "webview2.cab"
        echo "✅ WebView2 Fixed Runtime ready."
    else
        echo "❌ cabextract not found! Cannot extract WebView2."
        exit 1
    fi
else
    echo "✅ WebView2 Fixed Runtime already prepared."
fi

# 8. Build
npm install

echo "🗑️ Removing newer Cargo.lock to prevent version conflict..."
rm -f src-tauri/Cargo.lock

echo "🛠️ Patching tauri.conf.json for Windows 7 build..."
cp src-tauri/tauri.conf.json src-tauri/tauri.conf.json.bak

# Inject the webviewInstallMode and update productName
jq '.bundle.windows.webviewInstallMode = {
  "type": "fixedRuntime",
  "path": "./webview2/fixed/"
} | .productName = "apexapp-win7"' src-tauri/tauri.conf.json > temp_tauri_conf.json && mv temp_tauri_conf.json src-tauri/tauri.conf.json

# Build
echo "🚀 BUILDING WINDOWS 7 OFFLINE INSTALLER..."
export RUSTFLAGS="-Lnative=$(pwd)/xwin/crt/lib/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/um/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/ucrt/x86_64"
npm run tauri build -- --target ${TARGET_TRIPLE}

# Clean up
echo "🧹 Reverting tauri.conf.json..."
mv src-tauri/tauri.conf.json.bak src-tauri/tauri.conf.json

echo "✅ DONE"
echo "📁 Installer located in: src-tauri/target/${TARGET_TRIPLE}/release/bundle/nsis/"
