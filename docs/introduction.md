# Introduction to ApexApp

**ApexApp** is a cross-platform desktop application built with [Tauri](https://tauri.app/) that serves as a powerful management wrapper for [ApexKit](https://github.com/deniskipeles/apexkit).

It is designed for developers who want to use ApexKit as a local development backend or expose their local ApexKit instance to the internet for testing, collaboration, or mobile development.

## What is ApexKit?

ApexKit is an AI-native, multi-tenant backend in a single binary. It includes:
- **Embedded SQLite Database**: High-performance storage.
- **Auto-generated APIs**: Instant REST and GraphQL endpoints.
- **Vector Search Engine**: Native semantic search capabilities.
- **Edge Scripting**: Run JavaScript logic directly within the Rust backend.
- **AI Architect**: Chat-driven schema and script generation.

## Why ApexApp?

While ApexKit is powerful on its own, ApexApp provides a GUI layer to simplify common development workflows:

1. **Sidecar Management**: Automatically starts and stops the ApexKit binary.
2. **Public Exposure**: Integrated Cloudflare Tunnels to share your local environment with a single click.
3. **Environment Management**: A built-in editor for `.env` files used by ApexKit.
4. **Live Monitoring**: Real-time console logs from the ApexKit sidecar.
5. **Mobile Testing**: Built-in QR code generation for quick access to the tunnel URL on mobile devices.
