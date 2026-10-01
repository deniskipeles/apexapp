import { invoke } from '@tauri-apps/api/core';
import { PrinterInfo } from '../types';
import { SettingsStorage } from './storage';
import { BridgeManager } from './bridge';

function getFormattedTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const min = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

export class PrinterManager {
  private static selectedPrinterId: string | null = null;
  private static selectedPrinterName: string | null = null;
  private static allPrinters: PrinterInfo[] = [];

  private static btnScanPrinters: HTMLButtonElement;
  private static printerList: HTMLElement;
  private static printerStatusText: HTMLElement;
  private static printerScanDot: HTMLElement;
  private static printerSearchInput: HTMLInputElement;
  private static printerConnectedBox: HTMLElement;
  private static printerConnectedName: HTMLElement;
  private static btnDisconnectPrinter: HTMLButtonElement;

  // Save Directory & Filename Customization DOM elements
  private static saveDirInput: HTMLInputElement;
  private static btnBrowseDir: HTMLButtonElement;
  private static btnResetDir: HTMLButtonElement;
  private static fileNameInput: HTMLInputElement;
  private static useTimestampToggle: HTMLInputElement;
  private static fileNamePreview: HTMLElement;

  static init() {
    this.btnScanPrinters = document.querySelector('#btn-scan-printers') as HTMLButtonElement;
    this.printerList = document.querySelector('#printer-list') as HTMLElement;
    this.printerStatusText = document.querySelector('#printer-status-text') as HTMLElement;
    this.printerScanDot = document.querySelector('#printer-scan-dot') as HTMLElement;
    this.printerSearchInput = document.querySelector('#printer-search-input') as HTMLInputElement;
    this.printerConnectedBox = document.querySelector('#printer-connected-box') as HTMLElement;
    this.printerConnectedName = document.querySelector('#printer-connected-name') as HTMLElement;
    this.btnDisconnectPrinter = document.querySelector('#btn-disconnect-printer') as HTMLButtonElement;

    this.saveDirInput = document.querySelector('#printer-savedir-input') as HTMLInputElement;
    this.btnBrowseDir = document.querySelector('#btn-browse-savedir') as HTMLButtonElement;
    this.btnResetDir = document.querySelector('#btn-reset-savedir') as HTMLButtonElement;
    this.fileNameInput = document.querySelector('#printer-filename-input') as HTMLInputElement;
    this.useTimestampToggle = document.querySelector('#printer-timestamp-toggle') as HTMLInputElement;
    this.fileNamePreview = document.querySelector('#printer-filename-preview') as HTMLElement;

    // Restore saved printer
    const saved = SettingsStorage.get();
    if (saved.savedPrinterId && saved.savedPrinterName) {
      this.selectedPrinterId = saved.savedPrinterId;
      this.selectedPrinterName = saved.savedPrinterName;
      this.printerConnectedName.textContent = saved.savedPrinterName;
      this.printerConnectedBox.style.display = 'flex';
    }

    // Restore File/Directory configurations
    if (this.saveDirInput) {
      this.saveDirInput.value = saved.printSaveDir || '';
      this.saveDirInput.addEventListener('change', () => {
        SettingsStorage.update({ printSaveDir: this.saveDirInput.value.trim() });
      });
    }

    if (this.fileNameInput) {
      this.fileNameInput.value = saved.printCustomFileName || '';
      this.fileNameInput.addEventListener('input', () => {
        SettingsStorage.update({ printCustomFileName: this.fileNameInput.value.trim() });
        this.updatePreview();
      });
    }

    if (this.useTimestampToggle) {
      this.useTimestampToggle.checked = saved.printUseTimestamp ?? true;
      this.useTimestampToggle.addEventListener('change', () => {
        SettingsStorage.update({ printUseTimestamp: this.useTimestampToggle.checked });
        this.updatePreview();
      });
    }

    this.btnBrowseDir?.addEventListener('click', () => this.browseFolder());
    this.btnResetDir?.addEventListener('click', () => this.resetFolderToDefault());

    this.btnScanPrinters?.addEventListener('click', () => this.loadPrinters());
    this.btnDisconnectPrinter?.addEventListener('click', () => this.disconnectPrinter());
    this.printerSearchInput?.addEventListener('input', () => this.renderPrinters());

    this.updatePreview();
  }

  static async browseFolder() {
    try {
      const selected: string | null = await invoke('select_directory');
      if (selected) {
        this.saveDirInput.value = selected;
        SettingsStorage.update({ printSaveDir: selected });
      }
    } catch (e) {
      console.warn('Native folder selection fallback triggered:', e);
    }
  }

  static async resetFolderToDefault() {
    try {
      const defDir: string = await invoke('get_default_receipts_dir');
      this.saveDirInput.value = defDir;
      SettingsStorage.update({ printSaveDir: defDir });
    } catch (_) {
      this.saveDirInput.value = '';
      SettingsStorage.update({ printSaveDir: '' });
    }
  }

  static generateFileName(customNameFromPayload?: string): string {
    if (customNameFromPayload && customNameFromPayload.trim()) {
      let name = customNameFromPayload.trim();
      if (!name.endsWith('.html') && !name.endsWith('.pdf')) {
        name += '.html';
      }
      return name;
    }

    const s = SettingsStorage.get();
    const timestamp = getFormattedTimestamp();
    const customBase = (s.printCustomFileName || '').trim();

    if (customBase) {
      const hasExt = customBase.endsWith('.html') || customBase.endsWith('.pdf');
      const baseWithoutExt = hasExt ? customBase.substring(0, customBase.lastIndexOf('.')) : customBase;
      const ext = hasExt ? customBase.substring(customBase.lastIndexOf('.')) : '.html';

      if (s.printUseTimestamp) {
        return `${baseWithoutExt}_${timestamp}${ext}`;
      } else {
        return `${baseWithoutExt}${ext}`;
      }
    }

    return `Receipt_${timestamp}.html`;
  }

  private static updatePreview() {
    if (!this.fileNamePreview) return;
    this.fileNamePreview.textContent = this.generateFileName();
  }

  static async loadPrinters() {
    this.printerScanDot.classList.add('running');
    this.printerStatusText.textContent = 'Scanning...';
    this.printerList.innerHTML = `<div style="color:#64748b;font-style:italic;font-size:0.85rem;">Discovering installed printers...</div>`;

    try {
      // ✅ Directly invoke the Tauri command natively
      const result: PrinterInfo[] = await invoke('get_printers');
      this.allPrinters = result.map((p) => ({
        id: p.id,
        name: p.name,
        isOnline: true,
        is_default: p.is_default,
      }));

      const saved = SettingsStorage.get();
      if (!this.selectedPrinterId && saved.savedPrinterId) {
        const found = this.allPrinters.find((p) => p.id === saved.savedPrinterId);
        if (found) this.connectPrinter(found.id, found.name);
      }

      this.renderPrinters();
      this.printerStatusText.textContent = `${this.allPrinters.length} printer(s) discovered`;
      this.printerSearchInput.style.display = this.allPrinters.length > 0 ? 'block' : 'none';
    } catch (err) {
      this.printerList.innerHTML = `<div style="color:#ef4444;font-size:0.85rem;">Failed: ${err}</div>`;
      this.printerStatusText.textContent = 'Error';
    } finally {
      this.printerScanDot.classList.remove('running');
    }
  }

  private static renderPrinters() {
    const q = this.printerSearchInput.value.toLowerCase().trim();
    const filtered = q ? this.allPrinters.filter((p) => p.name.toLowerCase().includes(q)) : this.allPrinters;

    if (!filtered.length) {
      this.printerList.innerHTML = `<div style="color:#64748b;font-style:italic;font-size:0.85rem;">No matching printers found.</div>`;
      return;
    }

    this.printerList.innerHTML = '';
    filtered.forEach((printer) => {
      const isConnected = this.selectedPrinterId === printer.id;
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid ${
        isConnected ? '#3b82f6' : '#e2e8f0'
      };border-radius:8px;background:${isConnected ? '#eff6ff' : 'white'};transition:all 0.15s;`;

      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.3rem;">🖨️</span>
          <div>
            <div style="font-weight:600;font-size:0.88rem;color:#1e293b;">
              ${printer.name}
              ${printer.is_default ? '<span style="font-size:0.7rem;background:#dbeafe;color:#1d4ed8;padding:2px 6px;border-radius:4px;margin-left:6px;">OS Default</span>' : ''}
            </div>
            <div style="font-size:0.75rem;color:${printer.isOnline !== false ? '#10b981' : '#94a3b8'};">
              ${printer.isOnline !== false ? '● Ready' : '○ Offline'}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn-connect copy-btn" data-id="${printer.id}" data-name="${printer.name}"
            style="background:${isConnected ? '#fee2e2' : '#dbeafe'};color:${isConnected ? '#ef4444' : '#1d4ed8'};font-weight:600;">
            ${isConnected ? 'Disconnect' : 'Connect'}
          </button>
          <button class="btn-delete-printer copy-btn" data-id="${printer.id}" style="background:#fee2e2;color:#ef4444;" title="Remove">✕</button>
        </div>
      `;

      row.querySelector('.btn-connect')?.addEventListener('click', (e) => {
        const btn = e.target as HTMLButtonElement;
        if (this.selectedPrinterId === btn.dataset.id) this.disconnectPrinter();
        else this.connectPrinter(btn.dataset.id!, btn.dataset.name!);
      });

      row.querySelector('.btn-delete-printer')?.addEventListener('click', (e) => {
        const btn = e.target as HTMLButtonElement;
        const id = btn.dataset.id!;
        if (this.selectedPrinterId === id) this.disconnectPrinter();
        this.allPrinters = this.allPrinters.filter((p) => p.id !== id);
        this.renderPrinters();
      });

      this.printerList.appendChild(row);
    });
  }

  static connectPrinter(id: string, name: string) {
    this.selectedPrinterId = id;
    this.selectedPrinterName = name;
    this.printerConnectedName.textContent = name;
    this.printerConnectedBox.style.display = 'flex';

    SettingsStorage.update({ savedPrinterId: id, savedPrinterName: name });
    BridgeManager.broadcast({ type: '__apexapp_printer_connected', printerId: id, printerName: name });
    this.renderPrinters();
  }

  static disconnectPrinter() {
    this.selectedPrinterId = null;
    this.selectedPrinterName = null;
    this.printerConnectedBox.style.display = 'none';

    SettingsStorage.update({ savedPrinterId: null, savedPrinterName: null });
    BridgeManager.broadcast({ type: '__apexapp_printer_disconnected' });
    this.renderPrinters();
  }

  static getActivePrinter() {
    return { id: this.selectedPrinterId, name: this.selectedPrinterName };
  }

  static async printPayload(payload: {
    html: string;
    file_path?: string;
    file_name?: string;
    custom_dir?: string;
  }): Promise<string | undefined> {
    const isPdfVirtual =
      !this.selectedPrinterId ||
      this.selectedPrinterId.toLowerCase().includes('pdf') ||
      this.selectedPrinterName?.toLowerCase().includes('pdf');

    if (isPdfVirtual) {
      const fileName = this.generateFileName(payload.file_name);
      const targetDir = (payload.custom_dir || SettingsStorage.get().printSaveDir || '').trim() || undefined;

      const blob = new Blob([payload.html], { type: 'text/html' });
      const reader = new FileReader();

      return new Promise((resolve, reject) => {
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          try {
            const savedPath: string = await invoke('save_receipt_pdf', {
              payload: {
                file_name: fileName,
                pdf_base64: reader.result as string,
                custom_dir: targetDir,
              },
            });
            resolve(savedPath);
          } catch (e) {
            reject(e);
          }
        };
      });
    }

    if (payload.file_path) {
      await invoke('print_file', {
        printer_id: this.selectedPrinterId,
        file_path: payload.file_path,
        copies: 1,
      });
    } else {
      await invoke('print_to_hardware', {
        printer_id: this.selectedPrinterId,
        raw_content: payload.html,
      });
    }
    return undefined;
  }
}