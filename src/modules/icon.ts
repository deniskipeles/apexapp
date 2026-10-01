import { invoke } from '@tauri-apps/api/core';
import { SettingsStorage } from './storage';
import { ServerManager } from './server';

export class IconManager {
  private static previewEl: HTMLImageElement;
  private static statusBadge: HTMLElement;
  private static detailsText: HTMLElement;
  private static fileInput: HTMLInputElement;
  private static btnUpload: HTMLButtonElement;
  private static btnSyncServer: HTMLButtonElement;
  private static btnReset: HTMLButtonElement;
  private static appNavLogo: HTMLImageElement;

  // Name Controls
  private static appNameInput: HTMLInputElement;
  private static btnSaveAppName: HTMLButtonElement;
  private static btnSyncServerName: HTMLButtonElement;
  private static btnResetAppName: HTMLButtonElement;
  private static appNavTitle: HTMLElement;

  static init() {
    this.previewEl = document.querySelector('#icon-setting-preview') as HTMLImageElement;
    this.statusBadge = document.querySelector('#icon-status-badge') as HTMLElement;
    this.detailsText = document.querySelector('#icon-details-text') as HTMLElement;
    this.fileInput = document.querySelector('#icon-file-input') as HTMLInputElement;
    this.btnUpload = document.querySelector('#btn-choose-icon-file') as HTMLButtonElement;
    this.btnSyncServer = document.querySelector('#btn-sync-server-logo') as HTMLButtonElement;
    this.btnReset = document.querySelector('#btn-reset-icon') as HTMLButtonElement;
    this.appNavLogo = document.querySelector('#app-logo') as HTMLImageElement;

    this.appNameInput = document.querySelector('#app-name-input') as HTMLInputElement;
    this.btnSaveAppName = document.querySelector('#btn-save-app-name') as HTMLButtonElement;
    this.btnSyncServerName = document.querySelector('#btn-sync-server-name') as HTMLButtonElement;
    this.btnResetAppName = document.querySelector('#btn-reset-app-name') as HTMLButtonElement;
    this.appNavTitle = document.querySelector('#app-name') as HTMLElement;

    const settings = SettingsStorage.get();

    // ── RESTORE SAVED NAME ──────────────────────────────────────────────────
    if (settings.customAppName) {
      if (this.appNameInput) this.appNameInput.value = settings.customAppName;
      if (this.appNavTitle) this.appNavTitle.textContent = settings.customAppName;
    }

    // ── RESTORE SAVED ICON ──────────────────────────────────────────────────
    if (settings.customIcon) {
      this.updatePreviewUI(settings.customIcon, 'Custom Branding Active', '#10b981', 'Loaded custom image');
      if (this.appNavLogo) this.appNavLogo.src = settings.customIcon;
    }

    // ── NAME LISTENERS ──────────────────────────────────────────────────────
    this.btnSaveAppName?.addEventListener('click', () => {
      const name = this.appNameInput.value.trim();
      if (!name) return;
      this.applyCustomName(name);
    });

    this.btnSyncServerName?.addEventListener('click', () => this.syncServerName());
    this.btnResetAppName?.addEventListener('click', () => this.resetName());

    // ── ICON LISTENERS ──────────────────────────────────────────────────────
    this.btnUpload?.addEventListener('click', () => this.fileInput?.click());
    this.fileInput?.addEventListener('change', (e) => this.handleFileSelect(e));
    this.btnSyncServer?.addEventListener('click', () => this.syncServerLogo());
    this.btnReset?.addEventListener('click', () => this.resetToDefault());
  }

  // ── APP NAME CONTROLS ─────────────────────────────────────────────────────

  static async applyCustomName(name: string) {
    try {
      await invoke('update_app_name', { name });
      SettingsStorage.update({ customAppName: name });
      if (this.appNavTitle) this.appNavTitle.textContent = name;
      if (this.appNameInput) this.appNameInput.value = name;

      const orig = this.btnSaveAppName.textContent;
      this.btnSaveAppName.textContent = 'Saved!';
      setTimeout(() => (this.btnSaveAppName.textContent = orig), 2000);
    } catch (err: any) {
      alert(`Failed to save name: ${err.message || err}`);
    }
  }

  static async syncServerName() {
    const orig = this.btnSyncServerName.textContent;
    this.btnSyncServerName.textContent = 'Syncing...';
    try {
      const base = ServerManager.getBaseUrl();
      const res = await fetch(`${base}/app-name`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.app_name) {
        await this.applyCustomName(data.app_name);
      } else {
        throw new Error('No app_name property in response');
      }
    } catch (err: any) {
      alert(`Could not fetch server name: ${err.message || err}`);
    } finally {
      this.btnSyncServerName.textContent = orig;
    }
  }

  static async resetName() {
    try {
      await invoke('reset_app_name');
      SettingsStorage.update({ customAppName: null });
      if (this.appNavTitle) this.appNavTitle.textContent = 'ApexApp';
      if (this.appNameInput) this.appNameInput.value = '';
    } catch (err: any) {
      alert(`Reset name failed: ${err.message || err}`);
    }
  }

  // ── ICON CONTROLS (WITH ON-THE-FLY CANVAS CONVERSION) ────────────────────

  private static async handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const isNativePng = file.type === 'image/png';

    this.setStatus('Processing image...', '#f59e0b');

    try {
      const dataUrl = await this.readFileAsDataUrl(file);
      const converted = await this.ensurePngViaCanvas(dataUrl);

      await this.applyCustomIcon(converted.pngBase64);

      const msg = isNativePng
        ? `Verified PNG (${converted.width}×${converted.height})`
        : `Transformed on fly from ${file.type || 'image'} ➔ PNG (${converted.width}×${converted.height})`;

      this.updatePreviewUI(converted.pngBase64, 'Active Custom Icon', '#10b981', msg);
    } catch (err: any) {
      alert(`Icon error: ${err.message || err}`);
      this.setStatus('Failed to load image', '#ef4444');
    } finally {
      input.value = '';
    }
  }

  static async syncServerLogo() {
    this.setStatus('Fetching /logo from server...', '#3b82f6');
    try {
      const base = ServerManager.getBaseUrl();
      const logoUrl = `${base}/logo?t=${Date.now()}`;

      const headCheck = await fetch(logoUrl, { method: 'HEAD' });
      if (!headCheck.ok) {
        throw new Error(`Server returned HTTP ${headCheck.status} for /logo`);
      }

      const converted = await this.ensurePngViaCanvas(logoUrl);
      await this.applyCustomIcon(converted.pngBase64);

      this.updatePreviewUI(
        converted.pngBase64,
        'Synced with /logo',
        '#10b981',
        `Successfully synced from ${base}/logo and formatted to square PNG`
      );
    } catch (err: any) {
      alert(`Could not sync server logo: ${err.message || err}`);
      this.setStatus('Server logo unavailable', '#ef4444');
    }
  }

  private static ensurePngViaCanvas(
    source: string
  ): Promise<{ pngBase64: string; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const TARGET_SIZE = 256;

          canvas.width = TARGET_SIZE;
          canvas.height = TARGET_SIZE;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Could not get Canvas 2D context');

          ctx.clearRect(0, 0, TARGET_SIZE, TARGET_SIZE);

          const scale = Math.min(TARGET_SIZE / img.width, TARGET_SIZE / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const offsetX = (TARGET_SIZE - drawW) / 2;
          const offsetY = (TARGET_SIZE - drawH) / 2;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

          const pngDataUrl = canvas.toDataURL('image/png');

          resolve({
            pngBase64: pngDataUrl,
            width: img.width,
            height: img.height,
          });
        } catch (e) {
          reject(e);
        }
      };

      img.onerror = () => reject(new Error('Unable to decode image data into Canvas'));
      img.src = source;
    });
  }

  private static async applyCustomIcon(pngBase64: string) {
    await invoke('update_app_icon', { pngBase64 });
    SettingsStorage.update({ customIcon: pngBase64 });
    if (this.appNavLogo) this.appNavLogo.src = pngBase64;
  }

  private static async resetToDefault() {
    try {
      await invoke('reset_app_icon');
      SettingsStorage.update({ customIcon: null });

      const defaultSvg = '/src/assets/apex.svg';
      if (this.appNavLogo) this.appNavLogo.src = defaultSvg;
      this.updatePreviewUI(defaultSvg, 'Default Icon', '#64748b', 'Using bundled system default icon');
    } catch (err: any) {
      alert(`Reset failed: ${err.message || err}`);
    }
  }

  private static readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private static updatePreviewUI(src: string, badgeText: string, badgeColor: string, detail: string) {
    if (this.previewEl) this.previewEl.src = src;
    if (this.statusBadge) {
      this.statusBadge.textContent = badgeText;
      this.statusBadge.style.backgroundColor = `${badgeColor}1a`;
      this.statusBadge.style.color = badgeColor;
    }
    if (this.detailsText) this.detailsText.textContent = detail;
  }

  private static setStatus(text: string, color: string) {
    if (this.statusBadge) {
      this.statusBadge.textContent = text;
      this.statusBadge.style.color = color;
      this.statusBadge.style.backgroundColor = `${color}1a`;
    }
  }
}