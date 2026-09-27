import { ServerManager } from './modules/server';
import { TunnelManager } from './modules/tunnels';
import { PrinterManager } from './modules/printer';
import { ScannerManager } from './modules/scanner';
import { EnvManager } from './modules/env';
import { ConsoleManager } from './modules/console';
import { BridgeManager } from './modules/bridge';
import { ModalManager } from './modules/modal';
import { SettingsStorage } from './modules/storage';
import './styles.css';

// ── NAVIGATION CONTROLLER ───────────────────────────────────────────────────
function initNavigation() {
  const brandHomeBtn = document.querySelector('#brand-home-btn') as HTMLElement;
  const navSettingsBtn = document.querySelector('#nav-settings-btn') as HTMLButtonElement;
  const btnBackFromDash = document.querySelector('#btn-back-from-dash') as HTMLButtonElement;

  const viewApp = document.querySelector('#view-app') as HTMLElement;
  const viewDash = document.querySelector('#view-dash') as HTMLElement;
  const viewSettings = document.querySelector('#view-settings') as HTMLElement;

  let hasDiscoveredPrinters = false;

  const switchToApp = () => {
    viewApp.classList.add('active');
    viewDash.classList.remove('active');
    viewSettings.classList.remove('active');
    navSettingsBtn?.classList.remove('active');
    ServerManager.handleContentDisplay('app');

    if (!ServerManager.getRunningStatus()) {
      ServerManager.startServer();
    }
  };

  const switchToSettings = () => {
    viewSettings.classList.add('active');
    viewApp.classList.remove('active');
    viewDash.classList.remove('active');
    navSettingsBtn?.classList.add('active');

    if (!hasDiscoveredPrinters) {
      hasDiscoveredPrinters = true;
      PrinterManager.loadPrinters();
    }
  };

  // Brand logo + app name directly opens the App
  brandHomeBtn?.addEventListener('click', switchToApp);

  // Settings toggle icon
  navSettingsBtn?.addEventListener('click', () => {
    if (viewSettings.classList.contains('active')) {
      switchToApp();
    } else {
      switchToSettings();
    }
  });

  btnBackFromDash?.addEventListener('click', switchToApp);

  // Start on the primary app view
  switchToApp();
}

// ── DASHBOARD SETTINGS CARD CONTROLLER ──────────────────────────────────────
function initDashboardControls() {
  const dashboardPathInput = document.querySelector('#dashboard-path-input') as HTMLInputElement;
  const btnSaveDashboardPath = document.querySelector('#btn-save-dashboard-path') as HTMLButtonElement;
  const btnOpenDashboard = document.querySelector('#btn-open-dashboard') as HTMLButtonElement;
  const btnOpenDashboardWindow = document.querySelector('#btn-open-dashboard-window') as HTMLButtonElement;

  if (dashboardPathInput) {
    const s = SettingsStorage.get();
    dashboardPathInput.value = s.dashboardPath || '/_dashboard';

    // Populate from .env if present
    EnvManager.loadEnvVars().then((vars) => {
      const match = vars.find((v) => v.key === 'ADMIN_DASHBOARD_PATH');
      if (match && match.value) {
        dashboardPathInput.value = match.value;
        SettingsStorage.update({ dashboardPath: match.value });
      }
    });

    btnSaveDashboardPath?.addEventListener('click', async () => {
      const cleanPath = dashboardPathInput.value.trim() || '/_dashboard';
      SettingsStorage.update({ dashboardPath: cleanPath });
      await EnvManager.upsert('ADMIN_DASHBOARD_PATH', cleanPath);

      const orig = btnSaveDashboardPath.textContent;
      btnSaveDashboardPath.textContent = 'Saved!';
      setTimeout(() => (btnSaveDashboardPath.textContent = orig), 2000);
    });
  }

  btnOpenDashboard?.addEventListener('click', () => {
    ServerManager.openDashboard(false);
  });

  btnOpenDashboardWindow?.addEventListener('click', () => {
    ServerManager.openDashboard(true);
  });
}

// ── BOOTSTRAP ───────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize Modals, Settings & Iframe Bridge
  ModalManager.init();
  BridgeManager.init();

  // 2. Initialize Hardware & Tools
  PrinterManager.init();
  ScannerManager.init();
  EnvManager.init();
  ConsoleManager.init();
  TunnelManager.init();
  ServerManager.init();

  // 3. Setup Navigation & Dashboard Settings Controls
  initNavigation();
  initDashboardControls();

  // 4. Auto-connect or resume sidecar
  const alreadyUp = await ServerManager.waitForServer(1);
  if (alreadyUp) {
    ServerManager.setServerRunningState();
    ServerManager.fetchBranding();
    ServerManager.reloadFrames();
  } else if (SettingsStorage.get().autoStartServer) {
    ServerManager.startServer();
  }
});