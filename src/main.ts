import { invoke } from "@tauri-apps/api/core";

// Navigation Elements
const navHome = document.querySelector("#nav-home") as HTMLButtonElement;
const navApp = document.querySelector("#nav-app") as HTMLButtonElement;
const navDash = document.querySelector("#nav-dash") as HTMLButtonElement;

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

// --- DISPLAY LOGIC (Iframe vs Window) ---
function handleContentDisplay(viewName: 'app' | 'dash') {
  if (!isServerRunning) return;

  const useNewWindow = windowModeToggle.checked;
  const baseUrl = "http://localhost:5000";

  if (viewName === 'app') {
    if (useNewWindow) {
      // NEW WINDOW MODE
      invoke("open_separate_window", { 
        label: "apex-app-window", 
        title: "Apex App", 
        url: baseUrl + "/" 
      });
      // Update loader to show status in main window
      frameApp.style.display = 'none';
      loaderApp.style.display = 'flex';
      loaderApp.innerHTML = `
        <img src="/src/assets/tauri.svg" class="loading-logo" style="width: 50px; height: 50px;">
        <h3>Open in External Window</h3>
        <p>The App is running in a separate window.</p>
      `;
    } else {
      // IFRAME MODE
      // Reset loader style
      loaderApp.innerHTML = `
        <img src="/src/assets/tauri.svg" class="loading-logo">
        <h3>Loading App...</h3>
        <p>Waiting for server connection...</p>
      `;
      loaderApp.style.display = 'none';
      frameApp.style.display = 'block';
      if (frameApp.src === "about:blank") frameApp.src = baseUrl + "/";
    }
  } 
  
  else if (viewName === 'dash') {
    if (useNewWindow) {
      // NEW WINDOW MODE
      invoke("open_separate_window", { 
        label: "apex-dash-window", 
        title: "Apex Dashboard", 
        url: baseUrl + "/_dashboard" 
      });
      frameDash.style.display = 'none';
      loaderDash.style.display = 'flex';
      loaderDash.innerHTML = `
        <img src="/src/assets/tauri.svg" class="loading-logo" style="width: 50px; height: 50px;">
        <h3>Open in External Window</h3>
        <p>The Dashboard is running in a separate window.</p>
      `;
    } else {
      // IFRAME MODE
      loaderDash.innerHTML = `
        <img src="/src/assets/tauri.svg" class="loading-logo">
        <h3>Loading Dashboard...</h3>
        <p>Waiting for server connection...</p>
      `;
      loaderDash.style.display = 'none';
      frameDash.style.display = 'block';
      if (frameDash.src === "about:blank") frameDash.src = baseUrl + "/_dashboard";
    }
  }
}

// --- NAVIGATION LOGIC ---
function switchView(viewName: 'home' | 'app' | 'dash') {
  // Reset active classes
  [navHome, navApp, navDash].forEach(el => el.classList.remove('active'));
  [viewHome, viewApp, viewDash].forEach(el => el.classList.remove('active'));

  // Set active class
  if (viewName === 'home') {
    navHome.classList.add('active');
    viewHome.classList.add('active');
  } else if (viewName === 'app') {
    navApp.classList.add('active');
    viewApp.classList.add('active');
    handleContentDisplay('app'); // Trigger display logic
  } else if (viewName === 'dash') {
    navDash.classList.add('active');
    viewDash.classList.add('active');
    handleContentDisplay('dash'); // Trigger display logic
  }

  // Auto-start if navigating to content
  if (viewName !== 'home' && !isServerRunning) {
    startServer();
  }
}

navHome.addEventListener('click', () => switchView('home'));
navApp.addEventListener('click', () => switchView('app'));
navDash.addEventListener('click', () => switchView('dash'));

// --- SERVER LOGIC ---

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch("http://localhost:5000/", { method: 'HEAD' });
      if (response.ok || response.status === 401 || response.status === 403) {
        return true;
      }
    } catch (e) { /* wait */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function startServer() {
  if (isServerRunning) return;

  // UI Updates: Loading State
  serverBtn.disabled = true;
  serverBtn.textContent = "Starting...";
  statusText.textContent = "Initializing...";
  
  // Show loaders
  loaderApp.style.display = "flex";
  frameApp.style.display = "none";
  loaderDash.style.display = "flex";
  frameDash.style.display = "none";

  try {
    // 1. Launch Binary
    await invoke("run_apex_sidecar");

    // 2. Poll
    const success = await waitForServer();

    if (success) {
      isServerRunning = true;
      statusText.textContent = "Running";
      statusDot.classList.add("running");
      serverBtn.textContent = "Running";

      // Trigger content load for whichever tab is active
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

// --- GREET LOGIC ---
async function greet() {
  if (greetMsgEl && greetInputEl) {
    greetMsgEl.textContent = await invoke("greet", { name: greetInputEl.value });
  }
}
document.querySelector("#greet-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  greet();
});