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
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/acme/autocert"
	_ "modernc.org/sqlite"
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

func loadEnv() {
	bytes, err := os.ReadFile(".env")
	if err != nil {
		return
	}
	lines := strings.Split(string(bytes), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			os.Setenv(strings.TrimSpace(parts[0]), strings.Trim(strings.TrimSpace(parts[1]), `"'`))
		}
	}
}

func main() {
	loadEnv()

	domain := flag.String("domain", "apexkit.io", "Base domain for Auto-TLS")
	paasMode := flag.Bool("paas", false, "Enable PaaS mode")
	frpPort := flag.Int("frp-port", 7000, "Internal Port for FRPC WebSocket")
	vhostPort := flag.Int("vhost-port", 8080, "Internal Port for FRPS HTTP Proxy")
	pluginPort := flag.Int("plugin-port", 9000, "Internal Port for FRP webhook")
	flag.Parse()

	if os.Getenv("PAAS_MODE") == "true" {
		*paasMode = true
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	var systemPort int
	fmt.Sscanf(port, "%d", &systemPort)
	if systemPort == *vhostPort {
		*vhostPort = systemPort + 1
		if *vhostPort == *frpPort || *vhostPort == *pluginPort {
			*vhostPort = systemPort + 2
		}
		log.Printf("⚠️  System PORT collided. Shifted vhost-port to %d", *vhostPort)
	}

	adminKey = os.Getenv("ADMIN_KEY")
	if adminKey == "" {
		adminKey = generateRandomToken(16)
	}

	initDB()

	if err := ensureFRPS(); err != nil {
		log.Fatalf("❌ Failed to setup FRPS: %v", err)
	}

	if err := generateFRPSConfig(*domain, *frpPort, *vhostPort, *pluginPort); err != nil {
		log.Fatalf("❌ Failed to generate config: %v", err)
	}

	go startFRPS()
	go startWebhookServer(*pluginPort, *paasMode)

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
		go http.ListenAndServe(":80", certManager.HTTPHandler(nil))
		if err := server.ListenAndServeTLS("", ""); err != nil {
			log.Fatalf("HTTPS server failed: %v", err)
		}
	}
}

// robustWebSocketProxy manually proxies the WebSocket upgrade request.
// It bypasses Go's httputil.ReverseProxy which aggressively strips "Connection: Upgrade"
func robustWebSocketProxy(w http.ResponseWriter, r *http.Request, targetPort int) {
	backend, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", targetPort))
	if err != nil {
		http.Error(w, "Tunnel backend offline", http.StatusServiceUnavailable)
		return
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		// If Hijack isn't supported (e.g., HTTP/2), gracefully fail back to reverse proxy
		backend.Close()
		http.Error(w, "Hijack not supported", http.StatusHTTPVersionNotSupported)
		return
	}
	clientConn, _, err := hj.Hijack()
	if err != nil {
		backend.Close()
		return
	}

	// 1. Manually build the outbound request to guarantee headers are not stripped
	reqURI := r.URL.RequestURI()
	if reqURI == "" {
		reqURI = "/"
	}
	fmt.Fprintf(backend, "%s %s HTTP/1.1\r\n", r.Method, reqURI)
	fmt.Fprintf(backend, "Host: %s\r\n", r.Host)
	fmt.Fprintf(backend, "Connection: Upgrade\r\n")
	fmt.Fprintf(backend, "Upgrade: websocket\r\n")

	// Pass original headers
	for k, vv := range r.Header {
		lowerK := strings.ToLower(k)
		if lowerK == "connection" || lowerK == "upgrade" || lowerK == "host" {
			continue
		}
		for _, v := range vv {
			fmt.Fprintf(backend, "%s: %s\r\n", k, v)
		}
	}
	fmt.Fprintf(backend, "\r\n")

	// 2. Safely proxy streams in both directions without premature closure
	errc := make(chan error, 2)
	go func() {
		_, err := io.Copy(backend, clientConn)
		errc <- err
	}()
	go func() {
		_, err := io.Copy(clientConn, backend)
		errc <- err
	}()

	<-errc
	clientConn.Close()
	backend.Close()
}

func setupMultiplexer(mux *http.ServeMux, frpPort, vhostPort, pluginPort int) {
	createProxy := func(targetPort int) *httputil.ReverseProxy {
		targetURL := &url.URL{
			Scheme: "http",
			Host:   fmt.Sprintf("127.0.0.1:%d", targetPort),
		}
		proxy := httputil.NewSingleHostReverseProxy(targetURL)
		director := proxy.Director
		proxy.Director = func(req *http.Request) {
			originalHost := req.Host
			director(req)
			if fwd := req.Header.Get("X-Forwarded-Host"); fwd != "" {
				req.Host = fwd
			} else {
				req.Host = originalHost
			}
		}
		return proxy
	}

	frpVhostProxy := createProxy(vhostPort)
	adminApiProxy := createProxy(pluginPort)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		isWebSocket := strings.Contains(strings.ToLower(r.Header.Get("Upgrade")), "websocket")
		isFRPPath := path == "/~!frp" || path == "/~frp" || path == "/_frws" || path == "/_frpc" || path == "/_frpws"
		
		userAgent := strings.ToLower(r.Header.Get("User-Agent"))
		isFrpClient := userAgent == "" || strings.Contains(userAgent, "go-http-client") || strings.Contains(userAgent, "frp")

		// Route FRP Control Connections safely
		if isFRPPath || (isWebSocket && isFrpClient) {
			robustWebSocketProxy(w, r, frpPort)
			return
		}

		// Route Admin API Connections
		if strings.HasPrefix(path, "/api/tokens") {
			adminApiProxy.ServeHTTP(w, r)
			return
		}

		// Route App Traffic
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

			if isPaas {
				if token == adminKey {
					resp.Reject = false
					resp.Unchange = true
				}
			} else {
				var dbDomain string
				err := db.QueryRow("SELECT domain FROM tunnel_tokens WHERE token = ?", token).Scan(&dbDomain)
				if err == nil && dbDomain == requestedDomain {
					resp.Reject = false
					resp.Unchange = true
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

		if isPaas {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"token": adminKey, "domain": payload.Domain})
			return
		}

		token := generateRandomToken(24)
		db.Exec("INSERT INTO tunnel_tokens (token, domain) VALUES (?, ?)", token, payload.Domain)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token, "domain": payload.Domain})
	})
	http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", port), mux)
}

func initDB() {
	db, _ = sql.Open("sqlite", "tunnels.db")
	db.Exec(`CREATE TABLE IF NOT EXISTS tunnel_tokens (token TEXT PRIMARY KEY, domain TEXT UNIQUE NOT NULL);`)
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