#!/bin/bash
set -e

# --- Configuration ---
WEBVIEW2_VERSION="109.0.1518.78"
WEBVIEW2_CAB_URL="https://github.com/westinyang/WebView2RuntimeArchive/releases/download/${WEBVIEW2_VERSION}/Microsoft.WebView2.FixedVersionRuntime.${WEBVIEW2_VERSION}.x64.cab"
TARGET_TRIPLE="x86_64-pc-windows-msvc"
# ---------------------

echo "🚀 Starting Windows 7 (Offline Fixed WebView2) Build Setup..."

# 1. System Dependencies (Linux host)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "📦 Checking build dependencies..."
    if command -v sudo &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y build-essential curl wget jq file libssl-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev xdg-utils nsis lld llvm clang unzip cabextract
    fi
fi

# 2. Rust target
echo "🦀 Adding Rust target ${TARGET_TRIPLE}..."
rustup target add ${TARGET_TRIPLE}

# 3. Cross-compilation tools
if ! command -v cargo-xwin &> /dev/null; then cargo install cargo-xwin; fi
if ! command -v xwin &> /dev/null; then cargo install xwin; fi

# 4. Prepare Windows SDK/CRT
if [ ! -d "xwin" ]; then
    echo "📥 Downloading Windows SDK/CRT via xwin..."
    yes yes | xwin splat --output xwin
fi

# 5. Configure Linker
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
TARGET_FILE="${TARGET_DIR}/apexkit-${TARGET_TRIPLE}.exe"
if [ ! -f "$TARGET_FILE" ]; then
    echo "🔍 Fetching ApexKit Windows binary..."
    HF_URL="https://huggingface.co/datasets/kipeles/apexkit-releases/resolve/main/v0.1.0-beta.1/apexkit-x86_64-pc-windows-gnu-perf.zip?download=true"
    TEMP_DIR=$(mktemp -d)
    curl -L "$HF_URL" -o "$TEMP_DIR/apexkit.zip"
    unzip -q "$TEMP_DIR/apexkit.zip" -d "$TEMP_DIR"
    find "$TEMP_DIR" -type f -name "apexkit.exe" -exec mv {} "$TARGET_FILE" \;
    chmod +x "$TARGET_FILE"
    rm -rf "$TEMP_DIR"
fi
echo "✅ ApexKit sidecar ready."

# Cloudflared
CF_TARGET_FILE="${TARGET_DIR}/cloudflared-${TARGET_TRIPLE}.exe"
if [ ! -f "$CF_TARGET_FILE" ]; then
    echo "📥 Downloading cloudflared (Windows)..."
    curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -o "$CF_TARGET_FILE"
    chmod +x "$CF_TARGET_FILE"
fi
echo "✅ Cloudflared sidecar ready."

# FRPC
FRPC_TARGET_FILE="${TARGET_DIR}/frpc-${TARGET_TRIPLE}.exe"
if [ ! -f "$FRPC_TARGET_FILE" ]; then
    FRP_VER=$(curl -s "https://api.github.com/repos/fatedier/frp/releases/latest" | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
    echo "📥 Downloading frpc v${FRP_VER} for Windows..."
    curl -L "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_windows_amd64.zip" -o frp.zip
    unzip -q frp.zip
    mv "frp_${FRP_VER}_windows_amd64/frpc.exe" "$FRPC_TARGET_FILE"
    chmod +x "$FRPC_TARGET_FILE"
    rm -rf frp*
fi
echo "✅ frpc sidecar ready."

# 7. DOWNLOAD & EXTRACT WEBVIEW2 FIXED RUNTIME
echo "🌐 Preparing WebView2 Fixed Runtime v${WEBVIEW2_VERSION}..."
WEBVIEW_DIR="src-tauri/webview2"
FIXED_PATH="$WEBVIEW_DIR/fixed"
mkdir -p "$FIXED_PATH"

if [ ! -f "$FIXED_PATH/msedgewebview2.exe" ]; then
    echo "📥 Downloading WebView2 CAB..."
    curl -L -o "webview2.cab" "$WEBVIEW2_CAB_URL"
    echo "📂 Extracting Fixed Runtime..."
    cabextract -d "$FIXED_PATH" "webview2.cab"

    # Flatten nested folder if cabextract placed files into a subfolder
    SUBFOLDER=$(find "$FIXED_PATH" -maxdepth 1 -type d -name "Microsoft.WebView2.*" | head -n 1)
    if [ -n "$SUBFOLDER" ]; then
        echo "🧹 Flattening directory structure..."
        mv "$SUBFOLDER"/* "$FIXED_PATH/"
        rmdir "$SUBFOLDER"
    fi
    rm -f "webview2.cab"
fi

if [ ! -f "$FIXED_PATH/msedgewebview2.exe" ]; then
    echo "❌ Error: msedgewebview2.exe not found in $FIXED_PATH!"
    exit 1
fi
echo "✅ WebView2 Fixed Runtime verified."

# 8. BUILD
npm install
rm -f src-tauri/Cargo.lock

echo "🛠️ Patching tauri.conf.json with relative Fixed Runtime & resources..."
cp src-tauri/tauri.conf.json src-tauri/tauri.conf.json.bak

# 1. Use relative path "./webview2/fixed"
# 2. Add to bundle.resources to FORCE makensis to pack the files
jq '.bundle.windows.webviewInstallMode = {
  "type": "fixedRuntime",
  "path": "./webview2/fixed"
} | .bundle.resources = ((.bundle.resources // []) + ["webview2/fixed/**/*"]) | .productName = "apexapp-win7"' \
src-tauri/tauri.conf.json > temp_tauri_conf.json && mv temp_tauri_conf.json src-tauri/tauri.conf.json

echo "🚀 BUILDING WINDOWS 7 OFFLINE INSTALLER (NSIS)..."
export RUSTFLAGS="-Lnative=$(pwd)/xwin/crt/lib/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/um/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/ucrt/x86_64"
npm run tauri build -- --target ${TARGET_TRIPLE}

echo "🧹 Reverting tauri.conf.json..."
mv src-tauri/tauri.conf.json.bak src-tauri/tauri.conf.json

echo "🎉 DONE!"
echo "📁 Resulting installer (~180MB - 220MB):"
ls -lh src-tauri/target/${TARGET_TRIPLE}/release/bundle/nsis/*.exe