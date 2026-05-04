# ApexApp

[![ApexKit](https://img.shields.io/badge/Powered%20By-ApexKit-orange)](https://github.com/deniskipeles/apexkit)
[![Tauri](https://img.shields.io/badge/Built%20With-Tauri-blue)](https://tauri.app/)

**ApexApp** is the official desktop management suite for **ApexKit**. It provides a powerful, cross-platform interface to run, manage, and expose your AI-native backend.

<p align="center">
  <img src="app-icon.png" width="128" alt="ApexApp Logo">
</p>

## 🚀 Overview

ApexApp wraps the [ApexKit](https://github.com/deniskipeles/apexkit) server into a convenient desktop application, adding essential development tools like integrated Cloudflare Tunnels, `.env` management, and real-time log monitoring.

### Key Features

- **One-Click Backend**: Automatically starts the ApexKit sidecar server.
- **Instant Public Access**: Integrated Cloudflare Tunnels (Quick & Managed).
- **QR Code Sharing**: Share your local dev server to mobile devices instantly.
- **Environment Editor**: GUI for managing your `.env` configuration.
- **Live Logs**: Real-time console for monitoring server activity.
- **Dual View**: Seamlessly switch between your App and the ApexKit Dashboard.

## 📚 Documentation

For more detailed information, please refer to the documentation in the `docs/` directory:

- [**Introduction**](docs/introduction.md) - What is ApexApp and ApexKit?
- [**Features**](docs/features.md) - Detailed breakdown of what ApexApp can do.
- [**Development**](docs/development.md) - How to build and contribute to ApexApp.

## 🛠️ Getting Started

### Prerequisites

You will need the `apexkit` and `cloudflared` binaries for your platform placed in `src-tauri/binaries/`.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/deniskipeles/apexapp.git
   cd apexapp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the app:
   ```bash
   npm run tauri dev
   ```

## 🤝 Contributing

Contributions are welcome! Please see the [Development Guide](docs/development.md) for more information on how to get started.

## 📄 License

This project is licensed under the MIT License.
