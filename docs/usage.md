# ApexApp & ApexClient Bridge: Integration Guide

When your web application (hosted locally by ApexKit at `http://localhost:5000`, over local Wi-Fi, or via a public tunnel) runs inside the **ApexApp Desktop** or **ApexClient Mobile** window, it sits inside an `<iframe>`.

Because iframes operate in an isolated security sandbox, cross-origin browser policies block direct access to thermal printers, RJ11 cash drawers, serial COM scales, OS clipboards, and local filesystems. Your application communicates with the host operating system through an asynchronous HTML5 **`window.postMessage`** bridge.

---

## 1. Unified Client Library (`apexapp.ts`)

Save this single TypeScript helper file in your web project (e.g., `src/lib/apexapp.ts` or `src/utils/apexapp.ts`). It wraps all low-level `postMessage` calls into typed `async/await` Promises.

```typescript
// src/lib/apexapp.ts

export interface PrinterState {
  connected: boolean;
  id: string | null;
  name: string | null;
}

export interface PrintResult {
  success: boolean;
  savedPath?: string;
}

export interface ScaleResult {
  success: boolean;
  raw: string;
  weight?: number;
  unit?: string;
  stable: boolean;
}

export interface BatteryInfo {
  has_battery: boolean;
  percentage: number;
  is_charging: boolean;
}

export interface NetworkInfo {
  is_online: boolean;
  local_ip: string;
  gateway_ping_ms?: number;
}

export interface ScanResult {
  value: string;
  source: 'Camera' | 'USB Scanner' | 'Unknown';
}

export class ApexAppBridge {
  /**
   * Check if the app is currently running inside the ApexApp desktop wrapper or ApexClient mobile iframe
   */
  static isInsideApexApp(): boolean {
    return typeof window !== 'undefined' && window.parent !== window;
  }

  // ── 1. HARDWARE PRINTING & CASH DRAWER ─────────────────────────────────────

  /**
   * Query the active printer selected in Settings
   */
  static getActivePrinter(): Promise<PrinterState> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) {
        return resolve({ connected: false, id: null, name: null });
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_printer_state') {
          window.removeEventListener('message', handler);
          resolve({
            connected: !!event.data.printerId,
            id: event.data.printerId || null,
            name: event.data.printerName || null,
          });
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_get_printer' }, '*');

      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ connected: false, id: null, name: null });
      }, 1500);
    });
  }

  /**
   * Print HTML content (receipts, invoices, labels).
   * - Hardware printer: sends ESC/POS or spooled markup directly to the spooler.
   * - PDF / virtual printer: silently saves to Documents/ApexApp_Receipts.
   * - Fallback browser: opens window.print().
   */
  static printHtml(html: string, copies = 1): Promise<PrintResult> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(html);
          win.document.close();
          win.focus();
          win.print();
        }
        return resolve({ success: true });
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_print_response') {
          window.removeEventListener('message', handler);
          if (event.data.success) {
            resolve({ success: true, savedPath: event.data.savedPath });
          } else {
            reject(new Error(event.data.error || 'Print request rejected'));
          }
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_print_request', payload: { html, copies } }, '*');
    });
  }

  /**
   * Print a local file by path (PDF, binary PRN, image)
   */
  static printFile(filePath: string, copies = 1): Promise<PrintResult> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        return reject(new Error('File printing is only supported inside ApexApp desktop'));
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_print_response') {
          window.removeEventListener('message', handler);
          if (event.data.success) {
            resolve({ success: true, savedPath: event.data.savedPath });
          } else {
            reject(new Error(event.data.error || 'File print failed'));
          }
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_print_request', payload: { file_path: filePath, copies } }, '*');
    });
  }

  /**
   * Send a kick pulse to the cash drawer solenoid (connected via RJ11/RJ12 to the receipt printer)
   * @param pin 2 for standard Pin 2 pulse, 5 for Pin 5 pulse
   */
  static openCashDrawer(pin: 2 | 5 = 2): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) return reject(new Error('Host shell required for cash drawer'));

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_cash_drawer_response') {
          window.removeEventListener('message', handler);
          if (event.data.success) resolve(true);
          else reject(new Error(event.data.error || 'Cash drawer kick failed'));
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_open_cash_drawer', payload: { pin: pin === 2 ? 0 : 1 } }, '*');
    });
  }

  /**
   * Read weight from a connected RS-232 / USB digital scale
   */
  static readScale(port = 'COM1', baudRate = 9600): Promise<ScaleResult> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) {
        return resolve({ success: false, raw: 'Scale bridge requires desktop host', stable: false });
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_scale_reading') {
          window.removeEventListener('message', handler);
          resolve(event.data.reading);
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_read_scale', payload: { port, baudRate } }, '*');
    });
  }

  /**
   * Update 2-line customer-facing VFD pole display
   */
  static setPoleDisplay(line1: string, line2: string, port = 'COM2'): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_pole_display', payload: { line1, line2, port } }, '*');
  }

  // ── 2. MULTI-FORMAT FILE EXPORTER ─────────────────────────────────────────

  /**
   * Export ANY file format (.xlsx, .pdf, .csv, .docx, .png, .txt, .json) directly to disk
   * without browser download bars, with optional auto-opening in the default OS app.
   */
  static exportFile(options: {
    fileName: string;
    base64Data: string;
    autoOpen?: boolean;
    customDir?: string;
  }): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) return reject(new Error('Export requires host desktop'));

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_export_response') {
          window.removeEventListener('message', handler);
          if (event.data.success) resolve(event.data.filePath);
          else reject(new Error(event.data.error || 'Export failed'));
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_export_file', payload: options }, '*');
    });
  }

  // ── 3. SCANNER METHODS (CAMERA & USB) ─────────────────────────────────────

  /** Open webcam/mobile camera optical scanner modal */
  static requestCameraScan(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) return reject(new Error('Camera scanning requires ApexApp'));

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_scan_result') {
          window.removeEventListener('message', handler);
          resolve(event.data.value);
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_camera_scan_request' }, '*');
    });
  }

  /** Arm listener for handheld USB barcode scanner gun */
  static requestUsbScan(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) return reject(new Error('USB scan requires ApexApp'));

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_scan_result') {
          window.removeEventListener('message', handler);
          resolve(event.data.value);
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_usb_scan_request' }, '*');
    });
  }

  /** Generic scan request (mode: 'camera' | 'usb') */
  static requestScan(mode: 'camera' | 'usb' = 'camera'): Promise<string> {
    return mode === 'camera' ? this.requestCameraScan() : this.requestUsbScan();
  }

  // ── 4. SECURITY & KIOSK CONTROLS ──────────────────────────────────────────

  /**
   * Prompt for supervisor authentication (Windows Hello, Touch ID, Linux Polkit)
   */
  static authenticateSupervisor(reason = 'Authorize Supervisor Override'): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) return resolve(true);

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_biometrics_result') {
          window.removeEventListener('message', handler);
          resolve(event.data.authenticated);
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_authenticate_biometrics', payload: { reason } }, '*');
    });
  }

  /** Lock or unlock borderless pinned kiosk mode */
  static setKiosk(enabled: boolean): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_set_kiosk', payload: { enabled } }, '*');
  }

  /** Toggle fullscreen */
  static setFullscreen(enabled: boolean): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_set_fullscreen', payload: { enabled } }, '*');
  }

  /** Prevent OS screen sleep/dimming during shifts */
  static setWakeLock(enabled: boolean): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_set_wakelock', payload: { enabled } }, '*');
  }

  // ── 5. AUDIO, HAPTICS & NOTIFICATIONS ─────────────────────────────────────

  /** Play low-latency hardware speaker tone */
  static beep(frequency = 1200, durationMs = 150): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_beep', payload: { frequency, durationMs } }, '*');
  }

  /** Trigger mobile haptic motor pattern */
  static haptic(style: 'light' | 'medium' | 'heavy' | 'success' | 'error' = 'light'): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_haptic', payload: { style } }, '*');
  }

  /** Dispatch native OS toast/push notification */
  static notify(title: string, body = ''): void {
    if (!this.isInsideApexApp()) {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
      return;
    }
    window.parent.postMessage({ type: '__apexapp_notify', payload: { title, body } }, '*');
  }

  // ── 6. TELEMETRY & CLIPBOARD ──────────────────────────────────────────────

  /** Read battery level and charging state */
  static getBattery(): Promise<BatteryInfo> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) return resolve({ has_battery: false, percentage: 100, is_charging: true });

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_battery_status') {
          window.removeEventListener('message', handler);
          resolve(event.data.status);
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_get_battery' }, '*');
    });
  }

  /** Query local network IP and gateway ping response time */
  static getNetwork(): Promise<NetworkInfo> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) return resolve({ is_online: navigator.onLine, local_ip: '127.0.0.1' });

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_network_status') {
          window.removeEventListener('message', handler);
          resolve(event.data.network);
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_get_network' }, '*');
    });
  }

  /** Write text to system clipboard (bypassing cross-origin iframe sandbox) */
  static copyToClipboard(text: string): void {
    if (!this.isInsideApexApp()) {
      navigator.clipboard?.writeText(text);
      return;
    }
    window.parent.postMessage({ type: '__apexapp_clipboard_write', payload: { text } }, '*');
  }

  /** Read text from system clipboard */
  static readClipboard(): Promise<string> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) {
        navigator.clipboard?.readText().then(resolve).catch(() => resolve(''));
        return;
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_clipboard_data') {
          window.removeEventListener('message', handler);
          resolve(event.data.text || '');
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_clipboard_read' }, '*');
    });
  }

  // ── 7. EVENT LISTENERS ────────────────────────────────────────────────────

  /** Listen continuously for barcode scan events (Camera or USB gun) */
  static onScan(callback: (scannedValue: string, details?: ScanResult) => void): () => void {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === '__apexapp_scan_result' && event.data.value) {
        callback(event.data.value, {
          value: event.data.value,
          source: event.data.source || 'Unknown',
        });
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }

  /** Listen for printer connect/disconnect events from Settings */
  static onPrinterChange(callback: (state: PrinterState) => void): () => void {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === '__apexapp_printer_connected') {
        callback({ connected: true, id: event.data.printerId, name: event.data.printerName });
      }
      if (event.data?.type === '__apexapp_printer_disconnected') {
        callback({ connected: false, id: null, name: null });
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }
}
```

---

## 2. React Implementation

### Custom Hook (`useApexApp.ts`)
```tsx
// src/hooks/useApexApp.ts
import { useState, useEffect } from 'react';
import { ApexAppBridge, PrinterState, BatteryInfo, NetworkInfo } from '../lib/apexapp';

export function useApexApp() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [printer, setPrinter] = useState<PrinterState>({ connected: false, id: null, name: null });
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);

  useEffect(() => {
    setIsDesktop(ApexAppBridge.isInsideApexApp());

    ApexAppBridge.getActivePrinter().then(setPrinter);
    ApexAppBridge.getBattery().then(setBattery);
    ApexAppBridge.getNetwork().then(setNetwork);

    const unbind = ApexAppBridge.onPrinterChange(setPrinter);
    return () => unbind();
  }, []);

  return {
    isDesktop,
    printer,
    battery,
    network,
    printHtml: ApexAppBridge.printHtml,
    openCashDrawer: ApexAppBridge.openCashDrawer,
    readScale: ApexAppBridge.readScale,
    exportFile: ApexAppBridge.exportFile,
    requestCameraScan: ApexAppBridge.requestCameraScan,
    requestUsbScan: ApexAppBridge.requestUsbScan,
    onScan: ApexAppBridge.onScan,
    authenticateSupervisor: ApexAppBridge.authenticateSupervisor,
    setKiosk: ApexAppBridge.setKiosk,
    setWakeLock: ApexAppBridge.setWakeLock,
    beep: ApexAppBridge.beep,
    haptic: ApexAppBridge.haptic,
    notify: ApexAppBridge.notify,
    copyToClipboard: ApexAppBridge.copyToClipboard,
  };
}
```

### Component Example (`POSComponent.tsx`)
```tsx
// src/components/POSComponent.tsx
import React, { useState, useEffect } from 'react';
import { useApexApp } from '../hooks/useApexApp';

export default function POSComponent() {
  const {
    isDesktop,
    printer,
    battery,
    printHtml,
    openCashDrawer,
    readScale,
    exportFile,
    requestCameraScan,
    onScan,
    authenticateSupervisor,
    beep,
    haptic,
    notify,
  } = useApexApp();

  const [barcode, setBarcode] = useState('');
  const [weight, setWeight] = useState<string>('0.000 kg');
  const [status, setStatus] = useState('');

  // Continuous background barcode listener (handheld USB laser or camera)
  useEffect(() => {
    const unsubscribe = onScan((code, details) => {
      setBarcode(code);
      setStatus(`Scanned via ${details?.source}: ${code}`);
      beep(1400, 100);
      haptic('success');
    });
    return () => unsubscribe();
  }, [onScan, beep, haptic]);

  // Read scale
  const handleReadWeight = async () => {
    setStatus('Polling digital scale...');
    const res = await readScale('COM1', 9600);
    if (res.success && res.weight !== undefined) {
      setWeight(`${res.weight.toFixed(3)} ${res.unit || 'kg'}`);
      setStatus(`Scale: ${res.weight} ${res.unit} (${res.stable ? 'Stable' : 'Unstable'})`);
      haptic('light');
    } else {
      setStatus(`Scale error: ${res.raw}`);
      beep(400, 200);
    }
  };

  // Complete checkout: Print receipt + kick cash drawer
  const handleCheckoutCash = async () => {
    try {
      setStatus('Printing receipt & kicking cash drawer...');
      await printHtml(`
        <div style="font-family: monospace; width: 260px; padding: 10px;">
          <h2 style="text-align: center; margin: 0;">APEX WORKSHOP</h2>
          <p style="text-align: center; font-size: 12px;">Cash Sale #1042</p>
          <hr style="border-top: 1px dashed black;" />
          <div style="display: flex; justify-content: space-between;">
            <span>Weight Item</span>
            <span>$14.50</span>
          </div>
          <hr style="border-top: 1px dashed black;" />
          <div style="display: flex; justify-content: space-between; font-weight: bold;">
            <span>TOTAL:</span>
            <span>$14.50</span>
          </div>
        </div>
      `);

      await openCashDrawer(2);
      haptic('success');
      notify('Sale Complete', 'Order #1042 checked out successfully.');
      setStatus('Transaction finished.');
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
      beep(400, 300);
      haptic('error');
    }
  };

  // Export spreadsheet report directly to Excel
  const handleExportExcel = async () => {
    const dummyExcelBase64 = 'UEsDBBQACAgIAAAA...'; // Raw Base64 string from SheetJS / xlsx
    try {
      const savedPath = await exportFile({
        fileName: 'Daily_Sales.xlsx',
        base64Data: dummyExcelBase64,
        autoOpen: true,
      });
      setStatus(`Spreadsheet saved to: ${savedPath}`);
    } catch (err: any) {
      setStatus(`Export failed: ${err.message}`);
    }
  };

  // Supervisor price override
  const handleManagerDiscount = async () => {
    const authorized = await authenticateSupervisor('Authorize 25% Staff Discount');
    if (authorized) {
      setStatus('Supervisor authorized discount.');
      haptic('success');
    } else {
      setStatus('Supervisor authorization rejected.');
      beep(400, 250);
      haptic('error');
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>POS Terminal</h1>
      <p>Terminal Mode: <b>{isDesktop ? 'Apex Host Active' : 'Standalone Browser'}</b></p>
      <p>Printer: <b>{printer.connected ? printer.name : 'Disconnected'}</b></p>
      {battery?.has_battery && (
        <p>Battery: <b>{battery.percentage}% {battery.is_charging ? '⚡ (Charging)' : ''}</b></p>
      )}

      <div style={{ display: 'flex', gap: 10, margin: '20px 0', flexWrap: 'wrap' }}>
        <button onClick={() => requestCameraScan()}>📷 Camera Scan</button>
        <button onClick={handleReadWeight}>⚖️ Read Scale ({weight})</button>
        <button onClick={handleCheckoutCash} disabled={!printer.connected}>💵 Cash Sale & Kick Drawer</button>
        <button onClick={handleExportExcel}>📊 Export Excel Audit</button>
        <button onClick={handleManagerDiscount} style={{ background: '#fef2f2', color: '#b91c1c' }}>
          🛡️ Manager Override
        </button>
      </div>

      {barcode && <div>Last Code: <code>{barcode}</code></div>}
      {status && <p style={{ color: '#475569', marginTop: 12 }}>{status}</p>}
    </div>
  );
}
```

---

## 3. Vue 3 Implementation

### Composable (`useApexApp.ts`)
```typescript
// src/composables/useApexApp.ts
import { ref, onMounted, onUnmounted } from 'vue';
import { ApexAppBridge, PrinterState, BatteryInfo, NetworkInfo } from '../lib/apexapp';

export function useApexApp() {
  const isDesktop = ref(ApexAppBridge.isInsideApexApp());
  const printer = ref<PrinterState>({ connected: false, id: null, name: null });
  const battery = ref<BatteryInfo | null>(null);
  const network = ref<NetworkInfo | null>(null);

  let unbindPrinter: (() => void) | null = null;

  onMounted(async () => {
    printer.value = await ApexAppBridge.getActivePrinter();
    battery.value = await ApexAppBridge.getBattery();
    network.value = await ApexAppBridge.getNetwork();

    unbindPrinter = ApexAppBridge.onPrinterChange((state) => {
      printer.value = state;
    });
  });

  onUnmounted(() => {
    if (unbindPrinter) unbindPrinter();
  });

  return {
    isDesktop,
    printer,
    battery,
    network,
    printHtml: ApexAppBridge.printHtml,
    openCashDrawer: ApexAppBridge.openCashDrawer,
    readScale: ApexAppBridge.readScale,
    exportFile: ApexAppBridge.exportFile,
    requestCameraScan: ApexAppBridge.requestCameraScan,
    onScan: ApexAppBridge.onScan,
    authenticateSupervisor: ApexAppBridge.authenticateSupervisor,
    setKiosk: ApexAppBridge.setKiosk,
    beep: ApexAppBridge.beep,
    haptic: ApexAppBridge.haptic,
    notify: ApexAppBridge.notify,
  };
}
```

### Component Example (`POSView.vue`)
```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useApexApp } from '../composables/useApexApp';

const { printer, battery, printHtml, openCashDrawer, readScale, onScan, beep, haptic, notify } = useApexApp();

const barcode = ref('');
const status = ref('');
const currentWeight = ref('0.000 kg');
let unbindScan: (() => void) | null = null;

onMounted(() => {
  unbindScan = onScan((code, details) => {
    barcode.value = code;
    status.value = `Scanned via ${details?.source}: ${code}`;
    beep(1200, 100);
    haptic('success');
  });
});

onUnmounted(() => {
  if (unbindScan) unbindScan();
});

async function triggerWeight() {
  const res = await readScale('COM1');
  if (res.success && res.weight !== undefined) {
    currentWeight.value = `${res.weight.toFixed(3)} ${res.unit || 'kg'}`;
  }
}

async function triggerSale() {
  try {
    status.value = 'Completing checkout...';
    await printHtml('<div style="font-family:monospace;width:220px;"><h3>Receipt #1042</h3><p>Total: $20.00</p></div>');
    await openCashDrawer(2);
    notify('Sale Done', 'Receipt printed.');
    status.value = 'Sale finalized.';
  } catch (err: any) {
    status.value = `Error: ${err.message}`;
  }
}
</script>

<template>
  <div class="pos-panel">
    <h2>POS Dashboard (Vue 3)</h2>
    <p>Printer: <strong>{{ printer.connected ? printer.name : 'Disconnected' }}</strong></p>
    <p v-if="battery?.has_battery">Battery: <strong>{{ battery.percentage }}%</strong></p>

    <div class="actions">
      <button @click="triggerWeight">⚖️ Read Scale ({{ currentWeight }})</button>
      <button @click="triggerSale" :disabled="!printer.connected">💵 Pay Cash & Kick Drawer</button>
    </div>

    <p v-if="barcode">Barcode: <code>{{ barcode }}</code></p>
    <p v-if="status" class="status-msg">{{ status }}</p>
  </div>
</template>

<style scoped>
.pos-panel { padding: 20px; font-family: sans-serif; }
.actions { display: flex; gap: 10px; margin: 15px 0; }
button { padding: 10px 16px; cursor: pointer; border-radius: 6px; }
.status-msg { color: #64748b; font-size: 0.9rem; }
</style>
```

---

## 4. Svelte Implementation

### Component Example (`POSView.svelte`)
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ApexAppBridge, type PrinterState, type BatteryInfo } from '../lib/apexapp';

  let printer: PrinterState = { connected: false, id: null, name: null };
  let battery: BatteryInfo | null = null;
  let barcode = '';
  let status = '';
  let unbindScan: () => void;
  let unbindPrinter: () => void;

  onMount(async () => {
    printer = await ApexAppBridge.getActivePrinter();
    battery = await ApexAppBridge.getBattery();

    unbindPrinter = ApexAppBridge.onPrinterChange((state) => {
      printer = state;
    });

    unbindScan = ApexAppBridge.onScan((code, details) => {
      barcode = code;
      status = `Scanned via ${details?.source}: ${code}`;
      ApexAppBridge.beep(1200, 100);
      ApexAppBridge.haptic('success');
    });
  });

  onDestroy(() => {
    if (unbindPrinter) unbindPrinter();
    if (unbindScan) unbindScan();
  });

  async function handleCashCheckout() {
    try {
      status = 'Printing & Opening Drawer...';
      await ApexAppBridge.printHtml(`
        <div style="font-family: monospace; width: 220px;">
          <h3>APEX CAFE</h3>
          <p>Cash Order #1042</p>
          <hr />
          <b>Total: $12.00</b>
        </div>
      `);
      await ApexAppBridge.openCashDrawer(2);
      status = 'Drawer opened and receipt printed!';
    } catch (e: any) {
      status = `Error: ${e.message}`;
    }
  }

  async function handleSupervisorAuth() {
    const ok = await ApexAppBridge.authenticateSupervisor('Authorize Price Override');
    status = ok ? 'Supervisor verified!' : 'Authorization declined.';
  }
</script>

<div class="pos-container">
  <h2>Svelte POS Terminal</h2>
  <p>Printer: <b>{printer.connected ? printer.name : 'Disconnected'}</b></p>
  {#if battery?.has_battery}
    <p>Battery: <b>{battery.percentage}%</b></p>
  {/if}

  <div class="btn-group">
    <button on:click={() => ApexAppBridge.requestCameraScan()}>📷 Scan</button>
    <button on:click={handleCashCheckout} disabled={!printer.connected}>💵 Cash Sale & Drawer</button>
    <button on:click={handleSupervisorAuth}>🛡️ Supervisor Auth</button>
  </div>

  {#if barcode}
    <p>Code: <code>{barcode}</code></p>
  {/if}

  {#if status}
    <p class="status">{status}</p>
  {/if}
</div>

<style>
  .pos-container { padding: 20px; font-family: system-ui, sans-serif; }
  .btn-group { display: flex; gap: 10px; margin: 15px 0; }
  button { padding: 10px 18px; cursor: pointer; border-radius: 6px; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status { color: #64748b; font-size: 0.9rem; }
</style>
```

---

## 5. Vanilla JavaScript Implementation (Plain HTML)

For static HTML pages served directly by ApexKit without modern build steps:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Plain JS POS</title>
</head>
<body style="font-family: sans-serif; padding: 20px;">
  <h2>Store Terminal</h2>
  <p>Printer: <span id="printer-label">Checking...</span></p>

  <button id="btn-scan">📷 Scan Barcode</button>
  <button id="btn-print">🖨️ Print & Kick Drawer</button>
  <button id="btn-scale">⚖️ Read Scale</button>
  <button id="btn-kiosk">🖥️ Toggle Kiosk Mode</button>

  <p id="output" style="margin-top: 20px; color: #334155; font-family: monospace;"></p>

  <script>
    const outputEl = document.getElementById('output');
    const printerLabel = document.getElementById('printer-label');
    const btnPrint = document.getElementById('btn-print');
    const btnScan = document.getElementById('btn-scan');
    const btnScale = document.getElementById('btn-scale');
    const btnKiosk = document.getElementById('btn-kiosk');
    let isKiosk = false;

    // 1. Query active printer
    window.parent.postMessage({ type: '__apexapp_get_printer' }, '*');

    // 2. Bridge event router
    window.addEventListener('message', (event) => {
      const { type, value, error, printerName, reading } = event.data || {};

      if (type === '__apexapp_printer_state' || type === '__apexapp_printer_connected') {
        printerLabel.textContent = printerName || 'No printer selected';
        btnPrint.disabled = !printerName;
      }

      if (type === '__apexapp_scan_result') {
        outputEl.textContent = `Scanned Barcode: ${value}`;
        window.parent.postMessage({ type: '__apexapp_beep', payload: { frequency: 1200, durationMs: 100 } }, '*');
      }

      if (type === '__apexapp_scale_reading') {
        outputEl.textContent = reading?.success ? `Scale Weight: ${reading.weight} ${reading.unit}` : `Scale error: ${reading?.raw}`;
      }

      if (type === '__apexapp_cash_drawer_response') {
        outputEl.textContent = event.data.success ? 'Cash drawer solenoid fired!' : `Drawer failed: ${error}`;
      }
    });

    // 3. User actions
    btnScan.addEventListener('click', () => {
      window.parent.postMessage({ type: '__apexapp_camera_scan_request' }, '*');
    });

    btnScale.addEventListener('click', () => {
      window.parent.postMessage({ type: '__apexapp_read_scale', payload: { port: 'COM1', baudRate: 9600 } }, '*');
    });

    btnPrint.addEventListener('click', () => {
      // Print HTML ticket
      window.parent.postMessage({
        type: '__apexapp_print_request',
        payload: { html: '<div style="font-family:monospace;width:220px;"><h3>Receipt</h3><p>Item - $5.00</p></div>', copies: 1 }
      }, '*');

      // Kick cash drawer on Pin 2
      window.parent.postMessage({ type: '__apexapp_open_cash_drawer', payload: { pin: 0 } }, '*');
    });

    btnKiosk.addEventListener('click', () => {
      isKiosk = !isKiosk;
      window.parent.postMessage({ type: '__apexapp_set_kiosk', payload: { enabled: isKiosk } }, '*');
    });
  </script>
</body>
</html>
```

---

## 6. Complete Protocol Reference Table

| Direction | Message Type | Payload Structure | Description |
| :--- | :--- | :--- | :--- |
| **Iframe ➔ Host** | `__apexapp_get_printer` | *None* | Queries active printer name & ID from Settings. |
| **Host ➔ Iframe** | `__apexapp_printer_state` | `{ printerId, printerName }` | Responds with active printer configuration. |
| **Host ➔ Iframe** | `__apexapp_printer_connected` | `{ printerId, printerName }` | Broadcasted when a printer is connected in Settings. |
| **Host ➔ Iframe** | `__apexapp_printer_disconnected` | *None* | Broadcasted when a printer is disconnected in Settings. |
| **Iframe ➔ Host** | `__apexapp_print_request` | `{ payload: { html: string, copies?: number } }` | Sends raw HTML / ESC/POS content to printer spooler. |
| **Iframe ➔ Host** | `__apexapp_print_request` | `{ payload: { file_path: string, copies?: number } }` | Prints an existing local file directly by path. |
| **Host ➔ Iframe** | `__apexapp_print_response` | `{ success: boolean, savedPath?: string, error?: string }` | Confirms print completion or returns virtual receipt file path. |
| **Iframe ➔ Host** | `__apexapp_open_cash_drawer` | `{ payload: { pin: 0 \| 1 } }` | Fires RJ11/RJ12 drawer kick solenoid pulse (0 = Pin 2, 1 = Pin 5). |
| **Host ➔ Iframe** | `__apexapp_cash_drawer_response`| `{ success: boolean, error?: string }` | Returns whether the cash drawer kick was sent. |
| **Iframe ➔ Host** | `__apexapp_read_scale` | `{ payload: { port: string, baudRate?: number } }` | Reads weight string from RS-232 / USB digital scale. |
| **Host ➔ Iframe** | `__apexapp_scale_reading` | `{ reading: ScaleResult }` | Returns parsed weight, stability indicator, and unit. |
| **Iframe ➔ Host** | `__apexapp_pole_display` | `{ payload: { line1: string, line2: string, port?: string } }` | Clears and updates customer-facing 2-line VFD pole display. |
| **Iframe ➔ Host** | `__apexapp_export_file` | `{ payload: { fileName, base64Data, autoOpen?, customDir? } }` | Saves any file format (.pdf, .xlsx, .csv, .png) and optionally opens it. |
| **Host ➔ Iframe** | `__apexapp_export_response` | `{ success: boolean, filePath?: string, error?: string }` | Returns the absolute file path where the document was exported. |
| **Iframe ➔ Host** | `__apexapp_camera_scan_request` | *None* | Opens camera scanner overlay for barcode/QR detection. |
| **Iframe ➔ Host** | `__apexapp_usb_scan_request` | *None* | Arms keyboard buffer interceptor for handheld USB scanners. |
| **Host ➔ Iframe** | `__apexapp_scan_result` | `{ value: string, source: 'Camera' \| 'USB Scanner' }` | Emitted the instant a barcode or QR code is detected. |
| **Iframe ➔ Host** | `__apexapp_authenticate_biometrics`| `{ payload: { reason: string } }` | Prompts for Windows Hello, Touch ID, or OS supervisor password. |
| **Host ➔ Iframe** | `__apexapp_biometrics_result` | `{ authenticated: boolean, error?: string }` | Returns whether supervisor authentication succeeded. |
| **Iframe ➔ Host** | `__apexapp_set_kiosk` | `{ payload: { enabled: boolean } }` | Locks or unlocks borderless, unresizable, always-on-top kiosk mode. |
| **Iframe ➔ Host** | `__apexapp_set_fullscreen` | `{ payload: { enabled: boolean } }` | Enters or exits fullscreen mode. |
| **Iframe ➔ Host** | `__apexapp_set_wakelock` | `{ payload: { enabled: boolean } }` | Prevents operating system screen from sleeping or dimming. |
| **Iframe ➔ Host** | `__apexapp_beep` | `{ payload: { frequency?: number, durationMs?: number } }` | Plays immediate low-latency hardware speaker tone. |
| **Iframe ➔ Host** | `__apexapp_haptic` | `{ payload: { style: 'light' \| 'medium' \| 'heavy' \| 'success' \| 'error' } }` | Triggers mobile device tactile vibration motor. |
| **Iframe ➔ Host** | `__apexapp_get_battery` | *None* | Queries device battery level and AC charging status. |
| **Host ➔ Iframe** | `__apexapp_battery_status` | `{ status: BatteryInfo }` | Returns battery percentage and charging indicator. |
| **Iframe ➔ Host** | `__apexapp_get_network` | *None* | Requests local IP address and gateway ping round-trip latency. |
| **Host ➔ Iframe** | `__apexapp_network_status` | `{ network: NetworkInfo }` | Returns local IP and ping status. |
| **Iframe ➔ Host** | `__apexapp_clipboard_write` | `{ payload: { text: string } }` | Writes text to host OS clipboard (bypassing cross-origin iframe sandbox). |
| **Iframe ➔ Host** | `__apexapp_clipboard_read` | *None* | Reads text from host OS clipboard. |
| **Host ➔ Iframe** | `__apexapp_clipboard_data` | `{ text: string, error?: string }` | Returns the current system clipboard string. |
| **Iframe ➔ Host** | `__apexapp_notify` | `{ payload: { title: string, body?: string } }` | Emits a native OS desktop or mobile push notification banner. |

---

## 7. Best Practices

### Thermal Receipt Layouts (58mm / 80mm)
1. **Explicit Widths:** 58mm paper corresponds to `width: 200px` to `220px`. 80mm paper corresponds to `width: 280px` to `300px`.
2. **Monospace Fonts:** Use monospace font stacks (`font-family: 'Courier New', Courier, monospace;`) so prices and product columns align cleanly across print engines.
3. **Pure Black & White:** Thermal heads do not support grayscale. Use `#000` text on `#fff` backgrounds, and use CSS dashed borders (`border-top: 1px dashed black;`) rather than `<hr>` elements.

### Universal File Exporting
* Pass Base64 data cleanly (with or without `data:*/*;base64,` prefix). The host decodes the bytes directly.
* Specify `autoOpen: true` for audit spreadsheets or customer receipts so Microsoft Excel or Adobe Acrobat opens the exported file immediately.