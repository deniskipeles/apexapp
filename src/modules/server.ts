import { invoke } from '@tauri-apps/api/core';
import { SettingsStorage } from './storage';

export class ServerManager {
  private static isRunning = false;
  private static serverBtn: HTMLButtonElement;
  private static statusText: HTMLElement;
  private static statusDot: HTMLElement;
  private static windowModeToggle: HTMLInputElement;
  private static frameApp: HTMLIFrameElement;
  private static loaderApp: HTMLElement;
  private static frameDash: HTMLIFrameElement;
  private static loaderDash: HTMLElement;
  private static appNameEl: HTMLElement;
  private static appLogoEl: HTMLImageElement;

  static getBaseUrl(): string {
    if (
      window.location.protocol === 'https:' ||
      (window.location.hostname !== 'localhost' &&
        window.location.hostname !== 'tauri.localhost' &&
        window.location.hostname !== '127.0.0.1')
    ) {
      return window.location.origin;
    }
    return 'http://localhost:5000';
  }

  static getDashboardPath(): string {
    const s = SettingsStorage.get();
    let path = s.dashboardPath || '/_dashboard';
    if (!path.startsWith('/')) path = '/' + path;
    return path;
  }

  static init() {
    this.serverBtn = document.querySelector('#server-btn') as HTMLButtonElement;
    this.statusText = document.querySelector('#status-text') as HTMLElement;
    this.statusDot = document.querySelector('#status-dot') as HTMLElement;
    this.windowModeToggle = document.querySelector('#window-mode-toggle') as HTMLInputElement;
    this.frameApp = document.querySelector('#frame-app') as HTMLIFrameElement;
    this.loaderApp = document.querySelector('#loader-app') as HTMLElement;
    this.frameDash = document.querySelector('#frame-dash') as HTMLIFrameElement;
    this.loaderDash = document.querySelector('#loader-dash') as HTMLElement;
    this.appNameEl = document.querySelector('#app-name') as HTMLElement;
    this.appLogoEl = document.querySelector('#app-logo') as HTMLImageElement;

    // Restore window mode toggle
    const settings = SettingsStorage.get();
    if (this.windowModeToggle) {
      this.windowModeToggle.checked = settings.openInNewWindow;
      this.windowModeToggle.addEventListener('change', () => {
        SettingsStorage.update({ openInNewWindow: this.windowModeToggle.checked });
        this.reloadFrames();
      });
    }

    this.serverBtn?.addEventListener('click', () => {
      if (!this.isRunning) this.startServer();
      else this.stopServer();
    });

    document.querySelector('#btn-close-app')?.addEventListener('click', () => {
      if (confirm('Are you sure you want to close ApexApp?')) {
        invoke('close_app');
      }
    });

    document.querySelector('#btn-refresh')?.addEventListener('click', () => {
      if (!this.isRunning) return;
      if (this.frameApp) this.frameApp.src = this.frameApp.src;
      if (this.frameDash && this.frameDash.src !== 'about:blank') this.frameDash.src = this.frameDash.src;
    });
  }

  static async startServer() {
    if (this.isRunning) return;
    this.serverBtn.disabled = true;
    this.serverBtn.textContent = 'Starting...';
    this.statusText.textContent = 'Initializing...';
    this.loaderApp.style.display = 'flex';
    if (this.loaderDash) this.loaderDash.style.display = 'flex';

    try {
      await invoke('run_apex_sidecar');
      const success = await this.waitForServer();
      if (success) {
        this.setServerRunningState();
        this.fetchBranding();
        this.reloadFrames();
      } else {
        throw new Error('Connection timed out');
      }
    } catch (error) {
      this.statusText.textContent = 'Error';
      this.serverBtn.textContent = 'Retry Start';
      this.serverBtn.disabled = false;
      alert('Failed to start ApexKit server.');
    }
  }

  static async stopServer() {
    this.serverBtn.disabled = true;
    this.serverBtn.textContent = 'Stopping...';
    try {
      await invoke('stop_apex_sidecar');
      this.setServerStoppedState();
    } catch (err) {
      console.error('Failed to stop server:', err);
      this.serverBtn.disabled = false;
    }
  }

  static setServerRunningState() {
    this.isRunning = true;
    this.statusText.textContent = 'Running';
    this.statusDot.classList.add('running');
    this.serverBtn.textContent = 'Stop Server';
    this.serverBtn.style.backgroundColor = '#dc2626';
    this.serverBtn.disabled = false;
  }

  static setServerStoppedState() {
    this.isRunning = false;
    this.statusText.textContent = 'Stopped';
    this.statusDot.classList.remove('running');
    this.serverBtn.textContent = 'Start Server';
    this.serverBtn.style.backgroundColor = '';
    this.serverBtn.disabled = false;
    this.frameApp.src = 'about:blank';
    if (this.frameDash) this.frameDash.src = 'about:blank';
    this.loaderApp.style.display = 'flex';
    if (this.loaderDash) this.loaderDash.style.display = 'flex';
  }

  static async waitForServer(retries = 30): Promise<boolean> {
    const base = this.getBaseUrl();
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(`${base}/`, { method: 'HEAD' });
        if (response.ok || response.status === 401 || response.status === 403) return true;
      } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  static handleContentDisplay(viewName: 'app' | 'dash') {
    if (!this.isRunning) return;
    const useNewWindow = this.windowModeToggle?.checked || false;
    const base = this.getBaseUrl();

    if (viewName === 'app') {
      if (useNewWindow) {
        invoke('open_separate_window', {
          label: 'apex-app-window',
          title: 'Apex App',
          url: `${base}/`,
        });
        this.frameApp.style.display = 'none';
        this.loaderApp.style.display = 'flex';
        this.loaderApp.innerHTML = `<h3>External Window Active</h3>`;
      } else {
        this.loaderApp.style.display = 'none';
        this.frameApp.style.display = 'block';
        if (this.frameApp.src === 'about:blank' || !this.frameApp.src) {
          this.frameApp.src = `${base}/`;
        }
      }
    } else {
      const dashUrl = `${base}${this.getDashboardPath()}`;
      if (useNewWindow) {
        invoke('open_separate_window', {
          label: 'apex-dash-window',
          title: 'Apex Dashboard',
          url: dashUrl,
        });
        if (this.frameDash) this.frameDash.style.display = 'none';
        if (this.loaderDash) {
          this.loaderDash.style.display = 'flex';
          this.loaderDash.innerHTML = `<h3>External Window Active</h3>`;
        }
      } else {
        if (this.loaderDash) this.loaderDash.style.display = 'none';
        if (this.frameDash) {
          this.frameDash.style.display = 'block';
          this.frameDash.src = dashUrl;
        }
      }
    }
  }

  static openDashboard(forceNewWindow = false) {
    const base = this.getBaseUrl();
    const dashUrl = `${base}${this.getDashboardPath()}`;
    const inWindow = forceNewWindow || (this.windowModeToggle?.checked ?? false);

    if (inWindow) {
      invoke('open_separate_window', {
        label: 'apex-dash-window',
        title: 'Apex Dashboard',
        url: dashUrl,
      });
    } else {
      const viewApp = document.querySelector('#view-app') as HTMLElement;
      const viewDash = document.querySelector('#view-dash') as HTMLElement;
      const viewSettings = document.querySelector('#view-settings') as HTMLElement;
      const navSettingsBtn = document.querySelector('#nav-settings-btn') as HTMLElement;

      viewApp?.classList.remove('active');
      viewSettings?.classList.remove('active');
      navSettingsBtn?.classList.remove('active');

      viewDash?.classList.add('active');
      this.handleContentDisplay('dash');
    }
  }

  static reloadFrames() {
    const appActive = document.querySelector('#view-app.active');
    const dashActive = document.querySelector('#view-dash.active');
    if (appActive) this.handleContentDisplay('app');
    if (dashActive) this.handleContentDisplay('dash');
  }

  static async fetchBranding() {
    // If the user set a custom name in Settings, preserve it
    const savedCustomName = SettingsStorage.get().customAppName;
    if (savedCustomName && this.appNameEl) {
      this.appNameEl.textContent = savedCustomName;
      return;
    }

    try {
      const base = this.getBaseUrl();
      const res = await fetch(`${base}/app-name`);
      if (res.ok) {
        const d = await res.json();
        if (d.app_name && this.appNameEl) this.appNameEl.textContent = d.app_name;
      }
      const logoUrl = `${base}/logo?t=${Date.now()}`;
      const imgRes = await fetch(logoUrl, { method: 'HEAD' });
      if (imgRes.ok && this.appLogoEl && !SettingsStorage.get().customIcon) {
        this.appLogoEl.src = logoUrl;
      }
    } catch (_) {}
  }

  static getRunningStatus(): boolean {
    return this.isRunning;
  }
}