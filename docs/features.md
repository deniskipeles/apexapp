# Features

ApexApp provides several key features to streamline development with ApexKit.

## Sidecar Execution
ApexApp manages ApexKit as a "sidecar" process. When you start the application, it can automatically boot up the ApexKit server, ensuring your backend is always ready when you are.

## Public Tunnels (Cloudflare)
Expose your local ApexKit instance to the internet without complex firewall configurations.
- **Quick Tunnels**: Generate a temporary `trycloudflare.com` URL.
- **Managed Tunnels**: Use your own Cloudflare Tunnel token to route through a custom domain.
- **QR Code Sharing**: Instantly generate a QR code for your tunnel URL, making it easy to test your app on physical mobile devices.

## Environment Variable Management
ApexApp includes a built-in `.env` editor. This allows you to manage the configuration of your ApexKit instance (like API keys, database paths, or port settings) directly from the desktop UI.

## Embedded Views
- **App View**: View the primary frontend served by ApexKit (usually at `localhost:5000`).
- **Dashboard View**: Access the full ApexKit Admin UI directly within the desktop window.
- **Window Management**: Toggle between viewing the content inside the app or opening it in a separate native window.

## Live Console
The "Console" tab provides a real-time stream of `stdout` and `stderr` from the ApexKit sidecar, color-coded for easy debugging of server-side events and errors.
