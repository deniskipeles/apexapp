import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import QRCode from 'qrcode';

// ── NAV ───────────────────────────────────────────────────────────────────────
const navApp = document.querySelector("#nav-app") as HTMLButtonElement;
const navDash = document.querySelector("#nav-dash") as HTMLButtonElement;
const navSettings = document.querySelector("#nav-settings") as HTMLButtonElement;
const btnRefresh = document.querySelector("#btn-refresh") as HTMLButtonElement;

const viewApp = document.querySelector("#view-app") as HTMLElement;
const viewDash = document.querySelector("#view-dash") as HTMLElement;
const viewSettings = document.querySelector("#view-settings") as HTMLElement;

const serverBtn = document.querySelector("#server-btn") as HTMLButtonElement;
const statusText = document.querySelector("#status-text") as HTMLElement;
const statusDot = document.querySelector("#status-dot") as HTMLElement;
const windowModeToggle = document.querySelector("#window-mode-toggle") as HTMLInputElement;

const frameApp = document.querySelector("#frame-app") as HTMLIFrameElement;
const loaderApp = document.querySelector("#loader-app") as HTMLElement;
const frameDash = document.querySelector("#frame-dash") as HTMLIFrameElement;
const loaderDash = document.querySelector("#loader-dash") as HTMLElement;

// ── TUNNEL ────────────────────────────────────────────────────────────────────
const btnToggleTunnel = document.querySelector("#btn-toggle-tunnel") as HTMLButtonElement;
const tunnelStatusText = document.querySelector("#tunnel-status-text") as HTMLElement;
const tunnelDot = document.querySelector("#tunnel-dot") as HTMLElement;
const tunnelUrlBox = document.querySelector("#tunnel-url-box") as HTMLElement;
const tunnelUrlText = document.querySelector("#tunnel-url-text") as HTMLElement;
const tunnelWarningText = document.querySelector("#tunnel-warning-text") as HTMLElement;
const btnCopyUrl = document.querySelector("#btn-copy-url") as HTMLButtonElement;
const cfTokenInput = document.querySelector("#cf-token-input") as HTMLInputElement;

const btnToggleApexTunnel = document.querySelector("#btn-toggle-apex-tunnel") as HTMLButtonElement;
const apexTunnelStatusText = document.querySelector("#apex-tunnel-status-text") as HTMLElement;
const apexTunnelDot = document.querySelector("#apex-tunnel-dot") as HTMLElement;
const apexTunnelUrlBox = document.querySelector("#apex-tunnel-url-box") as HTMLElement;
const apexTunnelUrlText = document.querySelector("#apex-tunnel-url-text") as HTMLElement;
const btnCopyApexUrl = document.querySelector("#btn-copy-apex-url") as HTMLButtonElement;
const apexDomainInput = document.querySelector("#apex-domain-input") as HTMLInputElement;
const apexTokenInput = document.querySelector("#apex-token-input") as HTMLInputElement;
const apexServerInput = document.querySelector("#apex-server-input") as HTMLInputElement;

// ── ENV ───────────────────────────────────────────────────────────────────────
const envListEl = document.querySelector("#env-list") as HTMLElement;
const envKeyInput = document.querySelector("#env-key-input") as HTMLInputElement;
const envValInput = document.querySelector("#env-val-input") as HTMLInputElement;
const btnAddEnv = document.querySelector("#btn-add-env") as HTMLButtonElement;
const btnSaveEnv = document.querySelector("#btn-save-env") as HTMLButtonElement;

// ── MISC ──────────────────────────────────────────────────────────────────────
const appNameEl = document.querySelector("#app-name") as HTMLElement;
const appLogoEl = document.querySelector("#app-logo") as HTMLImageElement;
const greetInputEl = document.querySelector("#greet-input") as HTMLInputElement;
const greetMsgEl = document.querySelector("#greet-msg") as HTMLElement;
const consoleArea = document.querySelector("#console-area") as HTMLElement;
const btnClearConsole = document.querySelector("#btn-clear-console") as HTMLButtonElement;

// ── QR ────────────────────────────────────────────────────────────────────────
const btnQrUrl = document.querySelector("#btn-qr-url") as HTMLButtonElement;
const qrModal = document.querySelector("#qr-modal") as HTMLElement;
const qrContainer = document.querySelector("#qr-code-container") as HTMLElement;
const qrUrlDisplay = document.querySelector("#qr-url-display") as HTMLElement;
const btnCloseQr = document.querySelector("#btn-close-qr") as HTMLButtonElement;

// ── PRINTER ───────────────────────────────────────────────────────────────────
const btnScanPrinters = document.querySelector("#btn-scan-printers") as HTMLButtonElement;
const printerList = document.querySelector("#printer-list") as HTMLElement;
const printerStatusText = document.querySelector("#printer-status-text") as HTMLElement;
const printerScanDot = document.querySelector("#printer-scan-dot") as HTMLElement;
const printerSearchInput = document.querySelector("#printer-search-input") as HTMLInputElement;
const printerConnectedBox = document.querySelector("#printer-connected-box") as HTMLElement;
const printerConnectedName = document.querySelector("#printer-connected-name") as HTMLElement;
const btnDisconnectPrinter = document.querySelector("#btn-disconnect-printer") as HTMLButtonElement;

// ── SCANNER ───────────────────────────────────────────────────────────────────
const scannerDot = document.querySelector("#scanner-dot") as HTMLElement;
const scannerStatusText = document.querySelector("#scanner-status-text") as HTMLElement;
const scannerResultBox = document.querySelector("#scanner-result-box") as HTMLElement;
const scannerResultText = document.querySelector("#scanner-result-text") as HTMLElement;
const btnStartScan = document.querySelector("#btn-start-scan") as HTMLButtonElement;
const btnCancelScan = document.querySelector("#btn-cancel-scan") as HTMLButtonElement;
const btnCopyScan = document.querySelector("#btn-copy-scan") as HTMLButtonElement;

// ── STATE ─────────────────────────────────────────────────────────────────────
let isServerRunning = false;
let isTunnelRunning = false;
let isCustomDomain = false;
let isApexTunnelRunning = false;
let isScannerRunning = false;
let selectedPrinterId: string | null = null;
let selectedPrinterName: string | null = null;
let allPrinters: any[] = [];

interface EnvVar { key: string; value: string; }
let envVars: EnvVar[] = [];

function getBaseUrl() {
  if (window.location.protocol === 'https:' ||
    (window.location.hostname !== 'localhost' &&
      window.location.hostname !== 'tauri.localhost' &&
      window.location.hostname !== '127.0.0.1')) {
    return window.location.origin;
  }
  return "http://localhost:5000";
}
const API_BASE = getBaseUrl();

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  switchView('app');
  loadEnvVars();
  const alreadyUp = await waitForServer(1);
  if (alreadyUp) {
    setServerRunningState();
    fetchBranding();
    reloadFrames();
  }
});

// ── VIEW SWITCHING ────────────────────────────────────────────────────────────
function switchView(viewName: 'app' | 'dash' | 'settings') {
  [navApp, navDash, navSettings].forEach(el => el.classList.remove('active'));
  [viewApp, viewDash, viewSettings].forEach(el => el.classList.remove('active'));

  if (viewName === 'app') {
    navApp.classList.add('active'); viewApp.classList.add('active');
    handleContentDisplay('app');
  } else if (viewName === 'dash') {
    navDash.classList.add('active'); viewDash.classList.add('active');
    handleContentDisplay('dash');
  } else {
    navSettings.classList.add('active'); viewSettings.classList.add('active');
    loadPrinters();
  }
  if ((viewName === 'app' || viewName === 'dash') && !isServerRunning) startServer();
}

navApp.addEventListener('click', () => switchView('app'));
navDash.addEventListener('click', () => switchView('dash'));
navSettings.addEventListener('click', () => switchView('settings'));

// ── SERVER ────────────────────────────────────────────────────────────────────
async function startServer() {
  if (isServerRunning) return;
  serverBtn.disabled = true;
  serverBtn.textContent = "Starting...";
  statusText.textContent = "Initializing...";
  if (navApp.classList.contains('active')) loaderApp.style.display = "flex";
  if (navDash.classList.contains('active')) loaderDash.style.display = "flex";
  try {
    await invoke("run_apex_sidecar");
    const success = await waitForServer();
    if (success) { setServerRunningState(); fetchBranding(); reloadFrames(); }
    else throw new Error("Timed out");
  } catch (error) {
    statusText.textContent = "Error";
    serverBtn.textContent = "Retry Start";
    serverBtn.disabled = false;
    alert("Failed to start ApexKit server.");
  }
}

function setServerRunningState() {
  isServerRunning = true;
  statusText.textContent = "Running";
  statusDot.classList.add("running");
  serverBtn.textContent = "Running";
  serverBtn.disabled = true;
}

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`${API_BASE}/`, { method: 'HEAD' });
      if (response.ok || response.status === 401 || response.status === 403) return true;
    } catch (e) { }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

// ── IFRAMES ───────────────────────────────────────────────────────────────────
function handleContentDisplay(viewName: 'app' | 'dash') {
  if (!isServerRunning) return;
  const useNewWindow = windowModeToggle.checked;
  if (viewName === 'app') {
    if (useNewWindow) {
      invoke("open_separate_window", { label: "apex-app-window", title: "Apex App", url: API_BASE + "/" });
      frameApp.style.display = 'none';
      loaderApp.style.display = 'flex';
      loaderApp.innerHTML = `<h3>External Window Active</h3>`;
    } else {
      loaderApp.style.display = 'none';
      frameApp.style.display = 'block';
      if (frameApp.src === "about:blank") frameApp.src = API_BASE + "/";
    }
  } else {
    if (useNewWindow) {
      invoke("open_separate_window", { label: "apex-dash-window", title: "Apex Dashboard", url: API_BASE + "/_dashboard" });
      frameDash.style.display = 'none';
      loaderDash.style.display = 'flex';
      loaderDash.innerHTML = `<h3>External Window Active</h3>`;
    } else {
      loaderDash.style.display = 'none';
      frameDash.style.display = 'block';
      if (frameDash.src === "about:blank") frameDash.src = API_BASE + "/_dashboard";
    }
  }
}

function reloadFrames() {
  if (navApp.classList.contains('active')) handleContentDisplay('app');
  if (navDash.classList.contains('active')) handleContentDisplay('dash');
}

btnRefresh.addEventListener('click', () => {
  if (!isServerRunning) return;
  if (navApp.classList.contains('active')) frameApp.src = frameApp.src;
  if (navDash.classList.contains('active')) frameDash.src = frameDash.src;
});

// ── CLOUDFLARE TUNNEL ─────────────────────────────────────────────────────────
btnToggleTunnel.addEventListener('click', async () => {
  if (!isTunnelRunning) {
    const tokenValue = cfTokenInput.value.trim();
    isCustomDomain = tokenValue !== "";
    btnToggleTunnel.disabled = true;
    btnToggleTunnel.textContent = "Starting Tunnel...";
    tunnelStatusText.textContent = "Initializing...";
    await invoke("toggle_cf_tunnel", { start: true, token: tokenValue });
  } else {
    isTunnelRunning = false;
    isCustomDomain = false;
    await invoke("toggle_cf_tunnel", { start: false, token: null });
    updateTunnelUI(false);
  }
});

listen("tunnel-url", (event) => {
  if (!isCustomDomain) {
    isTunnelRunning = true;
    tunnelUrlText.textContent = event.payload as string;
    updateTunnelUI(true);
  }
});

listen("tunnel-managed-connected", async () => {
  if (isCustomDomain) {
    isTunnelRunning = true;
    tunnelUrlText.textContent = "Custom Domain Active";
    updateTunnelUI(true);
    const token = cfTokenInput.value.trim();
    if (token) {
      const idx = envVars.findIndex(e => e.key === "CF_TUNNEL_TOKEN");
      if (idx !== -1) envVars[idx].value = token;
      else envVars.push({ key: "CF_TUNNEL_TOKEN", value: token });
      await invoke("save_env_vars", { vars: envVars.filter(e => e.key.trim() !== "") });
      renderEnvVars();
    }
  }
});

function updateTunnelUI(running: boolean) {
  btnToggleTunnel.disabled = false;
  if (running) {
    tunnelStatusText.textContent = "Tunnel Online";
    tunnelStatusText.style.color = "#10b981";
    tunnelDot.classList.add("running");
    btnToggleTunnel.textContent = "Stop Tunnel";
    btnToggleTunnel.style.backgroundColor = "#ef4444";
    tunnelUrlBox.style.display = "block";
    cfTokenInput.disabled = true;
    if (isCustomDomain) {
      btnCopyUrl.style.display = "none";
      btnQrUrl.style.display = "none";
      tunnelWarningText.textContent = "Routed through Cloudflare Zero Trust.";
    } else {
      btnCopyUrl.style.display = "block";
      btnQrUrl.style.display = "flex";
      tunnelWarningText.textContent = "Warning: Anyone with this link can access your app.";
    }
  } else {
    tunnelStatusText.textContent = "Tunnel Offline";
    tunnelStatusText.style.color = "#64748b";
    tunnelDot.classList.remove("running");
    btnToggleTunnel.textContent = "Start Public Tunnel";
    btnToggleTunnel.style.backgroundColor = "#f97316";
    tunnelUrlBox.style.display = "none";
    tunnelUrlText.textContent = "Waiting for connection...";
    cfTokenInput.disabled = false;
  }
}

btnCopyUrl.addEventListener('click', () => {
  navigator.clipboard.writeText(tunnelUrlText.textContent || "");
  const orig = btnCopyUrl.textContent;
  btnCopyUrl.textContent = "Copied!";
  setTimeout(() => btnCopyUrl.textContent = orig, 2000);
});

// ── APEX TUNNEL ───────────────────────────────────────────────────────────────
btnToggleApexTunnel.addEventListener('click', async () => {
  if (!isApexTunnelRunning) {
    const domain = apexDomainInput.value.trim();
    const token = apexTokenInput.value.trim();
    const serverAddrValue = apexServerInput.value.trim() || "apexkit.io";
    if (!domain || !token) { alert("Please enter both Token and Domain."); return; }
    btnToggleApexTunnel.disabled = true;
    btnToggleApexTunnel.textContent = "Starting Tunnel...";
    apexTunnelStatusText.textContent = "Authenticating via WSS...";
    btnToggleTunnel.disabled = true;
    try {
      await invoke("toggle_apex_tunnel", { start: true, domain, token, serverAddr: serverAddrValue });
    } catch (err) {
      alert(err);
      updateApexTunnelUI(false);
    }
  } else {
    isApexTunnelRunning = false;
    await invoke("toggle_apex_tunnel", { start: false, domain: null, token: null, serverAddr: null });
    updateApexTunnelUI(false);
    btnToggleTunnel.disabled = false;
  }
});

listen("apex-tunnel-connected", async (event) => {
  const url = event.payload as string;
  isApexTunnelRunning = true;
  apexTunnelUrlText.textContent = url;
  updateApexTunnelUI(true);
  const serverAddr = apexServerInput.value.trim();
  const domain = apexDomainInput.value.trim();
  const token = apexTokenInput.value.trim();
  const uoa = (k: string, v: string) => {
    const idx = envVars.findIndex(e => e.key === k);
    if (idx !== -1) envVars[idx].value = v; else envVars.push({ key: k, value: v });
  };
  uoa("APEX_TUNNEL_SERVER", serverAddr);
  uoa("APEX_TUNNEL_DOMAIN", domain);
  uoa("APEX_TUNNEL_TOKEN", token);
  await invoke("save_env_vars", { vars: envVars.filter(e => e.key.trim() !== "") });
  renderEnvVars();
});

listen("apex-tunnel-error", (event) => {
  alert("Tunnel Error: " + event.payload);
  isApexTunnelRunning = false;
  invoke("toggle_apex_tunnel", { start: false, domain: null, token: null, serverAddr: null });
  updateApexTunnelUI(false);
  btnToggleTunnel.disabled = false;
});

function updateApexTunnelUI(running: boolean) {
  btnToggleApexTunnel.disabled = false;
  if (running) {
    apexTunnelStatusText.textContent = "Tunnel Online";
    apexTunnelStatusText.style.color = "#10b981";
    apexTunnelDot.classList.add("running");
    btnToggleApexTunnel.textContent = "Stop Tunnel";
    btnToggleApexTunnel.style.backgroundColor = "#ef4444";
    apexTunnelUrlBox.style.display = "block";
    apexDomainInput.disabled = true;
    apexTokenInput.disabled = true;
    apexServerInput.disabled = true;
  } else {
    apexTunnelStatusText.textContent = "Tunnel Offline";
    apexTunnelStatusText.style.color = "#64748b";
    apexTunnelDot.classList.remove("running");
    btnToggleApexTunnel.textContent = "Start Managed Tunnel";
    btnToggleApexTunnel.style.backgroundColor = "#3b82f6";
    apexTunnelUrlBox.style.display = "none";
    apexTunnelUrlText.textContent = "Waiting for connection...";
    apexDomainInput.disabled = false;
    apexTokenInput.disabled = false;
    apexServerInput.disabled = false;
  }
}

btnCopyApexUrl.addEventListener('click', () => {
  navigator.clipboard.writeText(apexTunnelUrlText.textContent || "");
  const orig = btnCopyApexUrl.textContent;
  btnCopyApexUrl.textContent = "Copied!";
  setTimeout(() => btnCopyApexUrl.textContent = orig, 2000);
});

// ── PRINTER ───────────────────────────────────────────────────────────────────
function broadcastToFrames(msg: object) {
  [frameApp, frameDash].forEach(f => f?.contentWindow?.postMessage(msg, "*"));
}

async function loadPrinters() {
  printerScanDot.classList.add("running");
  printerStatusText.textContent = "Scanning...";
  printerList.innerHTML = `<div style="color:#64748b;font-style:italic;font-size:0.85rem;">Scanning...</div>`;
  try {
    const result = await (window as any).__apexapp_tools__.search_printers();
    allPrinters = (typeof result === 'string' ? JSON.parse(result) : result).map((p: any) => ({
      id: p.Name || p.id,
      name: p.Name || p.printerName || p.name || 'Unknown',
      isOnline: p.PrinterStatus === 0,
      isDefault: p.Priority === 1,
      _raw: p,
    }));
    renderPrinterList(allPrinters);
    printerStatusText.textContent = `${allPrinters.length} printer(s) found`;
    printerSearchInput.style.display = allPrinters.length > 0 ? "block" : "none";
  } catch (err) {
    printerList.innerHTML = `<div style="color:#ef4444;font-size:0.85rem;">Failed: ${err}</div>`;
    printerStatusText.textContent = "Error";
  }
  printerScanDot.classList.remove("running");
}

function renderPrinterList(printers: any[]) {
  if (!printers.length) {
    printerList.innerHTML = `<div style="color:#64748b;font-style:italic;font-size:0.85rem;">No printers found.</div>`;
    return;
  }
  printerList.innerHTML = "";
  printers.forEach(printer => {
    const isConnected = selectedPrinterId === printer.id;
    const row = document.createElement("div");
    row.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid ${isConnected ? '#3b82f6' : '#e2e8f0'};border-radius:8px;background:${isConnected ? '#eff6ff' : 'white'};transition:all 0.15s;`;
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.3rem;">🖨️</span>
        <div>
          <div style="font-weight:600;font-size:0.88rem;color:#1e293b;">
            ${printer.name}
            ${printer.isDefault ? '<span style="font-size:0.7rem;background:#dbeafe;color:#1d4ed8;padding:2px 6px;border-radius:4px;margin-left:6px;">Default</span>' : ''}
          </div>
          <div style="font-size:0.75rem;color:${printer.isOnline !== false ? '#10b981' : '#94a3b8'};">
            ${printer.isOnline !== false ? '● Online' : '○ Offline'}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn-connect copy-btn" data-id="${printer.id}" data-name="${printer.name}"
          style="background:${isConnected ? '#fee2e2' : '#dbeafe'};color:${isConnected ? '#ef4444' : '#1d4ed8'};font-weight:600;">
          ${isConnected ? 'Disconnect' : 'Connect'}
        </button>
        <button class="btn-delete-printer copy-btn" data-id="${printer.id}"
          style="background:#fee2e2;color:#ef4444;" title="Remove from list">✕</button>
      </div>
    `;

    row.querySelector(".btn-connect")?.addEventListener("click", (e) => {
      const btn = e.target as HTMLButtonElement;
      if (selectedPrinterId === btn.dataset.id) {
        disconnectPrinter();
      } else {
        connectPrinter(btn.dataset.id!, btn.dataset.name!);
      }
    });

    row.querySelector(".btn-delete-printer")?.addEventListener("click", (e) => {
      const btn = e.target as HTMLButtonElement;
      const id = btn.dataset.id!;
      if (selectedPrinterId === id) disconnectPrinter();
      allPrinters = allPrinters.filter(p => p.id !== id);
      renderPrinterList(filterPrinters());
      printerStatusText.textContent = `${allPrinters.length} printer(s) found`;
    });

    printerList.appendChild(row);
  });
}

function filterPrinters() {
  const q = printerSearchInput.value.toLowerCase();
  return q ? allPrinters.filter(p => p.name.toLowerCase().includes(q)) : allPrinters;
}

printerSearchInput.addEventListener("input", () => renderPrinterList(filterPrinters()));

function connectPrinter(id: string, name: string) {
  selectedPrinterId = id;
  selectedPrinterName = name;
  printerConnectedName.textContent = name;
  printerConnectedBox.style.display = "flex";
  broadcastToFrames({ type: "__apexapp_printer_connected", printerId: id, printerName: name });
  renderPrinterList(filterPrinters());
}

function disconnectPrinter() {
  selectedPrinterId = null;
  selectedPrinterName = null;
  printerConnectedBox.style.display = "none";
  broadcastToFrames({ type: "__apexapp_printer_disconnected" });
  renderPrinterList(filterPrinters());
}

btnScanPrinters.addEventListener("click", loadPrinters);
btnDisconnectPrinter.addEventListener("click", disconnectPrinter);

// ── SCANNER ───────────────────────────────────────────────────────────────────
// Replace the entire startScan function with this:
function startScan() {
  if (isScannerRunning) return;
  isScannerRunning = true;
  scannerStatusText.textContent = "Waiting for scan... (point USB scanner at barcode)";
  scannerDot.classList.add("running");
  btnStartScan.style.display = "none";
  btnCancelScan.style.display = "block";

  // Create hidden input to capture USB scanner keystrokes
  let hiddenInput = document.getElementById('usb-scanner-input') as HTMLInputElement;
  if (!hiddenInput) {
    hiddenInput = document.createElement('input');
    hiddenInput.id = 'usb-scanner-input';
    hiddenInput.style.cssText = "position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;";
    document.body.appendChild(hiddenInput);
  }
  hiddenInput.value = '';
  hiddenInput.focus();

  let scanBuffer = '';
  let scanTimer: ReturnType<typeof setTimeout>;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (scanBuffer.length > 2) {
        cleanup();
        handleScanResult(scanBuffer);
      }
      scanBuffer = '';
      return;
    }
    scanBuffer += e.key;
    clearTimeout(scanTimer);
    // If no new key in 100ms, treat as complete scan
    scanTimer = setTimeout(() => {
      if (scanBuffer.length > 2) {
        cleanup();
        handleScanResult(scanBuffer);
      }
      scanBuffer = '';
    }, 100);
  };

  const cleanup = () => {
    hiddenInput.removeEventListener('keydown', onKey);
    (btnCancelScan as any)._stop = null;
    resetScannerUI();
  };

  hiddenInput.addEventListener('keydown', onKey);
  (btnCancelScan as any)._stop = () => {
    cleanup();
    scannerStatusText.textContent = "Cancelled";
    scannerDot.classList.remove("running");
  };
}

btnCancelScan.addEventListener("click", () => {
  if ((btnCancelScan as any)._stop) (btnCancelScan as any)._stop();
});

function handleScanResult(value: string) {
  scannerResultText.textContent = value;
  scannerResultBox.style.display = "block";
  scannerStatusText.textContent = "Scan complete";
  scannerDot.classList.remove("running");
  resetScannerUI();
  broadcastToFrames({ type: "__apexapp_scan_result", value });
}

function resetScannerUI() {
  isScannerRunning = false;
  btnStartScan.style.display = "block";
  btnCancelScan.style.display = "none";
}

btnStartScan.addEventListener("click", startScan);

btnCopyScan.addEventListener("click", () => {
  navigator.clipboard.writeText(scannerResultText.textContent || "");
  const orig = btnCopyScan.textContent;
  btnCopyScan.textContent = "Copied!";
  setTimeout(() => btnCopyScan.textContent = orig, 2000);
});

// ── POSTMESSAGE BRIDGE (iframe → native) ─────────────────────────────────────
window.addEventListener("message", async (event) => {
  const { type, payload } = event.data || {};

  if (type === "__apexapp_print_request") {
    if (!selectedPrinterId) {
      event.source?.postMessage({ type: "__apexapp_print_response", error: "No printer connected" }, { targetOrigin: "*" });
      return;
    }
    try {
      if (payload?.html) {
        await invoke("print_html", { printer_id: selectedPrinterId, html: payload.html, copies: payload.copies });
      } else if (payload?.file_path) {
        await invoke("print_file", { printer_id: selectedPrinterId, file_path: payload.file_path, copies: payload.copies });
      }
      event.source?.postMessage({ type: "__apexapp_print_response", success: true }, { targetOrigin: "*" });
    } catch (err) {
      event.source?.postMessage({ type: "__apexapp_print_response", error: String(err) }, { targetOrigin: "*" });
    }
  }

  if (type === "__apexapp_scan_request") {
    await startScan();
  }

  if (type === "__apexapp_get_printer") {
    event.source?.postMessage({
      type: "__apexapp_printer_state",
      printerId: selectedPrinterId,
      printerName: selectedPrinterName,
    }, { targetOrigin: "*" });
  }
});

// ── ENV ───────────────────────────────────────────────────────────────────────
async function loadEnvVars() {
  try {
    envVars = await invoke("get_env_vars");
    renderEnvVars();
    populateTunnelInputs();
  } catch (err) { console.error("Failed to load .env", err); }
}

function populateTunnelInputs() {
  const find = (k: string) => envVars.find(e => e.key === k)?.value;
  if (find("APEX_TUNNEL_SERVER")) apexServerInput.value = find("APEX_TUNNEL_SERVER")!;
  if (find("APEX_TUNNEL_DOMAIN")) apexDomainInput.value = find("APEX_TUNNEL_DOMAIN")!;
  if (find("APEX_TUNNEL_TOKEN")) apexTokenInput.value = find("APEX_TUNNEL_TOKEN")!;
  if (find("CF_TUNNEL_TOKEN")) cfTokenInput.value = find("CF_TUNNEL_TOKEN")!;
}

function renderEnvVars() {
  envListEl.innerHTML = "";
  if (!envVars.length) {
    envListEl.innerHTML = `<div style="color:#64748b;font-size:0.85rem;font-style:italic;">No environment variables found.</div>`;
    return;
  }
  envVars.forEach((env, index) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;align-items:center;";
    const keyInput = document.createElement("input");
    keyInput.value = env.key; keyInput.style.cssText = "flex:1;padding:6px;font-family:monospace;border:1px solid #e2e8f0;border-radius:4px;outline:none;";
    keyInput.oninput = (e) => envVars[index].key = (e.target as HTMLInputElement).value;
    const valInput = document.createElement("input");
    valInput.value = env.value; valInput.style.cssText = "flex:2;padding:6px;font-family:monospace;border:1px solid #e2e8f0;border-radius:4px;outline:none;";
    valInput.oninput = (e) => envVars[index].value = (e.target as HTMLInputElement).value;
    const delBtn = document.createElement("button");
    delBtn.textContent = "✕"; delBtn.style.cssText = "border:none;background:#fee2e2;color:#ef4444;cursor:pointer;padding:6px 12px;border-radius:4px;font-weight:bold;";
    delBtn.onclick = () => { envVars.splice(index, 1); renderEnvVars(); };
    row.appendChild(keyInput); row.appendChild(valInput); row.appendChild(delBtn);
    envListEl.appendChild(row);
  });
}

btnAddEnv.addEventListener("click", () => {
  const key = envKeyInput.value.trim();
  const val = envValInput.value.trim();
  if (!key) return;
  const idx = envVars.findIndex(e => e.key === key);
  if (idx !== -1) envVars[idx].value = val; else envVars.push({ key, value: val });
  envKeyInput.value = ""; envValInput.value = "";
  renderEnvVars();
});

btnSaveEnv.addEventListener("click", async () => {
  const orig = btnSaveEnv.textContent;
  btnSaveEnv.textContent = "Saving..."; btnSaveEnv.disabled = true;
  try {
    await invoke("save_env_vars", { vars: envVars.filter(e => e.key.trim() !== "") });
    btnSaveEnv.textContent = "Saved!";
    setTimeout(() => { btnSaveEnv.textContent = orig!; btnSaveEnv.disabled = false; }, 2000);
    loadEnvVars();
  } catch (err) {
    alert("Failed to save .env");
    btnSaveEnv.textContent = orig!; btnSaveEnv.disabled = false;
  }
});

// ── MISC ──────────────────────────────────────────────────────────────────────
async function fetchBranding() {
  try {
    const res = await fetch(`${API_BASE}/app-name`);
    if (res.ok) { const d = await res.json(); if (d.app_name) appNameEl.textContent = d.app_name; }
    const logoUrl = `${API_BASE}/logo?t=${Date.now()}`;
    const imgRes = await fetch(logoUrl, { method: 'HEAD' });
    if (imgRes.ok) appLogoEl.src = logoUrl;
  } catch (e) { }
}

document.querySelector("#greet-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  greetMsgEl.textContent = await invoke("greet", { name: greetInputEl.value });
});

serverBtn.addEventListener("click", startServer);

listen("sidecar-log", (event) => appendLog(event.payload as string));

function appendLog(message: string) {
  const line = document.createElement("div");
  line.style.cssText = "margin-bottom:2px;border-bottom:1px solid #1e293b;padding-bottom:2px;";
  const now = new Date().toLocaleTimeString();
  const timeSpan = document.createElement("span");
  timeSpan.style.cssText = "color:#64748b;margin-right:8px;";
  timeSpan.textContent = `[${now}]`;
  const textSpan = document.createElement("span");
  textSpan.style.color = message.includes("ERROR") ? "#f87171" : message.includes("[Tunnel]") ? "#fb923c" : "#38bdf8";
  textSpan.textContent = message;
  line.appendChild(timeSpan); line.appendChild(textSpan);
  consoleArea.appendChild(line);
  consoleArea.scrollTop = consoleArea.scrollHeight;
  if (consoleArea.childNodes.length > 200) consoleArea.removeChild(consoleArea.firstChild!);
}

btnClearConsole.addEventListener('click', () => {
  consoleArea.innerHTML = `<div style="color:#64748b;">-- Console Cleared --</div>`;
});

// ── QR ────────────────────────────────────────────────────────────────────────
btnQrUrl.addEventListener('click', async () => {
  const url = tunnelUrlText.textContent;
  if (!url || url.includes("Waiting") || url.includes("Custom")) return;
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, url, { width: 280, margin: 2, color: { dark: '#0f172a', light: '#f8fafc' } });
  qrContainer.innerHTML = '';
  qrContainer.appendChild(canvas);
  qrUrlDisplay.textContent = url;
  qrModal.style.display = 'flex';
});

btnCloseQr.addEventListener('click', () => qrModal.style.display = 'none');
qrModal.addEventListener('click', (e) => { if (e.target === qrModal) qrModal.style.display = 'none'; });