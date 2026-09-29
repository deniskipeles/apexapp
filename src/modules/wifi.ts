import { invoke } from '@tauri-apps/api/core';
import QRCode from 'qrcode';
import { SettingsStorage } from './storage';
import { EnvManager } from './env';

export class WifiManager {
  private static isSharing = false;
  private static localIp = '127.0.0.1';

  private static toggleBtn: HTMLButtonElement;
  private static dot: HTMLElement;
  private static statusText: HTMLElement;
  private static urlBox: HTMLElement;
  private static urlText: HTMLElement;
  private static btnCopy: HTMLButtonElement;
  private static btnQr: HTMLButtonElement;
  private static portInput: HTMLInputElement;

  // Shared QR Modal
  private static qrModal = document.querySelector('#qr-modal') as HTMLElement;
  private static qrContainer = document.querySelector('#qr-code-container') as HTMLElement;
  private static qrUrlDisplay = document.querySelector('#qr-url-display') as HTMLElement;

  static async init() {
    this.toggleBtn = document.querySelector('#btn-toggle-wifi') as HTMLButtonElement;
    this.dot = document.querySelector('#wifi-dot') as HTMLElement;
    this.statusText = document.querySelector('#wifi-status-text') as HTMLElement;
    this.urlBox = document.querySelector('#wifi-url-box') as HTMLElement;
    this.urlText = document.querySelector('#wifi-url-text') as HTMLElement;
    this.btnCopy = document.querySelector('#btn-copy-wifi-url') as HTMLButtonElement;
    this.btnQr = document.querySelector('#btn-qr-wifi-url') as HTMLButtonElement;
    this.portInput = document.querySelector('#wifi-port-input') as HTMLInputElement;

    // 1. Query the OS for the local IP
    try {
      this.localIp = await invoke('get_local_ip');
    } catch (_) {
      this.localIp = '127.0.0.1';
    }

    // 2. Restore saved settings
    const settings = SettingsStorage.get();
    if (this.portInput) {
      this.portInput.value = String(settings.wifiCustomPort || 5000);
      this.portInput.addEventListener('change', () => {
        const port = parseInt(this.portInput.value, 10) || 5000;
        SettingsStorage.update({ wifiCustomPort: port });
        if (this.isSharing) this.updateUI(true);
      });
    }

    if (settings.wifiSharingEnabled) {
      this.setSharing(true);
    }

    // 3. Event Listeners
    this.toggleBtn?.addEventListener('click', () => {
      this.setSharing(!this.isSharing);
    });

    this.btnCopy?.addEventListener('click', () => {
      navigator.clipboard.writeText(this.urlText.textContent || '');
      const orig = this.btnCopy.textContent;
      this.btnCopy.textContent = 'Copied!';
      setTimeout(() => (this.btnCopy.textContent = orig), 2000);
    });

    this.btnQr?.addEventListener('click', () => {
      this.showQr(this.urlText.textContent || '');
    });
  }

  static async setSharing(enabled: boolean) {
    this.isSharing = enabled;
    SettingsStorage.update({ wifiSharingEnabled: enabled });

    if (enabled) {
      // Refresh local IP in case Wi-Fi network changed
      try {
        this.localIp = await invoke('get_local_ip');
      } catch (_) {}

      // Write HOST=0.0.0.0 to .env so ApexKit listens on the local network
      await EnvManager.upsert('HOST', '0.0.0.0');
    }

    this.updateUI(enabled);
  }

  private static getFullLocalUrl(): string {
    const port = this.portInput?.value || '5000';
    return `http://${this.localIp}:${port}`;
  }

  private static updateUI(active: boolean) {
    if (!this.toggleBtn) return;

    if (active) {
      const url = this.getFullLocalUrl();
      this.statusText.textContent = `Active on Wi-Fi (${this.localIp})`;
      this.statusText.style.color = '#10b981';
      this.dot.classList.add('running');
      this.toggleBtn.textContent = 'Turn Off Wi-Fi Sharing';
      this.toggleBtn.style.backgroundColor = '#ef4444';
      this.urlText.textContent = url;
      this.urlBox.style.display = 'block';
      if (this.portInput) this.portInput.disabled = true;
    } else {
      this.statusText.textContent = 'Wi-Fi Sharing Disabled';
      this.statusText.style.color = '#64748b';
      this.dot.classList.remove('running');
      this.toggleBtn.textContent = 'Turn On Wi-Fi Sharing';
      this.toggleBtn.style.backgroundColor = '#10b981';
      this.urlBox.style.display = 'none';
      if (this.portInput) this.portInput.disabled = false;
    }
  }

  private static async showQr(url: string) {
    if (!url) return;
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
}