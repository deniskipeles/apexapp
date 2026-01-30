import { invoke } from "@tauri-apps/api/core";

// Navigation Elements
const navHome = document.querySelector("#nav-home") as HTMLButtonElement;
const navApp = document.querySelector("#nav-app") as HTMLButtonElement;
const navDash = document.querySelector("#nav-dash") as HTMLButtonElement;
const btnRefresh = document.querySelector("#btn-refresh") as HTMLButtonElement;

const viewHome = document.querySelector("#view-home") as HTMLElement;
const viewApp = document.querySelector("#view-app") as HTMLElement;
const viewDash = document.querySelector("#view-dash") as HTMLElement;

// Server Controls
const serverBtn = document.querySelector("#server-btn") as HTMLButtonElement;
const statusText = document.querySelector("#status-text") as HTMLElement;
const statusDot = document.querySelector("#status-dot") as HTMLElement;
const windowModeToggle = document.querySelector("#window-mode-toggle") as HTMLInputElement;

// Frames & Loaders
const frameApp = document.querySelector("#frame-app") as HTMLIFrameElement;
const loaderApp = document.querySelector("#loader-app") as HTMLElement;

const frameDash = document.querySelector("#frame-dash") as HTMLIFrameElement;
const loaderDash = document.querySelector("#loader-dash") as HTMLElement;

// Greet Elements
const greetInputEl = document.querySelector("#greet-input") as HTMLInputElement;
const greetMsgEl = document.querySelector("#greet-msg") as HTMLElement;

let isServerRunning = false;

// ---------------------------------------------------------
// 1. REFRESH LOGIC (Soft Refresh)
// ---------------------------------------------------------
function refreshCurrentView() {
  if (!isServerRunning) return;

  const useNewWindow = windowModeToggle.checked;
  const baseUrl = "http://localhost:5000";

  // APP VIEW
  if (navApp.classList.contains('active')) {
    if (useNewWindow) {
      // Focus external window
      invoke("open_separate_window", { label: "apex-app-window", title: "Apex App", url: baseUrl + "/" });
    } else {
      // Reload Iframe
      console.log("Refreshing App Iframe...");
      // Append timestamp to force reload if cache is stubborn, or just reassign src
      frameApp.src = frameApp.src; 
    }
  } 
  // DASHBOARD VIEW
  else if (navDash.classList.contains('active')) {
    if (useNewWindow) {
      invoke("open_separate_window", { label: "apex-dash-window", title: "Apex Dashboard", url: baseUrl + "/_dashboard" });
    } else {
      console.log("Refreshing Dashboard Iframe...");
      frameDash.src = frameDash.src;
    }
  }
}

// Bind the button
btnRefresh.addEventListener('click', refreshCurrentView);

// ---------------------------------------------------------
// 2. DISPLAY LOGIC
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
      loaderApp.innerHTML = `<h3>External Window Active</h3><p>App running in separate window.</p>`;
    } else {
      loaderApp.style.display = 'none';
      frameApp.style.display = 'block';
      if (frameApp.src === "about:blank") frameApp.src = baseUrl + "/";
    }
  } 
  else if (viewName === 'dash') {
    if (useNewWindow) {
      invoke("open_separate_window", { label: "apex-dash-window", title: "Apex Dashboard", url: baseUrl + "/_dashboard" });
      frameDash.style.display = 'none';
      loaderDash.style.display = 'flex';
      loaderDash.innerHTML = `<h3>External Window Active</h3><p>Dashboard running in separate window.</p>`;
    } else {
      loaderDash.style.display = 'none';
      frameDash.style.display = 'block';
      if (frameDash.src === "about:blank") frameDash.src = baseUrl + "/_dashboard";
    }
  }
}

function switchView(viewName: 'home' | 'app' | 'dash') {
  [navHome, navApp, navDash].forEach(el => el.classList.remove('active'));
  [viewHome, viewApp, viewDash].forEach(el => el.classList.remove('active'));

  if (viewName === 'home') {
    navHome.classList.add('active');
    viewHome.classList.add('active');
  } else if (viewName === 'app') {
    navApp.classList.add('active');
    viewApp.classList.add('active');
    handleContentDisplay('app');
  } else if (viewName === 'dash') {
    navDash.classList.add('active');
    viewDash.classList.add('active');
    handleContentDisplay('dash');
  }

  // Auto-start check
  if (viewName !== 'home' && !isServerRunning) {
    startServer();
  }
}

navHome.addEventListener('click', () => switchView('home'));
navApp.addEventListener('click', () => switchView('app'));
navDash.addEventListener('click', () => switchView('dash'));

// ---------------------------------------------------------
// 3. SERVER LOGIC
// ---------------------------------------------------------
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

function setServerRunningState() {
    isServerRunning = true;
    statusText.textContent = "Running";
    statusDot.classList.add("running");
    serverBtn.textContent = "Running";
    serverBtn.disabled = true;
}

async function startServer() {
  if (isServerRunning) return;

  serverBtn.disabled = true;
  serverBtn.textContent = "Starting...";
  statusText.textContent = "Initializing...";
  
  // Show loaders if we are on a content page
  if (navApp.classList.contains('active') || navDash.classList.contains('active')) {
    loaderApp.style.display = "flex";
    loaderDash.style.display = "flex";
  }

  try {
    await invoke("run_apex_sidecar");
    const success = await waitForServer();

    if (success) {
      setServerRunningState();
      
      // Load current view content
      if (navApp.classList.contains('active')) handleContentDisplay('app');
      if (navDash.classList.contains('active')) handleContentDisplay('dash');
    } else {
      throw new Error("Timed out");
    }

  } catch (error) {
    console.error(error);
    statusText.textContent = "Error";
    serverBtn.textContent = "Retry Start";
    serverBtn.disabled = false;
    alert("Failed to start ApexKit server.");
    switchView('home');
  }
}

serverBtn.addEventListener("click", startServer);

// ---------------------------------------------------------
// 4. STATE RECOVERY (Handle F5 / Hard Refresh)
// ---------------------------------------------------------
window.addEventListener("DOMContentLoaded", async () => {
    // If the user refreshed the app (F5), the JS state is reset.
    // However, the sidecar might still be running. Check immediately.
    const alreadyUp = await waitForServer(1);
    
    if (alreadyUp) {
        console.log("Server detected on startup (Recovery).");
        setServerRunningState();
        
        // Optional: If you wanted to restore the last active tab, 
        // you would need to save it to localStorage in switchView() 
        // and read it back here.
    }
});

// Greet Logic
async function greet() {
  if (greetMsgEl && greetInputEl) {
    greetMsgEl.textContent = await invoke("greet", { name: greetInputEl.value });
  }
}
document.querySelector("#greet-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  greet();
});