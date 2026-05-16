# 🚀 ApexKit Managed Tunnels Documentation

ApexKit includes a built-in, fully managed tunneling system powered by **FRP (Fast Reverse Proxy)** and **Golang**. This allows users of your Tauri desktop app to securely expose their local environment to the public internet using WebSockets (WSS), seamlessly bypassing corporate firewalls and NATs.

The server operates as a **Single-Port Multiplexer**, meaning it can simultaneously serve Let's Encrypt SSL certificates, manage an Admin REST API, and route WebSocket tunnel traffic—all over standard HTTPS (Port 443).

There are two ways to deploy the tunnel server:
1. **Agency Mode (VPS)**: Ideal for agencies offering unlimited `*.youragency.com` subdomains with Auto-TLS.
2. **PaaS Mode (Koyeb/Render)**: Ideal for students deploying a free, single-domain tunnel.

---

## 🛠️ Step 1: Server Preparation (Both Modes)

Before deploying, ensure your Go module is initialized and dependencies are downloaded. 
Run this locally on your machine inside the `apexapp/server` folder:

```bash
cd apexapp/server
go mod tidy
```
This resolves all dependencies (like SQLite and Let's Encrypt modules) and generates your `go.sum` file.

---

## 🌍 Step 2: Choose Your Deployment Mode

### Option A: Agency Mode (VPS + Wildcard Domain)
*Use this if you own a domain and rent a Linux VPS (DigitalOcean, Hetzner, AWS, etc.).*

**1. Configure DNS:**
Log into your domain registrar (e.g., Cloudflare, Namecheap) and create two **A Records** pointing to your VPS IP address:
* `youragency.com` 
* `*.youragency.com`

**2. Deploy via Docker:**
SSH into your VPS and run the server using Docker. 
*(Note: We use `--network host` so the server can bind directly to ports 80 and 443 for Let's Encrypt).*

```bash
# Build the image
docker build -t apex-tunnel .

# Create a file for the database to ensure it persists
touch tunnels.db

# Run the container
docker run -d \
  --name apex-tunnel \
  --network host \
  --restart always \
  -v $(pwd)/certs:/app/certs \
  -v $(pwd)/tunnels.db:/app/tunnels.db \
  -e ADMIN_KEY="your_super_secret_key" \
  apex-tunnel \
  ./apex-tunnel-server -domain youragency.com
```

### Option B: PaaS Mode (Free Render / Koyeb)
*Use this if you want to host the server for free on a Platform-as-a-Service.*

1. Push your `apexapp/server` folder to a GitHub repository.
2. Go to your PaaS dashboard (Koyeb, Render, Railway) and create a new Web Service from that repository.
3. Use the **Dockerfile** deployment method.
4. Set the following **Environment Variables** in the dashboard:
   * `PAAS_MODE` = `true`
   * `ADMIN_KEY` = `your_super_secret_key`
5. The PaaS will automatically assign you a domain (e.g., `my-tunnel.koyeb.app`) and handle the SSL certificates for you.

---

## 🔑 Step 3: Generating Access Tokens (Admin API)

To prevent abuse, the FRPS server uses an SQLite database to verify connections. A tunnel connection is only allowed if the user provides a valid **Token** that matches their assigned **Domain**.

To generate a token for a user, make a `POST` request to your server's `/api/tokens` endpoint using your `ADMIN_KEY`.

#### Example for Agency Mode (Generating a Subdomain)
```bash
curl -X POST https://youragency.com:9000/api/tokens \
     -H "Authorization: Bearer your_super_secret_key" \
     -H "Content-Type: application/json" \
     -d '{"domain": "joes-app"}'
```
*Note: In Agency mode, the API port is `9000` by default. Ensure your firewall allows port 9000.*

#### Example for PaaS Mode (Generating a Custom Domain)
```bash
curl -X POST https://my-tunnel.koyeb.app/api/tokens \
     -H "Authorization: Bearer your_super_secret_key" \
     -H "Content-Type: application/json" \
     -d '{"domain": "my-tunnel.koyeb.app"}'
```

**JSON Response:**
```json
{
  "token": "e4a2b6c8d0f1e3a5c7b9d2f4",
  "domain": "joes-app"
}
```
*Give this Token and Domain to the end-user.*

---

## 💻 Step 4: Connecting via the Tauri Client App

The end-user opens the ApexApp desktop application and navigates to **Settings -> Managed Public Tunnel**.

They simply fill out the form using the credentials you provided:

| Field | Agency Mode Example | PaaS Mode Example |
| :--- | :--- | :--- |
| **Server Address** | `youragency.com` | `my-tunnel.koyeb.app` |
| **Domain / Subdomain** | `joes-app` | `my-tunnel.koyeb.app` |
| **Tunnel Token** | `e4a2b6c8d0f1e3a5...` | `e4a2b6c8d0f1e3a5...` |

**What happens when they click "Start Managed Tunnel"?**
1. The Rust backend dynamically generates an `frpc.toml` configuration file.
2. It sets the transport protocol to `wss` (WebSocket Secure), targeting port `443` and path `/_frpc`.
3. It embeds the secure `token` into the `[metas]` block.
4. The local `frpc` binary boots up, connects to the server, and the Go Server intercepts the request.
5. The Go Server checks the SQLite database. If the token matches the requested domain, the tunnel opens immediately!

The user will see **Tunnel Online** in green, and their public URL will be ready to share.

---

## 🩺 Troubleshooting & FAQ

**Q: My Agency server fails to get a Let's Encrypt certificate.**
* **A:** Ensure ports `80` and `443` are open on your VPS firewall (e.g., `ufw allow 80 && ufw allow 443`). Ensure you used `--network host` in the Docker run command. Let's Encrypt requires port 80 to solve the HTTP-01 challenge.

**Q: The Tauri App says "Tunnel Error: Invalid Token or Domain mismatch."**
* **A:** Ensure the user typed the exact Domain/Subdomain you provisioned in Step 3. If they try to claim `apple` but their token was generated for `banana`, the Go server's Webhook will instantly reject the connection.

**Q: How do I back up my tokens?**
* **A:** All tokens are stored in `tunnels.db`. If you ran the Docker command with `-v $(pwd)/tunnels.db:/app/tunnels.db`, simply download or backup that file from your VPS.

**Q: Does WSS (WebSockets) add latency?**
* **A:** WSS multiplexing adds a microscopic amount of overhead, but it ensures that 99.9% of corporate firewalls, strict school networks, and PaaS load balancers will allow the tunnel traffic through, as it looks exactly like standard, secure web traffic.