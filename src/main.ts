import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import QRCode from 'qrcode';

// Navigation
const navApp = document.querySelector("#nav-app") as HTMLButtonElement;
const navDash = document.querySelector("#nav-dash") as HTMLButtonElement;
const navSettings = document.querySelector("#nav-settings") as HTMLButtonElement;
const btnRefresh = document.querySelector("#btn-refresh") as HTMLButtonElement;

// Views
const viewApp = document.querySelector("#view-app") as HTMLElement;
const viewDash = document.querySelector("#view-dash") as HTMLElement;
const viewSettings = document.querySelector("#view-settings") as HTMLElement;

// Server Controls (Header)
const serverBtn = document.querySelector("#server-btn") as HTMLButtonElement;
const statusText = document.querySelector("#status-text") as HTMLElement;
const statusDot = document.querySelector("#status-dot") as HTMLElement;
const windowModeToggle = document.querySelector("#window-mode-toggle") as HTMLInputElement;

// App/Dash Loaders
const frameApp = document.querySelector("#frame-app") as HTMLIFrameElement;
const loaderApp = document.querySelector("#loader-app") as HTMLElement;
const frameDash = document.querySelector("#frame-dash") as HTMLIFrameElement;
const loaderDash = document.querySelector("#loader-dash") as HTMLElement;

// Settings / Tunnel Elements
const btnToggleTunnel = document.querySelector("#btn-toggle-tunnel") as HTMLButtonElement;
const tunnelStatusText = document.querySelector("#tunnel-status-text") as HTMLElement;
const tunnelDot = document.querySelector("#tunnel-dot") as HTMLElement;
const tunnelUrlBox = document.querySelector("#tunnel-url-box") as HTMLElement;
const tunnelUrlText = document.querySelector("#tunnel-url-text") as HTMLElement;
const tunnelWarningText = document.querySelector("#tunnel-warning-text") as HTMLElement;
const btnCopyUrl = document.querySelector("#btn-copy-url") as HTMLButtonElement;
const cfTokenInput = document.querySelector("#cf-token-input") as HTMLInputElement;
// Custom Apex Tunnel
const btnToggleApexTunnel = document.querySelector("#btn-toggle-apex-tunnel") as HTMLButtonElement;
const apexTunnelStatusText = document.querySelector("#apex-tunnel-status-text") as HTMLElement;
const apexTunnelDot = document.querySelector("#apex-tunnel-dot") as HTMLElement;
const apexTunnelUrlBox = document.querySelector("#apex-tunnel-url-box") as HTMLElement;
const apexTunnelUrlText = document.querySelector("#apex-tunnel-url-text") as HTMLElement;
const apexSubdomainInput = document.querySelector("#apex-subdomain-input") as HTMLInputElement;

let isApexTunnelRunning = false;

// .env Management Elements
const envListEl = document.querySelector("#env-list") as HTMLElement;
const envKeyInput = document.querySelector("#env-key-input") as HTMLInputElement;
const envValInput = document.querySelector("#env-val-input") as HTMLInputElement;
const btnAddEnv = document.querySelector("#btn-add-env") as HTMLButtonElement;
const btnSaveEnv = document.querySelector("#btn-save-env") as HTMLButtonElement;

// Branding
const appNameEl = document.querySelector("#app-name") as HTMLElement;
const appLogoEl = document.querySelector("#app-logo") as HTMLImageElement;
const greetInputEl = document.querySelector("#greet-input") as HTMLInputElement;
const greetMsgEl = document.querySelector("#greet-msg") as HTMLElement;

// Console
const consoleArea = document.querySelector("#console-area") as HTMLElement;
const btnClearConsole = document.querySelector("#btn-clear-console") as HTMLButtonElement;

// QR code
const btnQrUrl = document.querySelector("#btn-qr-url") as HTMLButtonElement;
const qrModal = document.querySelector("#qr-modal") as HTMLElement;
const qrContainer = document.querySelector("#qr-code-container") as HTMLElement;
const qrUrlDisplay = document.querySelector("#qr-url-display") as HTMLElement;
const btnCloseQr = document.querySelector("#btn-close-qr") as HTMLButtonElement;

let isServerRunning = false;
let isTunnelRunning = false;
let isCustomDomain = false;

interface EnvVar {
  key: string;
  value: string;
}
let envVars: EnvVar[] = [];

// ---------------------------------------------------------
// 1. INITIALIZATION & VIEW SWITCHING
// ---------------------------------------------------------

// Default to APP view immediately
window.addEventListener("DOMContentLoaded", async () => {
  switchView('app');
  
  // Load Env Variables immediately on boot
  loadEnvVars();

  // Check if server is already alive (from reload)
  const alreadyUp = await waitForServer(1);
  if (alreadyUp) {
    setServerRunningState();
    fetchBranding();
    reloadFrames();
  }
});

function switchView(viewName: 'app' | 'dash' | 'settings') {
  [navApp, navDash, navSettings].forEach(el => el.classList.remove('active'));
  [viewApp, viewDash, viewSettings].forEach(el => el.classList.remove('active'));

  if (viewName === 'app') {
    navApp.classList.add('active');
    viewApp.classList.add('active');
    handleContentDisplay('app');
  } else if (viewName === 'dash') {
    navDash.classList.add('active');
    viewDash.classList.add('active');
    handleContentDisplay('dash');
  } else if (viewName === 'settings') {
    navSettings.classList.add('active');
    viewSettings.classList.add('active');
  }

  // Auto-start server if user navigates to content and it's off
  if ((viewName === 'app' || viewName === 'dash') && !isServerRunning) {
    startServer();
  }
}

navApp.addEventListener('click', () => switchView('app'));
navDash.addEventListener('click', () => switchView('dash'));
navSettings.addEventListener('click', () => switchView('settings'));

// ---------------------------------------------------------
// 2. SERVER LIFECYCLE
// ---------------------------------------------------------

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

    if (success) {
      setServerRunningState();
      fetchBranding();
      reloadFrames();
    } else {
      throw new Error("Timed out");
    }
  } catch (error) {
    console.error(error);
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
      const response = await fetch("http://localhost:5000/", { method: 'HEAD' });
      if (response.ok || response.status === 401 || response.status === 403) return true;
    } catch (e) { /* wait */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

// ---------------------------------------------------------
// 3. IFRAME & WINDOW MANAGEMENT
// ---------------------------------------------------------

function handleContentDisplay(viewName: 'app' | 'dash') {
  if (!isServerRunning) return;
  const useNewWindow = windowModeToggle.checked;
  const baseUrl = "http://localhost:5000";

  if (viewName === 'app') {
    if (useNewWindow) {
      invoke("open_separate_window", { label: "apex-app-window", title: "Apex App", url: baseUrl + "/" });
      frameApp.style.display = 'none';
      loaderApp.style.display = 'flex';
      loaderApp.innerHTML = `<h3>External Window Active</h3>`;
    } else {
      loaderApp.style.display = 'none';
      frameApp.style.display = 'block';
      if (frameApp.src === "about:blank") frameApp.src = baseUrl + "/";
    }
  } else if (viewName === 'dash') {
    if (useNewWindow) {
      invoke("open_separate_window", { label: "apex-dash-window", title: "Apex Dashboard", url: baseUrl + "/_dashboard" });
      frameDash.style.display = 'none';
      loaderDash.style.display = 'flex';
      loaderDash.innerHTML = `<h3>External Window Active</h3>`;
    } else {
      loaderDash.style.display = 'none';
      frameDash.style.display = 'block';
      if (frameDash.src === "about:blank") frameDash.src = baseUrl + "/_dashboard";
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

// ---------------------------------------------------------
// 4. CLOUDFLARE TUNNEL LOGIC
// ---------------------------------------------------------

btnToggleTunnel.addEventListener('click', async () => {
  if (!isTunnelRunning) {
    // Start
    const tokenValue = cfTokenInput.value.trim();
    isCustomDomain = tokenValue !== "";

    btnToggleTunnel.disabled = true;
    btnToggleTunnel.textContent = "Starting Tunnel...";
    tunnelStatusText.textContent = "Initializing...";
    
    // Invoke Rust command, passing the token
    const res = await invoke("toggle_cf_tunnel", { start: true, token: tokenValue });
    console.log(res);

    // If using a token, CF won't emit a URL to stdout, so we rely on the connection confirmation event
  } else {
    // Stop
    isTunnelRunning = false;
    isCustomDomain = false;
    await invoke("toggle_cf_tunnel", { start: false, token: null });
    updateTunnelUI(false);
  }
});

// Listen for Random Quick Tunnel URL
listen("tunnel-url", (event) => {
  if (!isCustomDomain) {
    const url = event.payload as string;
    console.log("Tunnel URL received:", url);
    isTunnelRunning = true;
    tunnelUrlText.textContent = url;
    updateTunnelUI(true);
  }
});

// Listen for Managed Tunnel Connection
listen("tunnel-managed-connected", () => {
  if (isCustomDomain) {
    console.log("Managed Tunnel Connected");
    isTunnelRunning = true;
    tunnelUrlText.textContent = "Custom Domain Active (Managed via Cloudflare)";
    updateTunnelUI(true);
  }
});

function updateTunnelUI(running: boolean) {
  btnToggleTunnel.disabled = false;
  if (running) {
    tunnelStatusText.textContent = "Tunnel Online";
    tunnelStatusText.style.color = "#10b981";
    tunnelDot.classList.add("running");
    btnToggleTunnel.textContent = "Stop Tunnel";
    btnToggleTunnel.style.backgroundColor = "#ef4444"; // Red for stop
    tunnelUrlBox.style.display = "block";
    cfTokenInput.disabled = true; // Lock input while running

    // Hide copy/QR buttons if using a custom domain (we don't know the URL locally)
    if (isCustomDomain) {
      btnCopyUrl.style.display = "none";
      btnQrUrl.style.display = "none";
      tunnelWarningText.textContent = "Your app is being routed through Cloudflare Zero Trust.";
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
    btnToggleTunnel.style.backgroundColor = "#f97316"; // Orange for start
    tunnelUrlBox.style.display = "none";
    tunnelUrlText.textContent = "Waiting for connection...";
    cfTokenInput.disabled = false; // Unlock input
  }
}

btnCopyUrl.addEventListener('click', () => {
  navigator.clipboard.writeText(tunnelUrlText.textContent || "");
  const original = btnCopyUrl.textContent;
  btnCopyUrl.textContent = "Copied!";
  setTimeout(() => btnCopyUrl.textContent = original, 2000);
});
// ---------------------------------------------------------
// APEX FREE TUNNEL LOGIC
// ---------------------------------------------------------
const apexTokenInput = document.querySelector("#apex-token-input") as HTMLInputElement;

btnToggleApexTunnel.addEventListener('click', async () => {
  if (!isApexTunnelRunning) {
    // Start
    const subdomain = apexSubdomainInput.value.trim();
    const token = apexTokenInput.value.trim();

    if (!subdomain || !token) {
        alert("Please enter both your Token and Subdomain.");
        return;
    }

    btnToggleApexTunnel.disabled = true;
    btnToggleApexTunnel.textContent = "Starting Tunnel...";
    apexTunnelStatusText.textContent = "Authenticating...";
    
    // Disable CF Tunnel button to prevent conflicts
    btnToggleTunnel.disabled = true;

    try {
      await invoke("toggle_apex_tunnel", { start: true, subdomain, token });
    } catch(err) {
      alert(err);
      updateApexTunnelUI(false);
    }
  } else {
    // Stop
    isApexTunnelRunning = false;
    await invoke("toggle_apex_tunnel", { start: false, subdomain: null, token: null });
    updateApexTunnelUI(false);
    btnToggleTunnel.disabled = false;
  }
});

// Listen for successful FRPC connection
listen("apex-tunnel-connected", (event) => {
  const url = event.payload as string;
  isApexTunnelRunning = true;
  apexTunnelUrlText.textContent = url;
  updateApexTunnelUI(true);
});

// Listen for Rejections
listen("apex-tunnel-error", (event) => {
  const err = event.payload as string;
  alert("Tunnel Error: " + err);
  
  isApexTunnelRunning = false;
  invoke("toggle_apex_tunnel", { start: false, subdomain: null, token: null });
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
    apexSubdomainInput.disabled = true; 
    apexTokenInput.disabled = true;
  } else {
    apexTunnelStatusText.textContent = "Tunnel Offline";
    apexTunnelStatusText.style.color = "#64748b";
    apexTunnelDot.classList.remove("running");
    btnToggleApexTunnel.textContent = "Start Managed Tunnel";
    btnToggleApexTunnel.style.backgroundColor = "#3b82f6"; 
    apexTunnelUrlBox.style.display = "none";
    apexTunnelUrlText.textContent = "Waiting for connection...";
    apexSubdomainInput.disabled = false; 
    apexTokenInput.disabled = false;
  }
}

// ---------------------------------------------------------
// 5. .ENV MANAGEMENT LOGIC
// ---------------------------------------------------------

async function loadEnvVars() {
  try {
    envVars = await invoke("get_env_vars");
    renderEnvVars();
  } catch (err) {
    console.error("Failed to load .env", err);
  }
}

function renderEnvVars() {
  envListEl.innerHTML = "";
  if (envVars.length === 0) {
     envListEl.innerHTML = `<div style="color: #64748b; font-size: 0.85rem; font-style: italic;">No environment variables found.</div>`;
     return;
  }

  envVars.forEach((env, index) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "10px";
    row.style.alignItems = "center";
    
    const keyInput = document.createElement("input");
    keyInput.value = env.key;
    keyInput.style.flex = "1";
    keyInput.style.padding = "6px";
    keyInput.style.fontFamily = "monospace";
    keyInput.style.border = "1px solid #e2e8f0";
    keyInput.style.borderRadius = "4px";
    keyInput.style.outline = "none";
    keyInput.oninput = (e) => envVars[index].key = (e.target as HTMLInputElement).value;

    const valInput = document.createElement("input");
    valInput.value = env.value;
    valInput.style.flex = "2";
    valInput.style.padding = "6px";
    valInput.style.fontFamily = "monospace";
    valInput.style.border = "1px solid #e2e8f0";
    valInput.style.borderRadius = "4px";
    valInput.style.outline = "none";
    valInput.oninput = (e) => envVars[index].value = (e.target as HTMLInputElement).value;

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.title = "Delete";
    delBtn.style.border = "none";
    delBtn.style.background = "#fee2e2";
    delBtn.style.color = "#ef4444";
    delBtn.style.cursor = "pointer";
    delBtn.style.padding = "6px 12px";
    delBtn.style.borderRadius = "4px";
    delBtn.style.fontWeight = "bold";
    delBtn.onclick = () => {
       envVars.splice(index, 1);
       renderEnvVars();
    };

    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(delBtn);
    envListEl.appendChild(row);
  });
}

btnAddEnv.addEventListener("click", () => {
  const key = envKeyInput.value.trim();
  const val = envValInput.value.trim();
  if (key) {
    // Overwrite if key already exists, otherwise add
    const existingIndex = envVars.findIndex(e => e.key === key);
    if (existingIndex !== -1) {
        envVars[existingIndex].value = val;
    } else {
        envVars.push({ key, value: val });
    }
    
    envKeyInput.value = "";
    envValInput.value = "";
    renderEnvVars();
  }
});

btnSaveEnv.addEventListener("click", async () => {
  try {
    const originalText = btnSaveEnv.textContent;
    btnSaveEnv.textContent = "Saving...";
    btnSaveEnv.disabled = true;
    
    // Filter out empty keys before saving
    const validVars = envVars.filter(e => e.key.trim() !== "");
    await invoke("save_env_vars", { vars: validVars });
    
    btnSaveEnv.textContent = "Saved!";
    setTimeout(() => {
       btnSaveEnv.textContent = originalText;
       btnSaveEnv.disabled = false;
    }, 2000);
    
    loadEnvVars(); // Refresh to normalize visual state
  } catch (err) {
    console.error(err);
    alert("Failed to save .env file");
    btnSaveEnv.textContent = "Save to .env";
    btnSaveEnv.disabled = false;
  }
});

// ---------------------------------------------------------
// 6. MISC
// ---------------------------------------------------------
async function fetchBranding() {
  const baseUrl = "http://localhost:5000";
  try {
    const res = await fetch(`${baseUrl}/app-name`);
    if (res.ok) {
      const data = await res.json();
      if (data.app_name) appNameEl.textContent = data.app_name;
    }

    const logoUrl = `${baseUrl}/logo?t=${Date.now()}`;
    const imgRes = await fetch(logoUrl, { method: 'HEAD' });
    if (imgRes.ok) {
      appLogoEl.src = logoUrl;
    }
  } catch (e) {}
}

document.querySelector("#greet-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (greetMsgEl && greetInputEl) {
    greetMsgEl.textContent = await invoke("greet", { name: greetInputEl.value });
  }
});

serverBtn.addEventListener("click", startServer);

// ---------------------------------------------------------
// LIVE CONSOLE LOGIC
// ---------------------------------------------------------

listen("sidecar-log", (event) => {
  const msg = event.payload as string;
  appendLog(msg);
});

function appendLog(message: string) {
  const line = document.createElement("div");
  line.style.marginBottom = "2px";
  line.style.borderBottom = "1px solid #1e293b";
  line.style.paddingBottom = "2px";

  // Add Timestamp
  const now = new Date().toLocaleTimeString();
  const timeSpan = document.createElement("span");
  timeSpan.style.color = "#64748b";
  timeSpan.style.marginRight = "8px";
  timeSpan.textContent = `[${now}]`;
  
  const textSpan = document.createElement("span");
  // Color coding based on source
  if (message.includes("ERROR")) textSpan.style.color = "#f87171";
  else if (message.includes("[Tunnel]")) textSpan.style.color = "#fb923c";
  else textSpan.style.color = "#38bdf8";

  textSpan.textContent = message;

  line.appendChild(timeSpan);
  line.appendChild(textSpan);
  consoleArea.appendChild(line);

  // Auto-scroll to bottom
  consoleArea.scrollTop = consoleArea.scrollHeight;

  // Performance: Keep only last 200 lines
  if (consoleArea.childNodes.length > 200) {
    consoleArea.removeChild(consoleArea.firstChild!);
  }
}

btnClearConsole.addEventListener('click', () => {
  consoleArea.innerHTML = `<div style="color: #64748b;">-- Console Cleared --</div>`;
});


// ---------------------------------------------------------
// QR CODE LOGIC
// ---------------------------------------------------------

btnQrUrl.addEventListener('click', async () => {
  const url = tunnelUrlText.textContent;
  if (!url || url.includes("Waiting") || url.includes("Custom Domain")) return;

  try {
    // 1. Create a canvas element
    const canvas = document.createElement('canvas');
    
    // 2. Generate QR on the canvas
    await QRCode.toCanvas(canvas, url, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f172a',  // Slate 900
        light: '#f8fafc'  // Slate 50
      }
    });

    // 3. Inject into UI
    qrContainer.innerHTML = '';
    qrContainer.appendChild(canvas);
    qrUrlDisplay.textContent = url;
    
    // 4. Show Modal
    qrModal.style.display = 'flex';
  } catch (err) {
    console.error("QR Generation failed", err);
  }
});

btnCloseQr.addEventListener('click', () => {
  qrModal.style.display = 'none';
});

// Close modal if clicking on the backdrop
qrModal.addEventListener('click', (e) => {
  if (e.target === qrModal) qrModal.style.display = 'none';
});