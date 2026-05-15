#!/bin/bash
set -e

echo "🚀 Starting Automated macOS Build Setup..."

# 1. Check for basic tools (Homebrew, curl, jq)
if ! command -v brew &> /dev/null; then
    echo "⚠️ Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if ! command -v jq &> /dev/null; then
    echo "📦 Installing jq..."
    brew install jq
fi

# 2. Install Rust (if not present)
if ! command -v cargo &> /dev/null; then
    echo "🦀 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# 3. Detect macOS Architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    echo "💻 Detected Apple Silicon (aarch64)"
    TAURI_TARGET="aarch64-apple-darwin"
    APEX_ARCH_SEARCH="aarch64"
    CF_ARCH="arm64"
    FRP_ARCH="arm64"
else
    echo "💻 Detected Intel Mac (x86_64)"
    TAURI_TARGET="x86_64-apple-darwin"
    APEX_ARCH_SEARCH="x86_64"
    CF_ARCH="amd64"
    FRP_ARCH="amd64"
fi

# Ensure Rust has the correct target installed
rustup target add "$TAURI_TARGET"

TARGET_DIR="src-tauri/binaries"
mkdir -p "$TARGET_DIR"

# ==========================================
# 4. DOWNLOAD LATEST APEXKIT RELEASE (SIDECAR)
# ==========================================
SIDECAR_NAME="apexkit" 
REPO_OWNER="deniskipeles"
REPO_NAME="apexkit" 

TARGET_FILE="${TARGET_DIR}/${SIDECAR_NAME}-${TAURI_TARGET}"

echo "🔍 Fetching latest release metadata from $REPO_OWNER/$REPO_NAME..."
RELEASE_JSON=$(curl -s "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/latest")

# Look for macOS/apple-darwin binary specifically for this architecture
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r ".assets[] | select(.name | test(\"(apple-darwin|macos)\" ; \"i\")) | select(.name | test(\"$APEX_ARCH_SEARCH\" ; \"i\")) | .browser_download_url" | head -n 1)

# Fallback: If architecture-specific binary isn't found, try to grab a universal darwin binary
if [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
    DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r '.assets[] | select(.name | test("(apple-darwin|macos)" ; "i")) | .browser_download_url' | head -n 1)
fi

if [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
    echo "❌ Error: Could not find a macOS binary download URL in the latest release."
    exit 1
fi

echo "📥 Downloading macOS Sidecar from: $DOWNLOAD_URL"

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
echo "✅ ApexKit macOS sidecar updated and ready: $TARGET_FILE"
# ==========================================


# ==========================================
# 5. DOWNLOAD CLOUDFLARED (SIDECAR)
# ==========================================
CF_BINARY_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${CF_ARCH}.tgz"
CF_TARGET_FILE="${TARGET_DIR}/cloudflared-${TAURI_TARGET}"

if [ ! -f "$CF_TARGET_FILE" ]; then
    echo "📥 Downloading cloudflared for macOS..."
    TEMP_DIR=$(mktemp -d)
    curl -L "$CF_BINARY_URL" -o "$TEMP_DIR/cloudflared.tgz"
    tar -xzf "$TEMP_DIR/cloudflared.tgz" -C "$TEMP_DIR"
    mv "$TEMP_DIR/cloudflared" "$CF_TARGET_FILE"
    chmod +x "$CF_TARGET_FILE"
    rm -rf "$TEMP_DIR"
fi
echo "✅ Cloudflared macOS sidecar updated."
# ==========================================


# ==========================================
# 6. DOWNLOAD FRPC (SIDECAR)
# ==========================================
FRP_VER=$(curl -s "https://api.github.com/repos/fatedier/frp/releases/latest" | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
FRPC_TARGET_FILE="${TARGET_DIR}/frpc-${TAURI_TARGET}"

if [ ! -f "$FRPC_TARGET_FILE" ]; then
    echo "📥 Downloading frpc v${FRP_VER} for macOS..."
    TEMP_DIR=$(mktemp -d)
    curl -L "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_darwin_${FRP_ARCH}.tar.gz" -o "$TEMP_DIR/frp.tar.gz"
    tar -xzf "$TEMP_DIR/frp.tar.gz" -C "$TEMP_DIR"
    mv "$TEMP_DIR/frp_${FRP_VER}_darwin_${FRP_ARCH}/frpc" "$FRPC_TARGET_FILE"
    chmod +x "$FRPC_TARGET_FILE"
    rm -rf "$TEMP_DIR"
fi
echo "✅ frpc macOS sidecar updated."
# ==========================================


# 7. Clean up and Build
echo "🗑️ Removing newer Cargo.lock to prevent version conflict..."
rm -f src-tauri/Cargo.lock

echo "📦 Installing Node dependencies..."
npm install

echo "🚀 BUILDING TAURI APP FOR MACOS..."
npm run tauri build

echo "✅ DONE"
echo "📁 macOS App Bundle located in src-tauri/target/release/bundle/macos/"