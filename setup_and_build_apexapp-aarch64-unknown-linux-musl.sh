#!/bin/bash
set -e

# ==============================================================================
# CONFIGURATION (ARM64 / aarch64 Linux Build)
# ==============================================================================
HF_DATASET="kipeles/apexkit-releases"
APEXKIT_VERSION="v0.1.0-beta.1"
VARIANT="perf" # "perf" (24.3 MB) or "small" (18.8 MB)

TARGET_TRIPLE="aarch64-unknown-linux-gnu"
MUSL_NAME="aarch64-unknown-linux-musl"
CF_ARCH="arm64"
FRP_ARCH="arm64"

TARGET_DIR="src-tauri/binaries"
mkdir -p "$TARGET_DIR"

echo "🚀 Starting Automated Linux ARM64 (aarch64) Build Pipeline..."

# ==============================================================================
# 1. AUTOMATED ENVIRONMENT SETUP (MULTIARCH + CROSS-COMPILER)
# ==============================================================================
HOST_ARCH=$(uname -m)

if [ "$HOST_ARCH" != "aarch64" ]; then
    echo "⚙️ Host is $HOST_ARCH. Setting up automated ARM64 cross-compilation environment..."

    if command -v apt-get &> /dev/null; then
        # 1. Enable arm64 multiarch architecture in dpkg
        sudo dpkg --add-architecture arm64

        # 2. Restrict existing studio/host sources to amd64 so local proxy never throws 404s
        sudo sed -i '/Architectures:/d' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true
        sudo sed -i '/^Types: deb/a Architectures: amd64' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true
        sudo sed -i 's/^deb http/deb [arch=amd64] http/g' /etc/apt/sources.list 2>/dev/null || true

        # 3. Add official Ubuntu Ports for arm64 packages
        sudo rm -f /etc/apt/sources.list.d/arm64.list
        sudo tee /etc/apt/sources.list.d/arm64.sources > /dev/null << 'EOF'
Types: deb
URIs: http://ports.ubuntu.com/ubuntu-ports
Suites: noble noble-updates noble-security
Components: main restricted universe multiverse
Architectures: arm64
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF

        # 4. Refresh package lists
        echo "📦 Updating package indexes (routing amd64 to local cache and arm64 to ports)..."
        sudo apt-get update

        # 5. Fix any broken dpkg states before proceeding
        sudo dpkg --configure -a || true
        sudo apt-get -o Dpkg::Options::="--force-overwrite" -f install -y

        # 6. Install cross-compilers and target arm64 libraries with force-overwrite (prevents pango conflicts)
        echo "📦 Installing ARM64 cross-toolchain and development libraries..."
        sudo apt-get install -y -o Dpkg::Options::="--force-overwrite" \
            gcc-aarch64-linux-gnu g++-aarch64-linux-gnu pkg-config \
            build-essential curl wget file libssl-dev xdg-utils unzip tar \
            libssl-dev:arm64 \
            libgtk-3-dev:arm64 \
            libayatana-appindicator3-dev:arm64 \
            librsvg2-dev:arm64 \
            libcups2-dev:arm64 \
            libwebkit2gtk-4.1-dev:arm64 || sudo apt-get install -y -o Dpkg::Options::="--force-overwrite" libwebkit2gtk-4.0-dev:arm64
    fi
else
    echo "💻 Running natively on aarch64."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y build-essential curl wget file libssl-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev xdg-utils unzip tar libcups2-dev \
            libwebkit2gtk-4.1-dev || sudo apt-get install -y libwebkit2gtk-4.0-dev
    fi
fi

# ==============================================================================
# 2. RUST TOOLCHAIN SETUP
# ==============================================================================
if ! command -v cargo &> /dev/null; then
    echo "🦀 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

echo "🦀 Adding Rust target: ${TARGET_TRIPLE}..."
rustup target add "$TARGET_TRIPLE"
rm -f src-tauri/.cargo/config.toml

# ==============================================================================
# 3. DOWNLOAD APEXKIT SIDECAR (ARM64 MUSL from Hugging Face)
# ==============================================================================
APEX_ARCHIVE="apexkit-${MUSL_NAME}-${VARIANT}.tar.gz"
HF_URL="https://huggingface.co/datasets/${HF_DATASET}/resolve/main/${APEXKIT_VERSION}/${APEX_ARCHIVE}?download=true"
APEX_BIN="${TARGET_DIR}/apexkit-${TARGET_TRIPLE}"
APEX_MUSL_BIN="${TARGET_DIR}/apexkit-${MUSL_NAME}"

echo "📥 Downloading ApexKit (${MUSL_NAME}-${VARIANT}) from Hugging Face..."
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

HTTP_CODE=$(curl -L -w "%{http_code}" "$HF_URL" -o "$TEMP_DIR/$APEX_ARCHIVE")
if [ "$HTTP_CODE" -ne 200 ]; then
    echo "❌ Download failed with HTTP $HTTP_CODE from $HF_URL"
    exit 1
fi

tar -xzf "$TEMP_DIR/$APEX_ARCHIVE" -C "$TEMP_DIR"
FOUND_BIN=$(find "$TEMP_DIR" -type f \( -name "apexkit" -o -name "apexkit.exe" \) | head -n 1)

cp "$FOUND_BIN" "$APEX_BIN"
cp "$FOUND_BIN" "$APEX_MUSL_BIN"
chmod +x "$APEX_BIN" "$APEX_MUSL_BIN"
echo "✅ ApexKit sidecar ready."

# ==============================================================================
# 4. DOWNLOAD CLOUDFLARED (ARM64)
# ==============================================================================
CF_BIN="${TARGET_DIR}/cloudflared-${TARGET_TRIPLE}"
if [ ! -f "$CF_BIN" ]; then
    echo "📥 Downloading cloudflared (Linux arm64)..."
    curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o "$CF_BIN"
    cp "$CF_BIN" "${TARGET_DIR}/cloudflared-${MUSL_NAME}"
    chmod +x "$CF_BIN" "${TARGET_DIR}/cloudflared-${MUSL_NAME}"
fi
echo "✅ Cloudflared sidecar ready."

# ==============================================================================
# 5. DOWNLOAD FRPC (ARM64)
# ==============================================================================
FRPC_BIN="${TARGET_DIR}/frpc-${TARGET_TRIPLE}"
if [ ! -f "$FRPC_BIN" ]; then
    FRP_VER=$(curl -s "https://api.github.com/repos/fatedier/frp/releases/latest" | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
    echo "📥 Downloading frpc v${FRP_VER} (Linux arm64)..."
    curl -L "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_${FRP_ARCH}.tar.gz" -o "$TEMP_DIR/frp.tar.gz"
    tar -xzf "$TEMP_DIR/frp.tar.gz" -C "$TEMP_DIR"
    cp "$TEMP_DIR/frp_${FRP_VER}_linux_${FRP_ARCH}/frpc" "$FRPC_BIN"
    cp "$FRPC_BIN" "${TARGET_DIR}/frpc-${MUSL_NAME}"
    chmod +x "$FRPC_BIN" "${TARGET_DIR}/frpc-${MUSL_NAME}"
fi
echo "✅ frpc sidecar ready."

# ==============================================================================
# 6. EXPORT CROSS-COMPILATION FLAGS
# ==============================================================================
export PKG_CONFIG_ALLOW_CROSS=1
export PKG_CONFIG_SYSROOT_DIR=/
export PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc

# ==============================================================================
# 7. BUILD APP
# ==============================================================================
rm -f src-tauri/Cargo.lock
npm install

echo "🚀 Compiling Tauri application for ${TARGET_TRIPLE}..."
npm run tauri build -- --target "$TARGET_TRIPLE"

echo ""
echo "🎉 Build finished successfully!"
echo "📁 Output bundles located in:"
ls -lh "src-tauri/target/${TARGET_TRIPLE}/release/bundle/deb/"*.deb 2>/dev/null || true
ls -lh "src-tauri/target/${TARGET_TRIPLE}/release/bundle/appimage/"*.AppImage 2>/dev/null || true
ls -lh "src-tauri/target/${TARGET_TRIPLE}/release/bundle/rpm/"*.rpm 2>/dev/null || true