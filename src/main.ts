import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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
const btnCopyUrl = document.querySelector("#btn-copy-url") as HTMLButtonElement;

// Branding
const appNameEl = document.querySelector("#app-name") as HTMLElement;
const appLogoEl = document.querySelector("#app-logo") as HTMLImageElement;
const greetInputEl = document.querySelector("#greet-input") as HTMLInputElement;
const greetMsgEl = document.querySelector("#greet-msg") as HTMLElement;

// Console
const consoleArea = document.querySelector("#console-area") as HTMLElement;
const btnClearConsole = document.querySelector("#btn-clear-console") as HTMLButtonElement;

let isServerRunning = false;
let isTunnelRunning = false;

// ---------------------------------------------------------
// 1. INITIALIZATION & VIEW SWITCHING
// ---------------------------------------------------------

// Default to APP view immediately
window.addEventListener("DOMContentLoaded", async () => {
  switchView('app');
  
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
    btnToggleTunnel.disabled = true;
    btnToggleTunnel.textContent = "Starting Tunnel...";
    tunnelStatusText.textContent = "Initializing...";
    
    // Invoke Rust command
    const res = await invoke("toggle_cf_tunnel", { start: true });
    console.log(res);

    // Note: The UI updates when the "tunnel-url" event fires below
  } else {
    // Stop
    isTunnelRunning = false;
    await invoke("toggle_cf_tunnel", { start: false });
    updateTunnelUI(false);
  }
});

// Listen for Rust event containing the URL
listen("tunnel-url", (event) => {
  const url = event.payload as string;
  console.log("Tunnel URL received:", url);
  isTunnelRunning = true;
  tunnelUrlText.textContent = url;
  updateTunnelUI(true);
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
  } else {
    tunnelStatusText.textContent = "Tunnel Offline";
    tunnelStatusText.style.color = "#64748b";
    tunnelDot.classList.remove("running");
    btnToggleTunnel.textContent = "Start Public Tunnel";
    btnToggleTunnel.style.backgroundColor = "#f97316"; // Orange for start
    tunnelUrlBox.style.display = "none";
    tunnelUrlText.textContent = "Waiting for connection...";
  }
}

btnCopyUrl.addEventListener('click', () => {
  navigator.clipboard.writeText(tunnelUrlText.textContent || "");
  const original = btnCopyUrl.textContent;
  btnCopyUrl.textContent = "Copied!";
  setTimeout(() => btnCopyUrl.textContent = original, 2000);
});

// ---------------------------------------------------------
// 5. MISC
// ---------------------------------------------------------
async function fetchBranding() {
  const baseUrl = "http://localhost:5000";
  try {
    const res = await fetch(`${baseUrl}/app-name`);
    if (res.ok) {
      const data = await res.json();
      if (data.app_name) appNameEl.textContent = data.app_name;
    }

    // Add this section to use appLogoEl:
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