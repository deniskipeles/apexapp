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

func main() {
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
	go startWebhookServer(*pluginPort)

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
				// Allow the base domain (for API & WSS) AND subdomains (for tunnels)
				if host == *domain || strings.HasSuffix(host, "."+*domain) {
					return nil
				}
				return fmt.Errorf("host not allowed: %s", host)
			},
			Cache: autocert.DirCache("certs"),
		}

		server := &http.Server{
			Addr:    ":443",
			Handler: mux,
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
	frpWsProxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", frpPort)})
	frpVhostProxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", vhostPort)})
	adminApiProxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", pluginPort)})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// 1. Route FRPC WebSocket connections
		if r.URL.Path == "/~!frp" || r.URL.Path == "/~frp" || r.URL.Path == "/_frpc" {
			frpWsProxy.ServeHTTP(w, r)
			return
		}
		// 2. Route Admin API
		if strings.HasPrefix(r.URL.Path, "/api/tokens") {
			adminApiProxy.ServeHTTP(w, r)
			return
		}
		
		// 3. Route to FRP VHost
		// CRITICAL FIX: Ensure the correct external Host is passed to FRPS
		// Check for PaaS load balancer headers first
		if forwardedHost := r.Header.Get("X-Forwarded-Host"); forwardedHost != "" {
			r.Host = forwardedHost
		}
		
		frpVhostProxy.ServeHTTP(w, r)
	})
}

func startWebhookServer(port int) {
	mux := http.NewServeMux()

	mux.HandleFunc("/frp-hook", func(w http.ResponseWriter, r *http.Request) {
		var req FrpRequest
		json.NewDecoder(r.Body).Decode(&req)
		resp := FrpResponse{Reject: true, RejectReason: "Unauthorized"}

		if req.Op == "NewProxy" {
			requestedDomain := ""
			
			// Extract either subdomain (Agency Mode) or custom domain (PaaS Mode)
			if sub, ok := req.Content["subdomain"].(string); ok && sub != "" {
				requestedDomain = sub
			} else if customDoms, ok := req.Content["custom_domains"].([]interface{}); ok && len(customDoms) > 0 {
				requestedDomain = customDoms[0].(string)
			}

			var token string
			if userObj, ok := req.Content["user"].(map[string]interface{}); ok {
				// Simply extract the token from the standard "user" field
				token, _ = userObj["user"].(string)
			}

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
				log.Printf("✅ Authorized tunnel: %s", requestedDomain)
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
		var payload struct { Domain string `json:"domain"` }
		json.NewDecoder(r.Body).Decode(&payload)

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
	if err != nil { log.Fatal(err) }
	db.Exec(`CREATE TABLE IF NOT EXISTS tunnel_tokens (token TEXT PRIMARY KEY, domain TEXT UNIQUE NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`)
}

func generateFRPSConfig(domain string, bindPort, vhostPort, pluginPort int) error {
	config := fmt.Sprintf(`
bindPort = %d
vhostHTTPPort = %d
subDomainHost = "%s"

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
	if _, err := os.Stat("frps"); err == nil { return nil }
	url := fmt.Sprintf("https://github.com/fatedier/frp/releases/download/v%s/frp_%s_linux_amd64.tar.gz", frpVersion, frpVersion)
	resp, _ := http.Get(url)
	defer resp.Body.Close()
	gzr, _ := gzip.NewReader(resp.Body)
	defer gzr.Close()
	tr := tar.NewReader(gzr)
	for {
		header, err := tr.Next()
		if err == io.EOF { break }
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