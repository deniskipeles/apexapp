# ApexApp Desktop Bridge: Integration Guide

When your web application (hosted by ApexKit at `http://localhost:5000` or a public tunnel) runs inside the ApexApp desktop window, it sits inside an `<iframe>`. 

Because iframes operate in an isolated security sandbox, your app communicates with the host desktop hardware (thermal/office printers, USB barcode scanners, system dialogs) via the standard HTML5 **`window.postMessage`** bridge.

---

## 1. Unified Client Library (`apexapp.ts`)

To keep your code clean across all frameworks, save this single TypeScript/JavaScript helper file into your web project (e.g. `src/lib/apexapp.ts` or `src/utils/apexapp.ts`). It wraps raw `postMessage` calls into clean, typed `async/await` Promises.

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

export interface ScanResult {
  value: string;
  source: 'Camera' | 'USB Scanner' | 'Unknown';
}

export class ApexAppBridge {
  /**
   * Check if the app is currently running inside the ApexApp desktop wrapper iframe
   */
  static isInsideApexApp(): boolean {
    return typeof window !== 'undefined' && window.parent !== window;
  }

  /**
   * Query the active printer selected in ApexApp Settings
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

      // Fallback timeout in case running in a standard standalone browser
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ connected: false, id: null, name: null });
      }, 1500);
    });
  }

  /**
   * Print HTML content (receipts, invoices, labels).
   * - If a hardware printer is connected: sends directly to the spooler.
   * - If a PDF / virtual printer is connected: silently saves to Documents/ApexApp_Receipts.
   * - If running in a browser: opens standard browser print window.
   */
  static printHtml(html: string, copies: number = 1): Promise<PrintResult> {
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
            resolve({
              success: true,
              savedPath: event.data.savedPath,
            });
          } else {
            reject(new Error(event.data.error || 'Print request rejected'));
          }
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage(
        {
          type: '__apexapp_print_request',
          payload: { html, copies },
        },
        '*'
      );
    });
  }

  /**
   * Print a local file (PDF, binary, image) by file path
   */
  static printFile(filePath: string, copies: number = 1): Promise<PrintResult> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        return reject(new Error('File printing is only supported inside ApexApp desktop'));
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_print_response') {
          window.removeEventListener('message', handler);
          if (event.data.success) {
            resolve({
              success: true,
              savedPath: event.data.savedPath,
            });
          } else {
            reject(new Error(event.data.error || 'File print failed'));
          }
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage(
        {
          type: '__apexapp_print_request',
          payload: { file_path: filePath, copies },
        },
        '*'
      );
    });
  }

  // ── SCANNER METHODS (CAMERA & USB SEPARATED) ────────────────────────────────

  /**
   * Explicitly open the Laptop Webcam scanner modal
   */
  static requestCameraScan(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        return reject(new Error('Camera scanning requires ApexApp desktop wrapper'));
      }

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

  /**
   * Explicitly arm the listener for a Handheld USB / Wireless barcode gun
   */
  static requestUsbScan(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        return reject(new Error('USB gun scanning requires ApexApp desktop wrapper'));
      }

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

  /**
   * Generic scan request (supports mode: 'camera' | 'usb').
   * Retained for full backwards compatibility with existing components.
   */
  static requestScan(mode: 'camera' | 'usb' = 'camera'): Promise<string> {
    return mode === 'camera' ? this.requestCameraScan() : this.requestUsbScan();
  }

  // ── REAL-TIME EVENT LISTENERS ───────────────────────────────────────────────

  /**
   * Listen continuously for barcode scan events (receives data from either Camera or USB Gun)
   * @param callback function receiving the scanned text and detection source
   * @returns unbind function to unsubscribe
   */
  static onScan(callback: (scannedValue: string, details?: ScanResult) => void): () => void {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === '__apexapp_scan_result' && event.data.value) {
        const details: ScanResult = {
          value: event.data.value,
          source: event.data.source || 'Unknown',
        };
        callback(event.data.value, details);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }

  /**
   * Listen for printer connect / disconnect events triggered from Settings
   * @param callback function receiving updated PrinterState
   * @returns unbind function to unsubscribe
   */
  static onPrinterChange(callback: (state: PrinterState) => void): () => void {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === '__apexapp_printer_connected') {
        callback({
          connected: true,
          id: event.data.printerId,
          name: event.data.printerName,
        });
      }
      if (event.data?.type === '__apexapp_printer_disconnected') {
        callback({
          connected: false,
          id: null,
          name: null,
        });
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
import { ApexAppBridge, PrinterState } from '../lib/apexapp';

export function useApexApp() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [printer, setPrinter] = useState<PrinterState>({ connected: false, id: null, name: null });

  useEffect(() => {
    setIsDesktop(ApexAppBridge.isInsideApexApp());

    ApexAppBridge.getActivePrinter().then(setPrinter);
    const unbind = ApexAppBridge.onPrinterChange(setPrinter);
    return () => unbind();
  }, []);

  return {
    isDesktop,
    printer,
    printHtml: ApexAppBridge.printHtml,
    requestScan: ApexAppBridge.requestScan,
    onScan: ApexAppBridge.onScan,
  };
}
```

### Component Example (`POSComponent.tsx`)
```tsx
// src/components/POSComponent.tsx
import React, { useState, useEffect } from 'react';
import { useApexApp } from '../hooks/useApexApp';

export default function POSComponent() {
  const { isDesktop, printer, printHtml, requestScan, onScan } = useApexApp();
  const [barcode, setBarcode] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  // Listen for background scans (e.g. handheld USB trigger pulled anytime)
  useEffect(() => {
    const unsubscribe = onScan((code) => {
      setBarcode(code);
      setStatus(`Scanned barcode: ${code}`);
    });
    return () => unsubscribe();
  }, [onScan]);

  const handlePrintReceipt = async () => {
    try {
      setStatus('Sending receipt to printer...');
      const receiptHtml = `
        <div style="font-family: monospace; width: 260px; padding: 10px;">
          <h2 style="text-align: center; margin: 0;">APEX CAFE</h2>
          <p style="text-align: center; font-size: 12px; margin: 4px 0;">Order #1042</p>
          <hr style="border-top: 1px dashed black;" />
          <div style="display: flex; justify-content: space-between;">
            <span>1x Espresso</span>
            <span>$3.50</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>1x Croissant</span>
            <span>$4.00</span>
          </div>
          <hr style="border-top: 1px dashed black;" />
          <div style="display: flex; justify-content: space-between; font-weight: bold;">
            <span>TOTAL:</span>
            <span>$7.50</span>
          </div>
          <p style="text-align: center; margin-top: 16px; font-size: 11px;">Thank you for your business!</p>
        </div>
      `;
      await printHtml(receiptHtml);
      setStatus('Print job completed successfully.');
    } catch (err: any) {
      setStatus(`Print error: ${err.message}`);
    }
  };

  const handleManualScan = async () => {
    try {
      setStatus('Waiting for barcode scan...');
      const code = await requestScan();
      setBarcode(code);
      setStatus(`Scanned: ${code}`);
    } catch (err: any) {
      setStatus(`Scan error: ${err.message}`);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>POS Terminal</h1>
      <p>Running in Desktop Shell: <b>{isDesktop ? 'Yes' : 'No'}</b></p>
      <p>Active Printer: <b>{printer.connected ? printer.name : 'No printer connected in settings'}</b></p>

      <div style={{ display: 'flex', gap: 10, margin: '20px 0' }}>
        <button onClick={handleManualScan} style={{ padding: '10px 16px', cursor: 'pointer' }}>
          📷 Scan Barcode
        </button>

        <button 
          onClick={handlePrintReceipt} 
          disabled={!printer.connected}
          style={{ padding: '10px 16px', cursor: printer.connected ? 'pointer' : 'not-allowed' }}
        >
          🖨️ Print Receipt
        </button>
      </div>

      {barcode && <div>Last Scanned Code: <code style={{ fontSize: '1.2rem' }}>{barcode}</code></div>}
      {status && <p style={{ color: '#666', marginTop: 10 }}>{status}</p>}
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
import { ApexAppBridge, PrinterState } from '../lib/apexapp';

export function useApexApp() {
  const isDesktop = ref(ApexAppBridge.isInsideApexApp());
  const printer = ref<PrinterState>({ connected: false, id: null, name: null });

  let unbindPrinter: (() => void) | null = null;

  onMounted(async () => {
    printer.value = await ApexAppBridge.getActivePrinter();
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
    printHtml: ApexAppBridge.printHtml,
    requestScan: ApexAppBridge.requestScan,
    onScan: ApexAppBridge.onScan,
  };
}
```

### Component Example (`POSView.vue`)
```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useApexApp } from '../composables/useApexApp';

const { isDesktop, printer, printHtml, requestScan, onScan } = useApexApp();
const barcode = ref('');
const status = ref('');

let unbindScan: (() => void) | null = null;

onMounted(() => {
  unbindScan = onScan((code) => {
    barcode.value = code;
    status.value = `Scanned barcode: ${code}`;
  });
});

onUnmounted(() => {
  if (unbindScan) unbindScan();
});

async function triggerPrint() {
  try {
    status.value = 'Printing...';
    await printHtml(`
      <div style="font-family: monospace; width: 250px;">
        <h3>Apex Store</h3>
        <p>Item: Test Product</p>
        <p>Price: $19.99</p>
      </div>
    `);
    status.value = 'Print success!';
  } catch (err: any) {
    status.value = `Error: ${err.message}`;
  }
}

async function triggerScan() {
  try {
    status.value = 'Listening for barcode...';
    barcode.value = await requestScan();
    status.value = 'Scan complete.';
  } catch (err: any) {
    status.value = `Error: ${err.message}`;
  }
}
</script>

<template>
  <div class="pos-panel">
    <h2>POS Dashboard (Vue 3)</h2>
    <p>Connected Printer: <strong>{{ printer.connected ? printer.name : 'None' }}</strong></p>

    <div class="actions">
      <button @click="triggerScan">📷 Scan Barcode</button>
      <button @click="triggerPrint" :disabled="!printer.connected">🖨️ Print Ticket</button>
    </div>

    <p v-if="barcode">Scanned: <code>{{ barcode }}</code></p>
    <p v-if="status" class="status-msg">{{ status }}</p>
  </div>
</template>

<style scoped>
.pos-panel { padding: 20px; font-family: sans-serif; }
.actions { display: flex; gap: 10px; margin: 15px 0; }
button { padding: 8px 16px; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.status-msg { color: #64748b; font-size: 0.9rem; }
</style>
```

---

## 4. Svelte Implementation

### Svelte Store / Component (`POSView.svelte`)
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ApexAppBridge, type PrinterState } from '../lib/apexapp';

  let printer: PrinterState = { connected: false, id: null, name: null };
  let barcode = '';
  let status = '';
  let unbindScan: () => void;
  let unbindPrinter: () => void;

  onMount(async () => {
    printer = await ApexAppBridge.getActivePrinter();

    unbindPrinter = ApexAppBridge.onPrinterChange((state) => {
      printer = state;
    });

    unbindScan = ApexAppBridge.onScan((code) => {
      barcode = code;
      status = `Scanned barcode: ${code}`;
    });
  });

  onDestroy(() => {
    if (unbindPrinter) unbindPrinter();
    if (unbindScan) unbindScan();
  });

  async function handlePrint() {
    try {
      status = 'Printing receipt...';
      await ApexAppBridge.printHtml(`
        <div style="font-family: monospace; width: 220px;">
          <h3>RECEIPT</h3>
          <hr />
          <p>Product XYZ - $12.00</p>
          <hr />
        </div>
      `);
      status = 'Receipt printed!';
    } catch (e: any) {
      status = `Print error: ${e.message}`;
    }
  }

  async function handleScan() {
    try {
      status = 'Scan barcode now...';
      barcode = await ApexAppBridge.requestScan();
      status = 'Scanned successfully!';
    } catch (e: any) {
      status = `Scan error: ${e.message}`;
    }
  }
</script>

<div class="pos-container">
  <h2>Svelte POS Terminal</h2>
  <p>Active Printer: <b>{printer.connected ? printer.name : 'Disconnected'}</b></p>

  <div class="btn-group">
    <button on:click={handleScan}>📷 Scan</button>
    <button on:click={handlePrint} disabled={!printer.connected}>🖨️ Print</button>
  </div>

  {#if barcode}
    <p>Last Code: <code>{barcode}</code></p>
  {/if}

  {#if status}
    <p class="status">{status}</p>
  {/if}
</div>

<style>
  .pos-container { padding: 20px; font-family: system-ui, sans-serif; }
  .btn-group { display: flex; gap: 10px; margin: 15px 0; }
  button { padding: 10px 18px; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status { color: #64748b; font-size: 0.85rem; }
</style>
```

---

## 5. Vanilla JavaScript Implementation (Plain HTML/JS)

If your app is built without a frontend framework (e.g. static HTML files served directly by ApexKit):

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
  <button id="btn-print">🖨️ Print Receipt</button>
  
  <p id="output" style="margin-top: 20px; color: #334155;"></p>

  <script>
    const outputEl = document.getElementById('output');
    const printerLabel = document.getElementById('printer-label');
    const btnPrint = document.getElementById('btn-print');
    const btnScan = document.getElementById('btn-scan');

    // 1. Request printer state on load
    window.parent.postMessage({ type: '__apexapp_get_printer' }, '*');

    // 2. Listen for messages from ApexApp shell
    window.addEventListener('message', (event) => {
      const { type, payload, value, error, printerName, printerId } = event.data || {};

      // Handle printer status
      if (type === '__apexapp_printer_state' || type === '__apexapp_printer_connected') {
        printerLabel.textContent = printerName || 'No printer selected';
        btnPrint.disabled = !printerName;
      }
      if (type === '__apexapp_printer_disconnected') {
        printerLabel.textContent = 'Disconnected';
        btnPrint.disabled = true;
      }

      // Handle barcode scan
      if (type === '__apexapp_scan_result') {
        outputEl.innerHTML = `Scanned Barcode: <b>${value}</b>`;
      }

      // Handle print responses
      if (type === '__apexapp_print_response') {
        if (event.data.success) {
          outputEl.textContent = 'Receipt sent to printer!';
        } else {
          outputEl.textContent = `Print failed: ${error}`;
        }
      }
    });

    // 3. Trigger manual scan
    btnScan.addEventListener('click', () => {
      outputEl.textContent = 'Point scanner at barcode...';
      window.parent.postMessage({ type: '__apexapp_scan_request' }, '*');
    });

    // 4. Send print job
    btnPrint.addEventListener('click', () => {
      outputEl.textContent = 'Generating print job...';
      window.parent.postMessage({
        type: '__apexapp_print_request',
        payload: {
          html: '<div style="font-family:monospace;width:250px;"><h3>Receipt</h3><p>Item #1 - $5.00</p></div>',
          copies: 1
        }
      }, '*');
    });
  </script>
</body>
</html>
```

---

## 6. Message Protocol Reference

If you want to construct raw `postMessage` requests manually without the helper wrapper, use this exact contract:

| Direction | Message Type | Payload Structure | Description |
| :--- | :--- | :--- | :--- |
| **Iframe ➔ Desktop** | `__apexapp_get_printer` | *None* | Queries the active printer selected in Settings. |
| **Desktop ➔ Iframe** | `__apexapp_printer_state` | `{ printerId, printerName }` | Responds with the active printer ID and friendly name. |
| **Desktop ➔ Iframe** | `__apexapp_printer_connected` | `{ printerId, printerName }` | Broadcasted whenever the user connects a printer in Settings. |
| **Desktop ➔ Iframe** | `__apexapp_printer_disconnected` | *None* | Broadcasted when a printer is disconnected in Settings. |
| **Iframe ➔ Desktop** | `__apexapp_print_request` | `{ payload: { html: string, copies?: number } }` | Sends raw HTML to print. |
| **Iframe ➔ Desktop** | `__apexapp_print_request` | `{ payload: { file_path: string, copies?: number } }` | Prints a local PDF/image file by system path. |
| **Desktop ➔ Iframe** | `__apexapp_print_response` | `{ success: boolean, error?: string }` | Returns whether the print job was queued into the OS spooler. |
| **Iframe ➔ Desktop** | `__apexapp_scan_request` | *None* | Focuses the desktop scanner buffer and arms the listener. |
| **Desktop ➔ Iframe** | `__apexapp_scan_result` | `{ value: string }` | Dispatched as soon as a barcode/QR code scan completes. |

---

## 7. Best Practices for Thermal Printing (58mm / 80mm)

When designing HTML receipts for thermal receipt printers (Epson, Star Micronics, Munbyn, Xprinter), keep these CSS guidelines in mind:

1. **Explicit Widths:** Standard 58mm paper corresponds to `width: 200px` to `220px`. Standard 80mm paper corresponds to `width: 280px` to `300px`.
2. **Monospace Fonts:** Use system monospace fonts (`font-family: 'Courier New', Courier, monospace;`) so item columns and prices align neatly without complex layout bugs.
3. **Black and White Only:** Thermal heads cannot produce grayscale well. Use `#000` text on `#fff` backgrounds, and use CSS borders (`border-top: 1px dashed black;`) instead of `<hr>` gradients.