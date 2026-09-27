import { AppSettings } from '../types';

const STORAGE_KEY = 'apexapp_persisted_settings_v1';

const defaultSettings: AppSettings = {
  autoStartServer: true,
  openInNewWindow: false,
  dashboardPath: '/_dashboard',
  printSaveDir: '',
  printCustomFileName: '',
  printUseTimestamp: true,
  scannerBeep: true,
  scannerAutoCopy: false,
  preferredScanMode: 'usb',
  savedPrinterId: null,
  savedPrinterName: null,
  cfTunnelToken: '',
  frpServer: 'apexkit.io',
  frpDomain: '',
  frpToken: '',
};

export class SettingsStorage {
  private static cachedSettings: AppSettings | null = null;

  static get(): AppSettings {
    if (this.cachedSettings) return this.cachedSettings;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.cachedSettings = { ...defaultSettings, ...JSON.parse(raw) };
        return this.cachedSettings!;
      }
    } catch (e) {
      console.warn('Failed to parse saved settings, falling back to defaults', e);
    }
    this.cachedSettings = { ...defaultSettings };
    return this.cachedSettings;
  }

  static update(partial: Partial<AppSettings>): AppSettings {
    const current = this.get();
    const updated = { ...current, ...partial };
    this.cachedSettings = updated;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to persist settings', e);
    }
    return updated;
  }
}