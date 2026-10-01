# ApexApp & ApexClient: Complete Technical Documentation

ApexApp is a cross-platform desktop application host and hardware runtime bridge built on [Tauri v2](https://tauri.app/). It acts as an execution shell for [ApexKit](https://github.com/deniskipeles/apexkit) and web applications, exposing operating system and point-of-sale (POS) hardware capabilities to sandboxed iframes.

ApexClient is its mobile companion for Android and iOS, providing a native mobile shell with adaptive theming, optical camera scanning, Wi-Fi/tunnel routing, and hardware haptics.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           HOST APPLICATION ECOSYSTEM                            │
├────────────────────────────────────────┬────────────────────────────────────────┤
│          DESKTOP SHELL (apexapp)       │       MOBILE CLIENT (apexclient)       │
│  - Tauri v2 (Rust + Vite / TypeScript) │  - Tauri v2 Mobile (Android / iOS)     │
│  - Sidecar Supervisor (ApexKit, FRP)   │  - Workspace Manager (Multi-Host)      │
│  - Hardware Bridges (Printers, Scales) │  - Native Bottom Sheets & Viewfinder   │
│  - Multi-Format File Exporter          │  - Dynamic System Theme (Light / Dark) │
│  - Local LAN & Cloudflare Tunnels      │  - Tactile Haptics & Camera Engine     │
└───────────────────────────────────┬────┴────────────────────────────────────────┘
                                    │ window.postMessage (HTML5 Bridge)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      SANDBOXED WEB APPLICATION (IFRAME)                         │
│  Running at http://localhost:5000, 192.168.x.x, or public tunnel (WSS / CF)     │
│  (React, Vue, Svelte, Angular, Solid, or Plain Vanilla JavaScript)              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Because iframes operate within an isolated security sandbox across loopback origins, regular browser APIs block access to serial ports, hardware printers, cash drawer solenoids, cross-origin clipboards, and local filesystems. ApexApp and ApexClient bridge this boundary using a bidirectional `window.postMessage` RPC contract.

---

## 2. Core Functional Modules

### A. Point-of-Sale (POS) & Retail Hardware
* **Hardware Thermal Printing:** Dispatches raw ESC/POS binary or formatted HTML directly to system spoolers (supports 58mm and 80mm paper widths).
* **Cash Drawer Solenoid Kick:** Fires standard ESC/POS pulses (`ESC p m t1 t2`) to RJ11/RJ12 ports on pin 2 (`0x00`) or pin 5 (`0x01`).
* **Digital RS-232 / USB Weighing Scales:** Reads ASCII weight strings from COM serial ports with stability status parsing.
* **Customer-Facing Pole Displays:** Sends text to 2-line VFD customer displays with screen clearing (`0x0C`) and cursor positioning.

### B. Barcode & Optical Vision Engine
* **Optical Camera Scanner:** Accesses webcams or mobile cameras with barcode detection (QR, EAN-13, EAN-8, Code-128, Code-39, UPC-A, UPC-E).
* **Handheld USB HID Barcode Wedge:** Captures rapid keyboard-buffer wedges from physical laser scanners without requiring focus on a specific input field.

### C. Filesystem & Multi-Format Exporter
* **Universal File Export:** Accepts Base64 data and writes files in formats such as `.pdf`, `.xlsx`, `.csv`, `.docx`, `.png`, `.jpg`, `.txt`, and `.json`.
* **Native Auto-Open:** Automatically launches exported files in the default OS handler (e.g., Microsoft Excel, Adobe Acrobat) without showing a browser download bar.
* **Directory Picker:** Uses native dialogs (`System.Windows.Forms` on Windows, `osascript` on macOS, `zenity`/`kdialog` on Linux).

### D. Device Ergonomics & OS Controls
* **Screen WakeLock:** Prevents system sleep or display dimming during active shifts.
* **Kiosk & Fullscreen Mode:** Pins windows to the top, removes borders, and disables window resizing.
* **Hardware Speaker Tone:** Generates frequency-based audio alerts through system hardware, avoiding browser audio gesture restrictions.
* **Mobile Haptics:** Provides vibration profiles (`light`, `medium`, `heavy`, `success`, `error`).
* **Biometric & Supervisor Authentication:** Triggers system prompts (Windows Hello, macOS Touch ID/admin dialogs, Linux polkit/zenity) for manager approvals and overrides.

### E. Telemetry & Networking
* **Battery & Power Telemetry:** Monitors battery percentage, AC adapter status, and charging states.
* **Network & Gateway Ping Diagnostics:** Checks internet connectivity and round-trip TCP gateway latency.
* **Local LAN / Wi-Fi Sharing:** Extracts network IPs, sets up `HOST=0.0.0.0`, and generates QR codes for instant mobile device connections.
* **Tunnels:** Supports Cloudflare Quick/Managed Tunnels and WebSocket-multiplexed FRP connections.

---

## 3. Client Integration Library (`apexapp.ts`)

Save this file as `src/lib/apexapp.ts` in your frontend project to interact with ApexApp or ApexClient:

```typescript
// src/lib/apexapp.ts

export interface PrinterState {
  connected: boolean;
  id: string | null;
  name: string | null;
}

export interface ScaleResult {
  success: boolean;
  raw: string;
  weight?: number;
  unit?: string;
  stable: boolean;
}

export interface BatteryInfo {
  has_battery: boolean;
  percentage: number;
  is_charging: boolean;
}

export interface NetworkInfo {
  is_online: boolean;
  local_ip: string;
  gateway_ping_ms?: number;
}

export interface ScanResult {
  value: string;
  source: 'Camera' | 'USB Scanner' | 'Unknown';
}

export class ApexAppBridge {
  /**
   * Returns true if the web app is running inside ApexApp desktop or ApexClient mobile
   */
  static isInsideApexApp(): boolean {
    return typeof window !== 'undefined' && window.parent !== window;
  }

  // ── 1. HARDWARE PRINTING & CASH DRAWER ─────────────────────────────────────

  /** Get active printer selected in Settings */
  static getActivePrinter(): Promise<PrinterState> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) return resolve({ connected: false, id: null, name: null });

      const handler = (e: MessageEvent) => {
        if (e.data?.type === '__apexapp_printer_state') {
          window.removeEventListener('message', handler);
          resolve({
            connected: !!e.data.printerId,
            id: e.data.printerId || null,
            name: e.data.printerName || null,
          });
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_get_printer' }, '*');
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ connected: false, id: null, name: null });
      }, 1500);
    });
  }

  /** Print HTML string directly to hardware or silent virtual receipts */
  static printHtml(html: string, copies = 1): Promise<{ success: boolean; savedPath?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(html);
          w.document.close();
          w.focus();
          w.print();
        }
        return resolve({ success: true });
      }

      const handler = (e: MessageEvent) => {
        if (e.data?.type === '__apexapp_print_response') {
          window.removeEventListener('message', handler);
          if (e.data.success) resolve({ success: true, savedPath: e.data.savedPath });
          else reject(new Error(e.data.error || 'Print request rejected'));
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_print_request', payload: { html, copies } }, '*');
    });
  }

  /** Send kick pulse to RJ11/RJ12 cash drawer solenoid */
  static openCashDrawer(pin: 2 | 5 = 2): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) return reject(new Error('Desktop shell required'));

      const handler = (e: MessageEvent) => {
        if (e.data?.type === '__apexapp_cash_drawer_response') {
          window.removeEventListener('message', handler);
          e.data.success ? resolve(true) : reject(new Error(e.data.error || 'Cash drawer kick failed'));
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_open_cash_drawer', payload: { pin: pin === 2 ? 0 : 1 } }, '*');
    });
  }

  /** Read weight from an RS-232 / USB COM serial digital scale */
  static readScale(port = 'COM1', baudRate = 9600): Promise<ScaleResult> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) {
        return resolve({ success: false, raw: 'Scale bridge requires desktop host', stable: false });
      }

      const handler = (e: MessageEvent) => {
        if (e.data?.type === '__apexapp_scale_reading') {
          window.removeEventListener('message', handler);
          resolve(e.data.reading);
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_read_scale', payload: { port, baudRate } }, '*');
    });
  }

  /** Write text to customer-facing 2-line VFD pole display */
  static setPoleDisplay(line1: string, line2: string, port = 'COM2'): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_pole_display', payload: { line1, line2, port } }, '*');
  }

  // ── 2. MULTI-FORMAT FILE EXPORT ───────────────────────────────────────────

  /**
   * Save any file format (.pdf, .xlsx, .csv, .docx, .png, .txt, .json) to disk
   * with optional automatic OS launch.
   */
  static exportFile(options: {
    fileName: string;
    base64Data: string;
    autoOpen?: boolean;
    customDir?: string;
  }): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) return reject(new Error('Export requires host desktop'));

      const handler = (e: MessageEvent) => {
        if (e.data?.type === '__apexapp_export_response') {
          window.removeEventListener('message', handler);
          e.data.success ? resolve(e.data.filePath) : reject(new Error(e.data.error || 'Export failed'));
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_export_file', payload: options }, '*');
    });
  }

  // ── 3. SCANNER INTERFACES ────────────────────────────────────────────────

  /** Request optical camera scan modal */
  static requestCameraScan(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) return reject(new Error('Camera scanning requires host shell'));

      const handler = (e: MessageEvent) => {
        if (e.data?.type === '__apexapp_scan_result') {
          window.removeEventListener('message', handler);
          resolve(e.data.value);
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_camera_scan_request' }, '*');
    });
  }

  /** Arm listener for handheld USB barcode scanner wedge */
  static requestUsbScan(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) return reject(new Error('USB scan requires host shell'));

      const handler = (e: MessageEvent) => {
        if (e.data?.type === '__apexapp_scan_result') {
          window.removeEventListener('message', handler);
          resolve(e.data.value);
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_usb_scan_request' }, '*');
    });
  }

  /** Listen continuously for any barcode scan event (Camera or USB) */
  static onScan(callback: (value: string, details: ScanResult) => void): () => void {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === '__apexapp_scan_result' && e.data.value) {
        callback(e.data.value, {
          value: e.data.value,
          source: e.data.source || 'Unknown',
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }

  // ── 4. SECURITY, KIOSK & SCREEN CONTROLS ──────────────────────────────────

  /** Trigger biometric or OS supervisor credential verification */
  static authenticateSupervisor(reason = 'Authorize Supervisor Override'): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) return resolve(true);

      const handler = (e: MessageEvent) => {
        if (e.data?.type === '__apexapp_biometrics_result') {
          window.removeEventListener('message', handler);
          resolve(e.data.authenticated);
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_authenticate_biometrics', payload: { reason } }, '*');
    });
  }

  /** Lock or unlock fullscreen kiosk mode */
  static setKiosk(enabled: boolean): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_set_kiosk', payload: { enabled } }, '*');
  }

  /** Prevent screen sleep or dimming */
  static setWakeLock(enabled: boolean): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_set_wakelock', payload: { enabled } }, '*');
  }

  // ── 5. HARDWARE AUDIO & SENSORY ──────────────────────────────────────────

  /** Emit an immediate hardware tone (zero audio-gesture delay) */
  static beep(frequency = 1200, durationMs = 150): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_beep', payload: { frequency, durationMs } }, '*');
  }

  /** Trigger tactile haptic vibration on mobile */
  static haptic(style: 'light' | 'medium' | 'heavy' | 'success' | 'error' = 'light'): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_haptic', payload: { style } }, '*');
  }

  // ── 6. TELEMETRY & CLIPBOARD ──────────────────────────────────────────────

  /** Read battery percentage and charging status */
  static getBattery(): Promise<BatteryInfo> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) return resolve({ has_battery: false, percentage: 100, is_charging: true });

      const handler = (e: MessageEvent) => {
        if (e.data?.type === '__apexapp_battery_status') {
          window.removeEventListener('message', handler);
          resolve(e.data.status);
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_get_battery' }, '*');
    });
  }

  /** Query local IP and gateway ping telemetry */
  static getNetwork(): Promise<NetworkInfo> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) return resolve({ is_online: navigator.onLine, local_ip: '127.0.0.1' });

      const handler = (e: MessageEvent) => {
        if (e.data?.type === '__apexapp_network_status') {
          window.removeEventListener('message', handler);
          resolve(e.data.network);
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_get_network' }, '*');
    });
  }

  /** Write text to system clipboard (bypassing iframe sandbox restrictions) */
  static copyToClipboard(text: string): void {
    if (!this.isInsideApexApp()) {
      navigator.clipboard?.writeText(text);
      return;
    }
    window.parent.postMessage({ type: '__apexapp_clipboard_write', payload: { text } }, '*');
  }

  /** Show native OS toast notification */
  static notify(title: string, body = ''): void {
    if (!this.isInsideApexApp()) {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
      return;
    }
    window.parent.postMessage({ type: '__apexapp_notify', payload: { title, body } }, '*');
  }
}
```

---

## 4. Bridge Message Protocol Reference

The following table lists every message type available across the `window.postMessage` bridge:

| Direction | Message Type | Payload Structure | Description |
| :--- | :--- | :--- | :--- |
| **Iframe ➔ Host** | `__apexapp_get_printer` | *None* | Queries the default printer configured in Settings. |
| **Host ➔ Iframe** | `__apexapp_printer_state` | `{ printerId, printerName }` | Responds with the active printer ID and name. |
| **Iframe ➔ Host** | `__apexapp_print_request` | `{ html: string, copies?: number }` | Spools raw ESC/POS or HTML to the printer. |
| **Host ➔ Iframe** | `__apexapp_print_response` | `{ success: boolean, savedPath?: string }` | Confirms print job completion or virtual file path. |
| **Iframe ➔ Host** | `__apexapp_open_cash_drawer` | `{ pin?: 0 \| 1 }` | Pulses the RJ11/RJ12 cash drawer kick pin (0 = Pin 2, 1 = Pin 5). |
| **Host ➔ Iframe** | `__apexapp_cash_drawer_response` | `{ success: boolean, error?: string }` | Returns whether the solenoid pulse was sent. |
| **Iframe ➔ Host** | `__apexapp_export_file` | `{ fileName, base64Data, autoOpen?, customDir? }` | Decodes Base64 data and writes any file format to disk. |
| **Host ➔ Iframe** | `__apexapp_export_response` | `{ success: boolean, filePath?: string }` | Returns the absolute path where the file was saved. |
| **Iframe ➔ Host** | `__apexapp_camera_scan_request` | *None* | Opens the optical camera scanning viewfinder modal. |
| **Iframe ➔ Host** | `__apexapp_usb_scan_request` | *None* | Arms keyboard buffer interceptor for handheld USB scanners. |
| **Host ➔ Iframe** | `__apexapp_scan_result` | `{ value: string, source: string }` | Emitted when a barcode or QR code is detected. |
| **Iframe ➔ Host** | `__apexapp_read_scale` | `{ port?: string, baudRate?: number }` | Polls weight data from RS-232 / USB digital scale. |
| **Host ➔ Iframe** | `__apexapp_scale_reading` | `{ reading: ScaleResult }` | Returns parsed weight, units, and scale stability. |
| **Iframe ➔ Host** | `__apexapp_pole_display` | `{ line1: string, line2: string, port?: string }` | Clears and updates customer-facing VFD screen text. |
| **Iframe ➔ Host** | `__apexapp_authenticate_biometrics`| `{ reason: string }` | Displays biometric or OS supervisor credential prompt. |
| **Host ➔ Iframe** | `__apexapp_biometrics_result` | `{ authenticated: boolean }` | Indicates whether credentials or biometric verification passed. |
| **Iframe ➔ Host** | `__apexapp_set_kiosk` | `{ enabled: boolean }` | Toggles pinned, unresizable, borderless kiosk mode. |
| **Iframe ➔ Host** | `__apexapp_set_wakelock` | `{ enabled: boolean }` | Prevents operating system display from sleeping. |
| **Iframe ➔ Host** | `__apexapp_beep` | `{ frequency?: number, durationMs?: number }` | Plays an OS hardware speaker tone. |
| **Iframe ➔ Host** | `__apexapp_haptic` | `{ style: string }` | Triggers mobile tactile vibration feedback. |
| **Iframe ➔ Host** | `__apexapp_get_battery` | *None* | Queries terminal battery percentage and charging state. |
| **Host ➔ Iframe** | `__apexapp_battery_status` | `{ status: BatteryInfo }` | Returns current power and battery metrics. |
| **Iframe ➔ Host** | `__apexapp_get_network` | *None* | Checks connection status and measures gateway ping latency. |
| **Host ➔ Iframe** | `__apexapp_network_status` | `{ network: NetworkInfo }` | Returns local IP and ping response time. |
| **Iframe ➔ Host** | `__apexapp_clipboard_write` | `{ text: string }` | Writes text to the host system clipboard. |
| **Iframe ➔ Host** | `__apexapp_clipboard_read` | *None* | Reads text from host clipboard. |
| **Host ➔ Iframe** | `__apexapp_clipboard_data` | `{ text: string }` | Responds with current clipboard string. |
| **Iframe ➔ Host** | `__apexapp_notify` | `{ title: string, body: string }` | Displays a native OS desktop or mobile push notification. |

---

## 5. Desktop Rust Architecture (`apexapp`)

The Rust backend is modularized to separate system utilities, hardware commands, and sidecar management:

```
apexapp/src-tauri/src/
├── lib.rs              # App builder, state injection, plugin registration
├── main.rs             # Process entrypoint & Windows 7 Fixed WebView2 loader
├── state.rs            # Mutex-wrapped CommandChild sidecar process handles
├── models.rs           # Serde structs (Telemetry, Printers, Export payloads)
├── utils.rs            # Fast Base64 decoder, directory paths, file helpers
└── commands/
    ├── mod.rs          # Command re-exports
    ├── system.rs       # Kiosk control, Biometrics, Battery, Network, Dynamic Icon
    ├── peripherals.rs  # Serial Scale reader, Customer Pole VFD, Hardware Beeper
    ├── printer.rs      # Hardware print jobs, ESC/POS Cash Drawer kick pulses
    ├── fs_export.rs    # Silent Multi-format file exporter & Directory selection
    ├── sidecar.rs      # ApexKit server, Cloudflared, & FRP WSS tunnels
    └── env.rs          # .env file variable parser and serializer
```

### Customizing the App Icon Without Recompiling

1. **At Runtime (Window Titlebar & Taskbar/Dock):**
   ApexApp includes a `set_dynamic_icon` command. You can update the live window icon at runtime by placing an image file next to the binary or downloading a tenant logo, then calling:
   ```rust
   tauri::image::Image::from_bytes(&bytes);
   window.set_icon(image);
   ```

2. **At the Executable Level (Desktop File Explorer):**
   * **Windows (`.exe`):** Update the embedded icon resource using `rcedit`:
     ```bash
     rcedit.exe "apexapp.exe" --set-icon "branding.ico"
     ```
   * **macOS (`.app`):** Replace the icon file in the app bundle and update Finder's cache:
     ```bash
     cp branding.icns "apexapp.app/Contents/Resources/icon.icns"
     touch "apexapp.app"
     ```
   * **Linux (`.desktop`):** Change the `Icon=` path in `/usr/share/applications/apexapp.desktop` or `~/.local/share/applications/`.

---

## 6. Mobile Client Architecture (`apexclient`)

ApexClient uses a mobile-first interface optimized for touch interactions, safe-area hardware notches, and adaptive light/dark theming:

```
apexclient/
├── src/
│   ├── main.ts         # Navigation hub, haptics, theme sync, workspace management
│   ├── bridge.ts       # Iframe postMessage bridge
│   ├── scanner.ts      # Optical camera reader (ZXing)
│   ├── storage.ts      # Saved workspaces (LocalStorage persistence)
│   ├── styles.css      # System theme CSS tokens, bottom sheets, safe area insets
│   └── views/viewer.ts # Auto-routing (Wi-Fi ping check with Tunnel fallback)
```

### Key Mobile UI Behaviors
1. **Adaptive System Theming:** Uses `prefers-color-scheme: dark` and `prefers-color-scheme: light` tokens without hardcoded colors. Status bar meta tags synchronize dynamically on theme changes.
2. **Safe-Area Insets:** Layouts use `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` to accommodate camera cutouts, dynamic islands, and home indicator gestures.
3. **Workspace Resolution:** Automatically pings local Wi-Fi addresses (`http://192.168.x.x:5000/app-name`) with a 1500ms timeout. If available, it connects over the local network with zero latency; otherwise, it falls back to the public tunnel.

---

## 7. Managed Tunnel Server (`apexapp/server`)

ApexApp includes a built-in reverse proxy server written in Go, powered by FRP (Fast Reverse Proxy). It multiplexes administrative traffic, WebSocket connections, and forwarded HTTP requests over a single port (`443` or PaaS-assigned `$PORT`).

### Deployment Modes

#### Option A: VPS Agency Mode (Wildcard Subdomains & Auto-TLS)
Binds to ports `80` and `443` to issue Let's Encrypt SSL certificates automatically for `*.yourdomain.com`:

```bash
docker run -d \
  --name apex-tunnel \
  --network host \
  --restart always \
  -v $(pwd)/certs:/app/certs \
  -v $(pwd)/tunnels.db:/app/tunnels.db \
  -e ADMIN_KEY="your_admin_secret_key" \
  apex-tunnel-server \
  ./apex-tunnel-server -domain yourdomain.com
```

#### Option B: PaaS Mode (Render / Koyeb / Railway)
Used for single-domain deployments behind cloud load balancers. SSL terminates at the platform edge:

* Set environment variables in the dashboard:
  * `PAAS_MODE` = `true`
  * `ADMIN_KEY` = `your_admin_secret_key`

### Generating Tunnel Tokens via API

To grant a user access to a subdomain or domain, send a request to the admin API:

```bash
curl -X POST https://yourdomain.com:9000/api/tokens \
     -H "Authorization: Bearer your_admin_secret_key" \
     -H "Content-Type: application/json" \
     -d '{"domain": "store-register-1"}'
```

**Response:**
```json
{
  "token": "e4a2b6c8d0f1e3a5c7b9d2f4",
  "domain": "store-register-1"
}
```

The user enters these credentials under **Settings -> Managed Public Tunnel** in the desktop application.

---

## 8. Build & Cross-Compilation Pipelines

The repository provides automated shell scripts to cross-compile ApexApp and ApexClient across supported platforms:

### 1. Modern Windows (Windows 10 / 11)
```bash
bash setup_and_build_win10_11.sh
```
* Compiles for `x86_64-pc-windows-msvc` using `cargo-xwin` and the Windows SDK.
* Generates an NSIS offline installer in `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

### 2. Legacy Windows (Windows 7 / 8 / 8.1 Offline Mode)
```bash
npm run build:win7
# Or: bash setup_and_build_win7.sh
```
* Downloads the fixed WebView2 runtime (`v109.0.1518.78`, the final release supporting Windows 7).
* Extracts cabinet archives and bundles the standalone runtime directly into the installer.

### 3. Linux (x86_64 & aarch64 ARM64)
```bash
# Standard 64-bit Intel/AMD:
bash setup_and_build_apexapp-x86_64-unknown-linux-musl.sh

# 64-bit ARM (Raspberry Pi, AWS Graviton):
bash setup_and_build_apexapp-aarch64-unknown-linux-musl.sh
```
* Builds `.deb` and `.rpm` distribution packages using static MUSL sidecar binaries.

### 4. macOS (Intel & Apple Silicon)
```bash
# Intel (x86_64):
bash setup_and_build_apexapp-x86_64-apple-darwin.sh

# Apple Silicon (M1/M2/M3/M4):
bash setup_and_build_apexapp-aarch64-apple-darwin.sh
```
* Removes quarantine flags and outputs signed `.dmg` bundles.

### 5. Mobile (Android APKs)
Run inside the `apexclient/` directory:
```bash
bash build_android.sh
```
* Configures the Android NDK and creates a release keystore.
* Builds split architecture APKs (`arm64-v8a`, `armeabi-v7a`, `x86_64`) and an aligned universal APK in `apexclient/dist-apk/`.