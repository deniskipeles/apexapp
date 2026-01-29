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
SIDECAR_NAME="apexkit" 
ARTIFACT_ID="5243988330"
REPO_OWNER="deniskipeles"
REPO_NAME="apex-kit"

TARGET_DIR="src-tauri/binaries"
TARGET_FILE="${TARGET_DIR}/${SIDECAR_NAME}-x86_64-pc-windows-msvc.exe"
mkdir -p "$TARGET_DIR"

AUTH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"

echo "📥 Downloading Sidecar Artifact ID: $ARTIFACT_ID from $REPO_OWNER/$REPO_NAME..."

# 1. Download the file
HTTP_CODE=$(curl -L -w "%{http_code}" \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/actions/artifacts/$ARTIFACT_ID/zip" \
  -o sidecar_temp.zip)

# 2. Check HTTP Status
if [ "$HTTP_CODE" -ne 200 ]; then
    echo "❌ Download Failed with HTTP Status: $HTTP_CODE"
    echo "⚠️ Content of response:"
    cat sidecar_temp.zip
    echo ""
    echo "👉 TIP: If Status is 404, the Artifact ID is expired or wrong."
    echo "👉 TIP: If Status is 401/403, your Token cannot access the other repo."
    exit 1
fi

# 3. Check File Size (JSON errors are small, Real Zips are big)
FILE_SIZE=$(wc -c < sidecar_temp.zip)
if [ "$FILE_SIZE" -lt 1000 ]; then
    echo "❌ Error: File is too small ($FILE_SIZE bytes). It is likely a JSON error, not a ZIP."
    cat sidecar_temp.zip
    exit 1
fi

# 4. Unzip
echo "📂 Extracting Sidecar..."
unzip -o sidecar_temp.zip -d extracted_sidecar

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

# FIX: Send the full word "yes" to satisfy the prompt
yes yes | xwin splat --output ./xwin

# 7. Build
npm install
echo "🚀 BUILDING TAURI APP..."
RUSTFLAGS="-Lnative=$(pwd)/xwin/crt/lib/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/um/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/ucrt/x86_64" \
npm run tauri build -- --target x86_64-pc-windows-msvc

echo "✅ DONE"
