import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import QRCode from 'qrcode';
import { SettingsStorage } from './storage';
import { EnvManager } from './env';

export class TunnelManager {
  // Cloudflare
  private static isCfRunning = false;
  private static isCustomDomain = false;
  private static btnToggleCf: HTMLButtonElement;
  private static cfStatusText: HTMLElement;
  private static cfDot: HTMLElement;
  private static cfUrlBox: HTMLElement;
  private static cfUrlText: HTMLElement;
  private static cfWarningText: HTMLElement;
  private static btnCopyCfUrl: HTMLButtonElement;
  private static cfTokenInput: HTMLInputElement;
  private static btnQrUrl: HTMLButtonElement;

  // Managed FRP
  private static isApexRunning = false;
  private static btnToggleApex: HTMLButtonElement;
  private static apexStatusText: HTMLElement;
  private static apexDot: HTMLElement;
  private static apexUrlBox: HTMLElement;
  private static apexUrlText: HTMLElement;
  private static btnCopyApexUrl: HTMLButtonElement;
  private static apexDomainInput: HTMLInputElement;
  private static apexTokenInput: HTMLInputElement;
  private static apexServerInput: HTMLInputElement;

  // QR Modal
  private static qrModal = document.querySelector('#qr-modal') as HTMLElement;
  private static qrContainer = document.querySelector('#qr-code-container') as HTMLElement;
  private static qrUrlDisplay = document.querySelector('#qr-url-display') as HTMLElement;
  private static btnCloseQr = document.querySelector('#btn-close-qr') as HTMLButtonElement;

  static init() {
    this.btnToggleCf = document.querySelector('#btn-toggle-tunnel') as HTMLButtonElement;
    this.cfStatusText = document.querySelector('#tunnel-status-text') as HTMLElement;
    this.cfDot = document.querySelector('#tunnel-dot') as HTMLElement;
    this.cfUrlBox = document.querySelector('#tunnel-url-box') as HTMLElement;
    this.cfUrlText = document.querySelector('#tunnel-url-text') as HTMLElement;
    this.cfWarningText = document.querySelector('#tunnel-warning-text') as HTMLElement;
    this.btnCopyCfUrl = document.querySelector('#btn-copy-url') as HTMLButtonElement;
    this.cfTokenInput = document.querySelector('#cf-token-input') as HTMLInputElement;
    this.btnQrUrl = document.querySelector('#btn-qr-url') as HTMLButtonElement;

    this.btnToggleApex = document.querySelector('#btn-toggle-apex-tunnel') as HTMLButtonElement;
    this.apexStatusText = document.querySelector('#apex-tunnel-status-text') as HTMLElement;
    this.apexDot = document.querySelector('#apex-tunnel-dot') as HTMLElement;
    this.apexUrlBox = document.querySelector('#apex-tunnel-url-box') as HTMLElement;
    this.apexUrlText = document.querySelector('#apex-tunnel-url-text') as HTMLElement;
    this.btnCopyApexUrl = document.querySelector('#btn-copy-apex-url') as HTMLButtonElement;
    this.apexDomainInput = document.querySelector('#apex-domain-input') as HTMLInputElement;
    this.apexTokenInput = document.querySelector('#apex-token-input') as HTMLInputElement;
    this.apexServerInput = document.querySelector('#apex-server-input') as HTMLInputElement;

    // Load persisted tunnel configurations
    const s = SettingsStorage.get();
    if (this.cfTokenInput && s.cfTunnelToken) this.cfTokenInput.value = s.cfTunnelToken;
    if (this.apexServerInput && s.frpServer) this.apexServerInput.value = s.frpServer;
    if (this.apexDomainInput && s.frpDomain) this.apexDomainInput.value = s.frpDomain;
    if (this.apexTokenInput && s.frpToken) this.apexTokenInput.value = s.frpToken;

    // Cloudflare Events
    this.btnToggleCf?.addEventListener('click', () => this.toggleCf());
    this.btnCopyCfUrl?.addEventListener('click', () => this.copyToClipboard(this.cfUrlText, this.btnCopyCfUrl));
    this.btnQrUrl?.addEventListener('click', () => this.showQr(this.cfUrlText.textContent || ''));

    listen('tunnel-url', (event) => {
      if (!this.isCustomDomain) {
        this.isCfRunning = true;
        this.cfUrlText.textContent = event.payload as string;
        this.updateCfUI(true);
      }
    });

    listen('tunnel-managed-connected', async () => {
      if (this.isCustomDomain) {
        this.isCfRunning = true;
        this.cfUrlText.textContent = 'Custom Domain Active';
        this.updateCfUI(true);
        const token = this.cfTokenInput.value.trim();
        SettingsStorage.update({ cfTunnelToken: token });
        await EnvManager.upsert('CF_TUNNEL_TOKEN', token);
      }
    });

    // Managed FRP Events
    this.btnToggleApex?.addEventListener('click', () => this.toggleApex());
    this.btnCopyApexUrl?.addEventListener('click', () => this.copyToClipboard(this.apexUrlText, this.btnCopyApexUrl));

    listen('apex-tunnel-connected', async (event) => {
      const url = event.payload as string;
      this.isApexRunning = true;
      this.apexUrlText.textContent = url;
      this.updateApexUI(true);

      const server = this.apexServerInput.value.trim();
      const domain = this.apexDomainInput.value.trim();
      const token = this.apexTokenInput.value.trim();

      SettingsStorage.update({ frpServer: server, frpDomain: domain, frpToken: token });
      await EnvManager.upsert('APEX_TUNNEL_SERVER', server);
      await EnvManager.upsert('APEX_TUNNEL_DOMAIN', domain);
      await EnvManager.upsert('APEX_TUNNEL_TOKEN', token);
    });

    listen('apex-tunnel-error', (event) => {
      alert('Tunnel Error: ' + event.payload);
      this.isApexRunning = false;
      invoke('toggle_apex_tunnel', { start: false, domain: null, token: null, serverAddr: null });
      this.updateApexUI(false);
      this.btnToggleCf.disabled = false;
    });

    // QR Modal dismissal
    this.btnCloseQr?.addEventListener('click', () => (this.qrModal.style.display = 'none'));
    this.qrModal?.addEventListener('click', (e) => {
      if (e.target === this.qrModal) this.qrModal.style.display = 'none';
    });
  }

  private static async toggleCf() {
    if (!this.isCfRunning) {
      const tokenValue = this.cfTokenInput.value.trim();
      this.isCustomDomain = tokenValue !== '';
      this.btnToggleCf.disabled = true;
      this.btnToggleCf.textContent = 'Starting Tunnel...';
      this.cfStatusText.textContent = 'Initializing...';
      await invoke('toggle_cf_tunnel', { start: true, token: tokenValue });
    } else {
      this.isCfRunning = false;
      this.isCustomDomain = false;
      await invoke('toggle_cf_tunnel', { start: false, token: null });
      this.updateCfUI(false);
    }
  }

  private static updateCfUI(running: boolean) {
    this.btnToggleCf.disabled = false;
    if (running) {
      this.cfStatusText.textContent = 'Tunnel Online';
      this.cfStatusText.style.color = '#10b981';
      this.cfDot.classList.add('running');
      this.btnToggleCf.textContent = 'Stop Tunnel';
      this.btnToggleCf.style.backgroundColor = '#ef4444';
      this.cfUrlBox.style.display = 'block';
      this.cfTokenInput.disabled = true;
      if (this.isCustomDomain) {
        this.btnCopyCfUrl.style.display = 'none';
        this.btnQrUrl.style.display = 'none';
        this.cfWarningText.textContent = 'Routed through Cloudflare Zero Trust.';
      } else {
        this.btnCopyCfUrl.style.display = 'block';
        this.btnQrUrl.style.display = 'flex';
        this.cfWarningText.textContent = 'Warning: Anyone with this link can access your app.';
      }
    } else {
      this.cfStatusText.textContent = 'Tunnel Offline';
      this.cfStatusText.style.color = '#64748b';
      this.cfDot.classList.remove('running');
      this.btnToggleCf.textContent = 'Start Public Tunnel';
      this.btnToggleCf.style.backgroundColor = '#f97316';
      this.cfUrlBox.style.display = 'none';
      this.cfUrlText.textContent = 'Waiting for connection...';
      this.cfTokenInput.disabled = false;
    }
  }

  private static async toggleApex() {
    if (!this.isApexRunning) {
      const domain = this.apexDomainInput.value.trim();
      const token = this.apexTokenInput.value.trim();
      const serverAddrValue = this.apexServerInput.value.trim() || 'apexkit.io';

      if (!domain || !token) {
        alert('Please enter both Token and Domain.');
        return;
      }
      this.btnToggleApex.disabled = true;
      this.btnToggleApex.textContent = 'Starting Tunnel...';
      this.apexStatusText.textContent = 'Authenticating via WSS...';
      this.btnToggleCf.disabled = true;

      try {
        await invoke('toggle_apex_tunnel', {
          start: true,
          domain,
          token,
          serverAddr: serverAddrValue,
        });
      } catch (err) {
        alert(err);
        this.updateApexUI(false);
      }
    } else {
      this.isApexRunning = false;
      await invoke('toggle_apex_tunnel', {
        start: false,
        domain: null,
        token: null,
        serverAddr: null,
      });
      this.updateApexUI(false);
      this.btnToggleCf.disabled = false;
    }
  }

  private static updateApexUI(running: boolean) {
    this.btnToggleApex.disabled = false;
    if (running) {
      this.apexStatusText.textContent = 'Tunnel Online';
      this.apexStatusText.style.color = '#10b981';
      this.apexDot.classList.add('running');
      this.btnToggleApex.textContent = 'Stop Tunnel';
      this.btnToggleApex.style.backgroundColor = '#ef4444';
      this.apexUrlBox.style.display = 'block';
      this.apexDomainInput.disabled = true;
      this.apexTokenInput.disabled = true;
      this.apexServerInput.disabled = true;
    } else {
      this.apexStatusText.textContent = 'Tunnel Offline';
      this.apexStatusText.style.color = '#64748b';
      this.apexDot.classList.remove('running');
      this.btnToggleApex.textContent = 'Start Managed Tunnel';
      this.btnToggleApex.style.backgroundColor = '#3b82f6';
      this.apexUrlBox.style.display = 'none';
      this.apexUrlText.textContent = 'Waiting for connection...';
      this.apexDomainInput.disabled = false;
      this.apexTokenInput.disabled = false;
      this.apexServerInput.disabled = false;
    }
  }

  private static async showQr(url: string) {
    if (!url || url.includes('Waiting') || url.includes('Custom')) return;
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, url, {
      width: 280,
      margin: 2,
      color: { dark: '#0f172a', light: '#f8fafc' },
    });
    this.qrContainer.innerHTML = '';
    this.qrContainer.appendChild(canvas);
    this.qrUrlDisplay.textContent = url;
    this.qrModal.style.display = 'flex';
  }

  private static copyToClipboard(el: HTMLElement, btn: HTMLButtonElement) {
    navigator.clipboard.writeText(el.textContent || '');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = orig), 2000);
  }
}