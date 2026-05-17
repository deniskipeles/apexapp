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

# 1. Create empty dummy files to satisfy Tauri's sidecar checker
mkdir -p src-tauri/binaries
touch src-tauri/binaries/apexkit-x86_64-pc-windows-msvc.exe
touch src-tauri/binaries/cloudflared-x86_64-pc-windows-msvc.exe
touch src-tauri/binaries/frpc-x86_64-pc-windows-msvc.exe

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
npm run tauri build -- --target x86_64-pc-windows-msvc --no-bundle

echo "✅ DONE"