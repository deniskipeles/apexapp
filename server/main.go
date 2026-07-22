// =========================== apexapp/server/main.go start here ===========================
package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/tls"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/acme/autocert"
	_ "modernc.org/sqlite" // Pure Go SQLite
)

const frpVersion = "0.54.0"

var db *sql.DB
var adminKey string

type FrpRequest struct {
	Op      string                 `json:"op"`
	Content map[string]interface{} `json:"content"`
}

type FrpResponse struct {
	Reject       bool   `json:"reject"`
	RejectReason string `json:"reject_reason"`
	Unchange     bool   `json:"unchange"`
}

// loadEnv reads a local .env file and sets environment variables for the process
func loadEnv() {
	bytes, err := os.ReadFile(".env")
	if err != nil {
		return // No .env file found; proceed with system environment variables
	}

	lines := strings.Split(string(bytes), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") {
			continue
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		val = strings.Trim(val, `"'`) // Remove surrounding quotes

		os.Setenv(key, val)
	}
}

func main() {
	// 1. Load environment variables from .env file first
	loadEnv()

	// Flags
	domain := flag.String("domain", "apexkit.io", "Base domain for Auto-TLS (Agency Mode)")
	paasMode := flag.Bool("paas", false, "Enable PaaS mode (Disables Auto-TLS, listens on single PORT)")
	frpPort := flag.Int("frp-port", 7000, "Internal Port for FRPC WebSocket")
	vhostPort := flag.Int("vhost-port", 8080, "Internal Port for FRPS HTTP Proxy")
	pluginPort := flag.Int("plugin-port", 9000, "Internal Port for FRP webhook")
	flag.Parse()

	// Environment Overrides
	if os.Getenv("PAAS_MODE") == "true" {
		*paasMode = true
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8000" // Default for PaaS
	}

	// 2. PREVENT PORT COLLISIONS
	var systemPort int
	fmt.Sscanf(port, "%d", &systemPort)
	if systemPort == *vhostPort {
		*vhostPort = systemPort + 1
		// Ensure we don't accidentally collide with the control port (7000) or plugin port (9000)
		if *vhostPort == *frpPort || *vhostPort == *pluginPort {
			*vhostPort = systemPort + 2
		}
		log.Printf("⚠️  System PORT and internal vhost-port collided on %d. Shifted internal vhost-port to %d", systemPort, *vhostPort)
	}

	adminKey = os.Getenv("ADMIN_KEY")
	if adminKey == "" {
		adminKey = generateRandomToken(16)
		log.Printf("⚠️  No ADMIN_KEY set. Generated temporary key: %s", adminKey)
	}

	initDB()

	if err := ensureFRPS(); err != nil {
		log.Fatalf("❌ Failed to setup FRPS: %v", err)
	}

	if err := generateFRPSConfig(*domain, *frpPort, *vhostPort, *pluginPort); err != nil {
		log.Fatalf("❌ Failed to generate config: %v", err)
	}

	go startFRPS()

	// PASS PAAS_MODE TO WEBHOOK SERVER
	go startWebhookServer(*pluginPort, *paasMode)

	// Setup Multiplexer (Routes Traffic to Webhook, FRPC WebSocket, or VHost)
	mux := http.NewServeMux()
	setupMultiplexer(mux, *frpPort, *vhostPort, *pluginPort)

	if *paasMode {
		log.Printf("☁️  Running in PaaS Mode. Listening on HTTP :%s", port)
		if err := http.ListenAndServe(":"+port, mux); err != nil {
			log.Fatalf("Server failed: %v", err)
		}
	} else {
		log.Printf("🔒 Running in Agency Mode (Auto-TLS) for *.%s", *domain)

		certManager := autocert.Manager{
			Prompt: autocert.AcceptTOS,
			HostPolicy: func(ctx context.Context, host string) error {
				if host == *domain || strings.HasSuffix(host, "."+*domain) {
					return nil
				}
				return fmt.Errorf("host not allowed: %s", host)
			},
			Cache: autocert.DirCache("certs"),
		}

		server := &http.Server{
			Addr:      ":443",
			Handler:   mux,
			TLSConfig: &tls.Config{GetCertificate: certManager.GetCertificate},
		}

		go func() {
			log.Println("🌐 Listening on HTTP (:80) for ACME challenges and redirects...")
			http.ListenAndServe(":80", certManager.HTTPHandler(nil))
		}()

		if err := server.ListenAndServeTLS("", ""); err != nil {
			log.Fatalf("HTTPS server failed: %v", err)
		}
	}
}

func setupMultiplexer(mux *http.ServeMux, frpPort, vhostPort, pluginPort int) {
	// Native, robust Reverse Proxy generator
	createProxy := func(targetPort int) *httputil.ReverseProxy {
		targetURL := &url.URL{
			Scheme: "http",
			Host:   fmt.Sprintf("127.0.0.1:%d", targetPort),
		}
		proxy := httputil.NewSingleHostReverseProxy(targetURL)

		// Fix for ReverseProxy modifying the host header, destroying VHost routing logic
		director := proxy.Director
		proxy.Director = func(req *http.Request) {
			originalHost := req.Host // Save original host before director modifies it
			director(req)
			
			// Ensure the Host header is passed intact to the backend (vhost matching needs it)
			if fwd := req.Header.Get("X-Forwarded-Host"); fwd != "" {
				req.Host = fwd
			} else {
				req.Host = originalHost
			}
		}

		proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			if err == context.Canceled || err == io.EOF {
				return
			}
			errStr := err.Error()
			if strings.Contains(errStr, "use of closed network connection") ||
				strings.Contains(errStr, "connection reset by peer") ||
				strings.Contains(errStr, "broken pipe") {
				return
			}
			if strings.Contains(errStr, "connect: connection refused") {
				w.Header().Set("Retry-After", "2")
				http.Error(w, "Tunnel engine warming up...", http.StatusServiceUnavailable)
				return
			}
			log.Printf("http: proxy error on port %d: %v", targetPort, err)
		}
		return proxy
	}

	frpWsProxy := createProxy(frpPort)
	frpVhostProxy := createProxy(vhostPort)
	adminApiProxy := createProxy(pluginPort)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Detect WebSocket intention robustly (Render may append ", h2c" or case varies)
		isWebSocket := strings.Contains(strings.ToLower(r.Header.Get("Upgrade")), "websocket")

		if isWebSocket {
			// 🚨 THE SILVER BULLET 🚨
			// Restore the stripped header so Go's native ReverseProxy knows to trigger its WebSocket engine!
			r.Header.Set("Connection", "Upgrade")
		}

		// Detect if it's frpc based on User-Agent heuristics
		userAgent := strings.ToLower(r.Header.Get("User-Agent"))
		isFrpClient := userAgent == "" || strings.Contains(userAgent, "go-http-client") || strings.Contains(userAgent, "frp")

		// 1. Route FRP Control Connections natively to TCP Port (7000)
		if isWebSocket && (isFrpClient || r.URL.Path == "/_frws" || r.URL.Path == "/_frpc" || r.URL.Path == "/~!frp" || r.URL.Path == "/~frp") {
			frpWsProxy.ServeHTTP(w, r)
			return
		}

		// 2. Route Admin API
		if strings.HasPrefix(r.URL.Path, "/api/tokens") {
			adminApiProxy.ServeHTTP(w, r)
			return
		}

		// 3. Route normal HTTP Website Traffic to VHost
		frpVhostProxy.ServeHTTP(w, r)
	})
}

func startWebhookServer(port int, isPaas bool) {
	mux := http.NewServeMux()

	mux.HandleFunc("/frp-hook", func(w http.ResponseWriter, r *http.Request) {
		var req FrpRequest
		json.NewDecoder(r.Body).Decode(&req)
		resp := FrpResponse{Reject: true, RejectReason: "Unauthorized"}

		if req.Op == "NewProxy" {
			requestedDomain := ""

			if sub, ok := req.Content["subdomain"].(string); ok && sub != "" {
				requestedDomain = sub
			} else if customDoms, ok := req.Content["custom_domains"].([]interface{}); ok && len(customDoms) > 0 {
				requestedDomain = customDoms[0].(string)
			}

			var token string
			if userObj, ok := req.Content["user"].(map[string]interface{}); ok {
				token, _ = userObj["user"].(string)
			}

			// PAAS MODE: Bypass SQLite, use ADMIN_KEY permanently
			if isPaas {
				if token == adminKey {
					resp.Reject = false
					resp.Unchange = true
					log.Printf("✅ Authorized PaaS tunnel: %s", requestedDomain)
				} else {
					resp.RejectReason = "Invalid Token (Expected ADMIN_KEY)"
				}
			} else {
				// AGENCY MODE: Use SQLite Token Registry
				var dbDomain string
				err := db.QueryRow("SELECT domain FROM tunnel_tokens WHERE token = ?", token).Scan(&dbDomain)

				if err == sql.ErrNoRows {
					resp.RejectReason = "Invalid or missing token"
				} else if err != nil {
					resp.RejectReason = "Internal Server Error"
				} else if dbDomain != requestedDomain {
					resp.RejectReason = fmt.Sprintf("Token not authorized for domain '%s'", requestedDomain)
				} else {
					resp.Reject = false
					resp.Unchange = true
					log.Printf("✅ Authorized Agency tunnel: %s", requestedDomain)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	mux.HandleFunc("/api/tokens", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+adminKey {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		var payload struct{ Domain string `json:"domain"` }
		json.NewDecoder(r.Body).Decode(&payload)

		// If PaaS Mode, just return the ADMIN_KEY so it doesn't try to write to SQLite
		if isPaas {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"token": adminKey, "domain": payload.Domain})
			return
		}

		token := generateRandomToken(24)
		_, err := db.Exec("INSERT INTO tunnel_tokens (token, domain) VALUES (?, ?)", token, payload.Domain)
		if err != nil {
			http.Error(w, "Domain already claimed", http.StatusConflict)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token, "domain": payload.Domain})
	})

	http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", port), mux)
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite", "tunnels.db")
	if err != nil {
		log.Fatal(err)
	}
	db.Exec(`CREATE TABLE IF NOT EXISTS tunnel_tokens (token TEXT PRIMARY KEY, domain TEXT UNIQUE NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`)
}

func generateFRPSConfig(domain string, bindPort, vhostPort, pluginPort int) error {
	custom404HTML := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tunnel Offline | ApexKit</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); text-align: center; max-width: 450px; width: 90%; }
        .icon-wrapper { display: inline-flex; align-items: center; justify-content: center; width: 120px; height: 120px; background-color: #fef2f2; border-radius: 50%; margin-bottom: 24px; }
        h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 12px 0; color: #0f172a; }
        p { color: #64748b; margin: 0 0 20px 0; line-height: 1.6; font-size: 0.95rem; }
        .footer { font-size: 0.85rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 10px; }
        a { color: #3b82f6; text-decoration: none; font-weight: 500; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon-wrapper">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
        </div>
        <h1>Tunnel is Offline</h1>
        <p>The ApexApp tunnel you are trying to reach is currently disconnected or unavailable.</p>
        <p>If you are the owner, please open your ApexApp dashboard and click <b>Start Managed Tunnel</b> to bring it back online.</p>
        <div class="footer">
            Powered by <a href="https://github.com/deniskipeles/apexkit" target="_blank">ApexKit</a> and <a href="https://github.com/deniskipeles/apexapp" target="_blank">ApexApp</a>
        </div>
    </div>
</body>
</html>`

	if err := os.WriteFile("404.html", []byte(custom404HTML), 0644); err != nil {
		return err
	}

	config := fmt.Sprintf(`
bindPort = %d
vhostHTTPPort = %d
subDomainHost = "%s"
custom404Page = "./404.html"

[[httpPlugins]]
name = "apex_auth"
addr = "127.0.0.1:%d"
path = "/frp-hook"
ops = ["NewProxy"]
`, bindPort, vhostPort, domain, pluginPort)

	return os.WriteFile("frps.toml", []byte(config), 0644)
}

func startFRPS() {
	cmd := exec.Command("./frps", "-c", "frps.toml")
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	cmd.Run()
}

func ensureFRPS() error {
	if _, err := os.Stat("frps"); err == nil {
		return nil
	}
	url := fmt.Sprintf("https://github.com/fatedier/frp/releases/download/v%s/frp_%s_linux_amd64.tar.gz", frpVersion, frpVersion)
	resp, _ := http.Get(url)
	defer resp.Body.Close()
	gzr, _ := gzip.NewReader(resp.Body)
	defer gzr.Close()
	tr := tar.NewReader(gzr)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if filepath.Base(header.Name) == "frps" {
			outFile, _ := os.OpenFile("frps", os.O_CREATE|os.O_RDWR|os.O_TRUNC, os.FileMode(header.Mode))
			io.Copy(outFile, tr)
			outFile.Close()
			return nil
		}
	}
	return fmt.Errorf("frps not found")
}

func generateRandomToken(length int) string {
	b := make([]byte, length/2)
	rand.Read(b)
	return hex.EncodeToString(b)
}
// =========================== apexapp/server/main.go ends here ===========================