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
# 5. DOWNLOAD SPECIFIC GITHUB ARTIFACT
# ==========================================
SIDECAR_NAME="my-sidecar" # <--- NAME IN TAURI.CONF.JSON (externalBin)
ARTIFACT_ID="5243988330"
REPO_OWNER="deniskipeles"
REPO_NAME="apex-kit"

TARGET_DIR="src-tauri/binaries"
TARGET_FILE="${TARGET_DIR}/${SIDECAR_NAME}-x86_64-pc-windows-msvc.exe"
mkdir -p "$TARGET_DIR"

echo "📥 Downloading Sidecar Artifact ID: $ARTIFACT_ID..."

# Check for Token
AUTH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"
if [ -z "$AUTH_TOKEN" ]; then
    echo "❌ Error: GH_TOKEN or GITHUB_TOKEN is missing. Cannot download artifact."
    exit 1
fi

# Download ZIP from GitHub API
curl -L \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/actions/artifacts/$ARTIFACT_ID/zip" \
  -o sidecar_temp.zip

# Unzip and Move
echo "📂 Extracting Sidecar..."
unzip -o sidecar_temp.zip -d extracted_sidecar

# Find the .exe in the extracted folder (regardless of what it was named originally)
FOUND_EXE=$(find extracted_sidecar -name "*.exe" | head -n 1)

if [ -f "$FOUND_EXE" ]; then
    echo "✅ Found binary: $FOUND_EXE"
    mv "$FOUND_EXE" "$TARGET_FILE"
    echo "🚀 Moved to: $TARGET_FILE"
    rm sidecar_temp.zip
    rm -rf extracted_sidecar
else
    echo "❌ Error: No .exe found inside the artifact zip!"
    exit 1
fi

# ==========================================

# 6. Download Microsoft SDKs
echo "📥 Downloading Microsoft Windows SDKs..."
mkdir -p xwin
xwin splat --output ./xwin --accept-license

# 7. Build
npm install
echo "🚀 BUILDING TAURI APP..."
RUSTFLAGS="-Lnative=$(pwd)/xwin/crt/lib/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/um/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/ucrt/x86_64" \
npm run tauri build -- --target x86_64-pc-windows-msvc

echo "✅ DONE"