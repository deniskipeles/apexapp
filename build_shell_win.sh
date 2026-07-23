#!/bin/bash
set -e

mkdir -p src-tauri/binaries
touch src-tauri/binaries/apexkit-x86_64-pc-windows-msvc.exe
touch src-tauri/binaries/cloudflared-x86_64-pc-windows-msvc.exe
touch src-tauri/binaries/frpc-x86_64-pc-windows-msvc.exe

mkdir -p src-tauri/.cargo
cat > src-tauri/.cargo/config.toml <<EOF
[target.x86_64-pc-windows-msvc]
linker = "lld-link"
runner = "cargo-xwin"
EOF

if [ ! -d "xwin" ]; then
    echo "📥 Downloading Microsoft Windows SDKs..."
    mkdir -p xwin
    yes yes | xwin splat --output ./xwin
    echo "✅ Microsoft Windows SDKs downloaded."
fi

rm -f src-tauri/Cargo.lock
npm install

export RUSTFLAGS="-Lnative=$(pwd)/xwin/crt/lib/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/um/x86_64 -Lnative=$(pwd)/xwin/sdk/lib/ucrt/x86_64"

npm run tauri build -- --target x86_64-pc-windows-msvc --no-bundle

echo "✅ Done"
echo "📁 Binary: src-tauri/target/x86_64-pc-windows-msvc/release/apexapp.exe"