# Development and Contribution

ApexApp is built using the **Tauri** framework, combining a **Rust** backend with a **Vite/TypeScript** frontend.

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Node.js](https://nodejs.org/) (v18 or later)
- [npm](https://www.npmjs.com/)
- [Tauri Dependencies](https://tauri.app/v1/guides/getting-started/prerequisites) (platform specific)

## Project Structure

- `src/`: Frontend source code (TypeScript, HTML, CSS).
- `src-tauri/`: Rust backend code and Tauri configuration.
- `src-tauri/binaries/`: This is where the sidecar binaries are expected to live.

## Setting Up Sidecars

ApexApp relies on two external binaries placed in `src-tauri/binaries/`:
1. `apexkit`
2. `cloudflared`

You must name these according to Tauri's sidecar naming convention (e.g., `apexkit-x86_64-pc-windows-msvc.exe` or `apexkit-aarch64-apple-darwin`).

### For Local Development:
You can use the helper scripts provided in the root directory to help prepare the environment:
- `setup_and_build.sh`
- `prepare_macos.sh`
- `prepare_build_for_win7.sh`

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

## Building for Production

```bash
# Build the application
npm run tauri build
```

The resulting installers will be located in `src-tauri/target/release/bundle/`.

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Ensure your code follows the existing style (Tauri + Vanilla TS).
4. Submit a Pull Request with a clear description of your changes.
