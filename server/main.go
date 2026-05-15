package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/tls"
	"database/sql"
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
	"crypto/rand"
	"encoding/hex"

	"golang.org/x/crypto/acme/autocert"
	_ "modernc.org/sqlite" // Pure Go SQLite driver
)

const frpVersion = "0.54.0"

var db *sql.DB
var adminKey string

// FRP Webhook Structs
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
	domain := flag.String("domain", "apexkit.io", "Base domain for the tunnels")
	frpPort := flag.Int("frp-port", 7000, "Port for FRPC clients")
	vhostPort := flag.Int("vhost-port", 8080, "Internal HTTP port for FRPS")
	pluginPort := flag.Int("plugin-port", 9000, "Internal port for FRP webhook and Admin API")
	flag.Parse()

	// Load Admin Key from Environment
	adminKey = os.Getenv("ADMIN_KEY")
	if adminKey == "" {
		adminKey = generateRandomToken(16)
		log.Printf("⚠️  No ADMIN_KEY set. Generated temporary key: %s", adminKey)
	}

	log.Printf("🚀 Starting Apex Tunnel Server for *.%s", *domain)

	// 1. Init SQLite
	initDB()

	// 2. Ensure FRPS binary exists
	if err := ensureFRPS(); err != nil {
		log.Fatalf("❌ Failed to setup FRPS: %v", err)
	}

	// 3. Generate frps.toml
	if err := generateFRPSConfig(*domain, *frpPort, *vhostPort, *pluginPort); err != nil {
		log.Fatalf("❌ Failed to generate config: %v", err)
	}

	// 4. Start FRPS
	go startFRPS()

	// 5. Start Management/Webhook Server (Port 9000)
	go startManagementServer(*pluginPort)

	// 6. Setup Auto-HTTPS Reverse Proxy
	target, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", *vhostPort))
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = req.URL.Host
	}

	certManager := autocert.Manager{
		Prompt: autocert.AcceptTOS,
		HostPolicy: func(ctx context.Context, host string) error {
			if host == *domain || strings.HasSuffix(host, "."+*domain) {
				return nil
			}
			return fmt.Errorf("acme/autocert: host not allowed: %s", host)
		},
		Cache: autocert.DirCache("certs"),
	}

	server := &http.Server{
		Addr:    ":443",
		Handler: proxy,
		TLSConfig: &tls.Config{
			GetCertificate: certManager.GetCertificate,
		},
	}

	go func() {
		log.Println("🌐 Listening on HTTP (:80) for ACME challenges and redirects...")
		h := certManager.HTTPHandler(nil)
		err := http.ListenAndServe(":80", h)
		if err != nil { log.Fatalf("HTTP server failed: %v", err) }
	}()

	log.Println("🔒 Listening on HTTPS (:443) with Auto-TLS...")
	err := server.ListenAndServeTLS("", "")
	if err != nil { log.Fatalf("HTTPS server failed: %v", err) }
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite", "tunnels.db")
	if err != nil { log.Fatalf("Failed to open DB: %v", err) }

	query := `
	CREATE TABLE IF NOT EXISTS tunnel_tokens (
		token TEXT PRIMARY KEY,
		subdomain TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`
	if _, err := db.Exec(query); err != nil {
		log.Fatalf("Failed to init table: %v", err)
	}
}

// --- FRP CONFIGURATION ---

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

// --- INTERNAL MANAGEMENT API & WEBHOOK ---

func startManagementServer(port int) {
	mux := http.NewServeMux()

	// FRP Webhook Endpoint
	mux.HandleFunc("/frp-hook", func(w http.ResponseWriter, r *http.Request) {
		var req FrpRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		resp := FrpResponse{Reject: true, RejectReason: "Unauthorized"}

		if req.Op == "NewProxy" {
			// Extract subdomain and token from metadata
			subdomain, _ := req.Content["subdomain"].(string)
			
			// FRP nests metas inside the user object
			var token string
			if userObj, ok := req.Content["user"].(map[string]interface{}); ok {
				if metas, ok := userObj["metas"].(map[string]interface{}); ok {
					token, _ = metas["token"].(string)
				}
			}

			// Validate against SQLite
			var dbSubdomain string
			err := db.QueryRow("SELECT subdomain FROM tunnel_tokens WHERE token = ?", token).Scan(&dbSubdomain)
			
			if err == sql.ErrNoRows {
				resp.RejectReason = "Invalid or missing token"
			} else if err != nil {
				log.Printf("DB Error: %v", err)
				resp.RejectReason = "Internal Server Error"
			} else if dbSubdomain != subdomain {
				resp.RejectReason = fmt.Sprintf("Token is not authorized for subdomain '%s'", subdomain)
			} else {
				// Success!
				resp.Reject = false
				resp.Unchange = true
				log.Printf("✅ Authorized tunnel: %s", subdomain)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	// Admin API to provision new tokens
	// Usage: POST /api/tokens {"subdomain": "joes-app"} Header: Authorization: Bearer <ADMIN_KEY>
	mux.HandleFunc("/api/tokens", func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader != "Bearer "+adminKey {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload struct { Subdomain string `json:"subdomain"` }
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.Subdomain == "" {
			http.Error(w, "Invalid payload", http.StatusBadRequest)
			return
		}

		token := generateRandomToken(24)

		_, err := db.Exec("INSERT INTO tunnel_tokens (token, subdomain) VALUES (?, ?)", token, payload.Subdomain)
		if err != nil {
			http.Error(w, "Subdomain already claimed or DB error", http.StatusConflict)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"token":     token,
			"subdomain": payload.Subdomain,
		})
	})

	log.Printf("🛠️  Management API & FRP Webhook listening on 127.0.0.1:%d", port)
	http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", port), mux)
}

func generateRandomToken(length int) string {
	b := make([]byte, length/2)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func startFRPS() {
	log.Println("⚙️  Starting FRPS daemon...")
	cmd := exec.Command("./frps", "-c", "frps.toml")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil { log.Fatalf("FRPS exited: %v", err) }
}

func ensureFRPS() error {
	if _, err := os.Stat("frps"); err == nil { return nil }
	log.Printf("📥 Downloading FRPS v%s...", frpVersion)
	url := fmt.Sprintf("https://github.com/fatedier/frp/releases/download/v%s/frp_%s_linux_amd64.tar.gz", frpVersion, frpVersion)
	resp, err := http.Get(url)
	if err != nil { return err }
	defer resp.Body.Close()
	gzr, err := gzip.NewReader(resp.Body)
	if err != nil { return err }
	defer gzr.Close()
	tr := tar.NewReader(gzr)
	for {
		header, err := tr.Next()
		if err == io.EOF { break }
		if err != nil { return err }
		if filepath.Base(header.Name) == "frps" {
			outFile, err := os.OpenFile("frps", os.O_CREATE|os.O_RDWR|os.O_TRUNC, os.FileMode(header.Mode))
			if err != nil { return err }
			if _, err := io.Copy(outFile, tr); err != nil {
				outFile.Close()
				return err
			}
			outFile.Close()
			return nil
		}
	}
	return fmt.Errorf("frps binary not found in archive")
}