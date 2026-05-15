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
REPO_NAME="apexkit" 

TARGET_DIR="src-tauri/binaries"
TARGET_FILE="${TARGET_DIR}/${SIDECAR_NAME}-x86_64-pc-windows-msvc.exe"
mkdir -p "$TARGET_DIR"

echo "🔍 Fetching latest release metadata from $REPO_OWNER/$REPO_NAME (Public Repo)..."

RELEASE_JSON=$(curl -s "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/latest")
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url":' | grep "windows" | awk -F '"' '{print $4}' | head -n 1)

if [ -z "$DOWNLOAD_URL" ]; then
    echo "❌ Error: Could not find a Windows binary download URL in the latest release."
    exit 1
fi

echo "📥 Downloading Latest Sidecar from: $DOWNLOAD_URL"

# Create a temporary directory for extraction
TEMP_DIR=$(mktemp -d)
TEMP_FILE="$TEMP_DIR/downloaded_file"

HTTP_CODE=$(curl -L -w "%{http_code}" "$DOWNLOAD_URL" -o "$TEMP_FILE")

if [ "$HTTP_CODE" -ne 200 ]; then
    echo "❌ Download Failed with HTTP Status: $HTTP_CODE"
    rm -rf "$TEMP_DIR"
    exit 1
fi

# Detect if the file is an archive and extract, or just move it if it's a raw binary
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
# 5.6 DOWNLOAD FRPC (SIDECAR)
# ==========================================
FRP_VER=$(curl -s "https://api.github.com/repos/fatedier/frp/releases/latest" | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
FRPC_TARGET_FILE="${TARGET_DIR}/frpc-x86_64-pc-windows-msvc.exe"

if [ ! -f "$FRPC_TARGET_FILE" ]; then
    echo "📥 Downloading frpc v${FRP_VER} for Windows..."
    curl -L "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_windows_amd64.zip" -o frp.zip
    unzip -q frp.zip
    mv "frp_${FRP_VER}_windows_amd64/frpc.exe" "$FRPC_TARGET_FILE"
    chmod +x "$FRPC_TARGET_FILE"
    rm -rf frp*
fi
echo "✅ frpc Windows sidecar updated."
# ==========================================

# 6. Download Microsoft SDKs
if [ ! -d "xwin" ]; then
    echo "📥 Downloading Microsoft Windows SDKs..."
    mkdir -p xwin
    # Send the full word "yes" to satisfy the prompt
    yes yes | xwin splat --output ./xwin
    echo "✅ Microsoft Windows SDKs downloaded."
fi

# 7. Build
npm install
echo "🗑️ Removing newer Cargo.lock to prevent version conflict..."
# This forces Rust to generate a compatible version lockfile
rm -f src-tauri/Cargo.lock
echo "🚀 BUILDING TAURI APP..."
RUSTFLAGS="-Lnative=$(pwd)/xwin/crt/lib/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/um/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/ucrt/x86_64" \
npm run tauri build -- --target x86_64-pc-windows-msvc

echo "✅ DONE"