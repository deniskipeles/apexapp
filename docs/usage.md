# ApexApp Desktop & Mobile Bridge: Complete Technical Integration Guide

When your web application (hosted by ApexKit at `http://localhost:5000`, on local LAN, or through a Cloudflare/FRP tunnel) runs inside **ApexApp Desktop** or **ApexClient Mobile**, it executes inside a sandboxed `<iframe>`.

Because iframes are restricted by browser security policies from directly accessing operating system drivers and hardware ports (USB, RS-232 COM, raw ESC/POS printers, cash drawers, and filesystems), all hardware calls are routed through an asynchronous, bi-directional HTML5 **`window.postMessage`** bridge.

---

## 1. Unified Client Library (`src/lib/apexapp.ts`)

Save this file directly into your web project (e.g. `src/lib/apexapp.ts` or `src/utils/apexapp.ts`). It contains typed interfaces and JSDoc documentation covering every parameter, method, payload, and return value.

```typescript
// src/lib/apexapp.ts

/**
 * Operating system and hardware capability flags for building device-agnostic UIs.
 */
export interface DeviceCapabilities {
  /** True if direct hardware print spooling (thermal/office) is available */
  hasHardwarePrinter: boolean;
  /** True if an RJ11/RJ12 cash drawer solenoid is connected */
  hasCashDrawer: boolean;
  /** True if RS-232 / USB digital scale polling is available */
  hasSerialScale: boolean;
  /** True if customer-facing 2-line VFD pole display is supported */
  hasPoleDisplay: boolean;
  /** True if optical camera scanning is available (webcam or mobile camera) */
  hasCameraScanner: boolean;
  /** True if physical USB / wireless barcode gun wedge listener is available */
  hasUsbScanner: boolean;
  /** True if tactile haptic vibration motor is present */
  hasHaptics: boolean;
  /** True if biometric or supervisor credential verification is supported */
  hasBiometrics: boolean;
  /** True if device has a battery power source */
  hasBattery: boolean;
  /** True if touchscreen input is detected */
  hasTouch: boolean;
}

/**
 * Comprehensive device environment details returned by the host shell.
 */
export interface DeviceInfo {
  /** Host shell type: 'desktop' (ApexApp) | 'mobile' (ApexClient) | 'browser' (Fallback) */
  client: 'desktop' | 'mobile' | 'browser';
  /** Operating system platform */
  platform: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown';
  /** Form factor categorization */
  formFactor: 'desktop' | 'mobile' | 'tablet' | 'kiosk';
  /** Operating system version */
  osVersion?: string;
  /** CPU Architecture ('x86_64' | 'aarch64' | 'armv7' | etc.) */
  arch?: string;
  /** Hostname or device model */
  deviceModel?: string;
  /** Host shell application version (e.g. '0.1.0') */
  appVersion?: string;
  /** Viewport and display pixel metrics */
  screen: {
    width: number;
    height: number;
    pixelRatio: number;
  };
  /** Hardware capability flags */
  capabilities: DeviceCapabilities;
}

/**
 * Represents the current connection state of the hardware receipt printer.
 */
export interface PrinterState {
  /** True if a printer is actively bound in settings */
  connected: boolean;
  /** System identifier or exact printer spooler name */
  id: string | null;
  /** Human-readable friendly printer name */
  name: string | null;
}

/**
 * Options for printing HTML content (receipts, tickets, invoices).
 */
export interface PrintHtmlOptions {
  /** Number of copies to spool (defaults to 1) */
  copies?: number;
  /** Custom file name if saved to PDF/virtual printer (e.g. "Order_1042.pdf" or "Invoice_99.html") */
  fileName?: string;
  /** Custom filesystem output directory override for virtual printers */
  customDir?: string;
}

/**
 * Options for printing pre-existing files directly from disk.
 */
export interface PrintFileOptions {
  /** Number of copies to print (defaults to 1) */
  copies?: number;
}

/**
 * Standard response object returned after queuing a print job.
 */
export interface PrintResult {
  /** Indicates whether the job successfully reached the spooler or virtual printer */
  success: boolean;
  /** Absolute filesystem path if saved via the silent virtual receipt saver */
  savedPath?: string;
  /** Error message if spooling or saving failed */
  error?: string;
}

/**
 * Configuration options for opening the cash drawer kick solenoid.
 */
export interface CashDrawerOptions {
  /** The RJ11/RJ12 drawer pin to pulse: 2 for standard Pin 2 (default), 5 for Pin 5 */
  pin?: 2 | 5;
  /** Explicit printer ID override if multiple thermal printers are connected */
  printerId?: string;
}

/**
 * Configuration options for reading RS-232 / USB COM digital weighing scales.
 */
export interface ScaleOptions {
  /** System serial COM port identifier (defaults to "COM1" on Windows or "/dev/ttyUSB0" on Linux) */
  port?: string;
  /** Baud rate communication speed (defaults to 9600) */
  baudRate?: number;
}

/**
 * Telemetry and parsed weight reading returned by digital scales.
 */
export interface ScaleResult {
  /** Indicates whether data was successfully read from the COM port */
  success: boolean;
  /** Raw unparsed ASCII string received from the scale */
  raw: string;
  /** Parsed numeric weight value, or undefined if parsing failed */
  weight?: number;
  /** Unit detected from telemetry (e.g. "kg", "lb", "g") */
  unit?: string;
  /** True if the scale indicates reading is settled and stable (not moving) */
  stable: boolean;
}

/**
 * Options for controlling customer-facing VFD 2-line pole displays.
 */
export interface PoleDisplayOptions {
  /** Serial COM port where the customer display is plugged (defaults to "COM2") */
  port?: string;
}

/**
 * Universal multi-format file export payload.
 */
export interface ExportFileOptions {
  /** Target file name with ANY extension (e.g. "Report.xlsx", "Audit.pdf", "Orders.csv", "Data.json") */
  fileName: string;
  /** Base64-encoded raw binary or text data (with or without data: URL prefix) */
  base64Data: string;
  /** Automatically open the file in the default OS viewer (Excel, Acrobat, etc.) after saving */
  autoOpen?: boolean;
  /** Optional custom filesystem directory path override */
  customDir?: string;
}

/**
 * Terminal battery and charging state telemetry.
 */
export interface BatteryInfo {
  /** True if the device runs on a physical battery (laptop, tablet, phone) */
  has_battery: boolean;
  /** Remaining power percentage (0 - 100) */
  percentage: number;
  /** True if currently connected to an external AC power adapter */
  is_charging: boolean;
}

/**
 * Operating system network connection and ping telemetry.
 */
export interface NetworkInfo {
  /** True if the host operating system has an active internet or gateway connection */
  is_online: boolean;
  /** Primary local IP address (e.g. "192.168.1.45" or "127.0.0.1") */
  local_ip: string;
  /** Round-trip TCP ping latency to public DNS in milliseconds */
  gateway_ping_ms?: number;
}

/**
 * Barcode and QR code detection payload.
 */
export interface ScanResult {
  /** The decoded text or numeric barcode string */
  value: string;
  /** Detection hardware source: 'Camera' | 'USB Scanner' | 'Unknown' */
  source: 'Camera' | 'USB Scanner' | 'Unknown';
}

/**
 * Tactile vibration motor styles supported on mobile terminals.
 */
export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'error';

export interface NotificationAction {
  /** Target route within the tenant app (e.g. "/orders/1042", "/broadcasts") */
  route?: string;
  /** Section / Tab name */
  section?: string;
  /** Target entity ID */
  id?: string | number;
  /** Arbitrary metadata */
  meta?: Record<string, any>;
}

export interface NotificationOptions {
  /** Notification headline */
  title: string;
  /** Notification message */
  body?: string;
  /**
   * Identifies which tenant/workspace owns this notification.
   * Can be a Tenant ID (e.g. "org_bakery_01"), a subdomain ("joes-cafe"), or workspace ID.
   */
  tenantId?: string;
  /** Optional icon or avatar URL / Base64 */
  icon?: string;
  /** Deep-link navigation metadata */
  action?: NotificationAction;
  /** Custom notification ID for deduplication */
  id?: string;
}

export interface PollRegistrationOptions {
  /** Relative endpoint or absolute URL returning an array of NotificationOptions (e.g. "/api/notifications/poll") */
  endpoint: string;
  /** Optional headers (such as Authorization Bearer tokens) */
  headers?: Record<string, string>;
}


/**
 * Unified bridge client for communicating with ApexApp Desktop and ApexClient Mobile.
 */
export class ApexAppBridge {
  /**
   * Queries comprehensive device and hardware capabilities from the host shell.
   * Enables responsive, device-agnostic UI adaptations (mobile vs desktop layouts, hardware buttons).
   *
   * @returns Promise resolving to the complete DeviceInfo model.
   *
   * @example
   * ```typescript
   * const device = await ApexAppBridge.getDeviceInfo();
   * if (device.client === 'mobile') {
   *   // Render bottom sheets, touch-friendly rows, and camera scanner
   * } else {
   *   // Render dense desktop tables, cash drawer buttons, and serial scale widgets
   * }
   * ```
   */
  static getDeviceInfo(): Promise<DeviceInfo> {
    return new Promise((resolve) => {
      // Fallback if running outside ApexApp in a standard standalone browser
      if (!this.isInsideApexApp()) {
        const ua = navigator.userAgent.toLowerCase();
        const isMobile = /android|iphone|ipad|ipod/.test(ua);
        const isTablet = /ipad|tablet/.test(ua) || (isMobile && window.innerWidth >= 768);

        return resolve({
          client: 'browser',
          platform: ua.includes('win')
            ? 'windows'
            : ua.includes('mac')
            ? 'macos'
            : ua.includes('linux')
            ? 'linux'
            : ua.includes('android')
            ? 'android'
            : ua.includes('iphone') || ua.includes('ipad')
            ? 'ios'
            : 'unknown',
          formFactor: isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop',
          screen: {
            width: window.innerWidth,
            height: window.innerHeight,
            pixelRatio: window.devicePixelRatio || 1,
          },
          capabilities: {
            hasHardwarePrinter: false,
            hasCashDrawer: false,
            hasSerialScale: false,
            hasPoleDisplay: false,
            hasCameraScanner: true,
            hasUsbScanner: false,
            hasHaptics: 'vibrate' in navigator,
            hasBiometrics: false,
            hasBattery: 'getBattery' in navigator,
            hasTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
          },
        });
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_device_info' && event.data.info) {
          window.removeEventListener('message', handler);
          resolve(event.data.info);
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: '__apexapp_get_device_info' }, '*');

      // 1.5s fallback timeout
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({
          client: 'desktop',
          platform: 'unknown',
          formFactor: 'desktop',
          screen: {
            width: window.innerWidth,
            height: window.innerHeight,
            pixelRatio: window.devicePixelRatio || 1,
          },
          capabilities: {
            hasHardwarePrinter: true,
            hasCashDrawer: true,
            hasSerialScale: true,
            hasPoleDisplay: true,
            hasCameraScanner: true,
            hasUsbScanner: true,
            hasHaptics: false,
            hasBiometrics: true,
            hasBattery: false,
            hasTouch: false,
          },
        });
      }, 1500);
    });
  }
  
  /**
   * Checks if the web app is running inside the ApexApp desktop wrapper or ApexClient mobile iframe.
   * @returns true if running embedded inside an ApexApp shell, false if in a regular standalone browser.
   */
  static isInsideApexApp(): boolean {
    return typeof window !== 'undefined' && window.parent !== window;
  }

  // ── 1. HARDWARE PRINTING & CASH DRAWER ─────────────────────────────────────

  /**
   * Queries the currently bound hardware printer selected in Settings.
   * @returns Promise resolving to the active printer ID and friendly name.
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
   * Spools HTML content directly to the physical thermal receipt printer or silently saves it to disk.
   * - If a hardware thermal printer is bound: writes directly to the OS print spooler.
   * - If a virtual/PDF printer is bound: saves directly to disk using `fileName` and `customDir`.
   * - If running in a standard standalone browser: falls back to opening `window.print()`.
   *
   * @param html Raw HTML markup styled for printing (typically 200px - 280px wide).
   * @param options Printing configuration (copies, custom file name, custom directory).
   * @returns Promise resolving to success status and saved file path if virtually saved.
   *
   * @example
   * ```typescript
   * await ApexAppBridge.printHtml('<h3>Receipt #1042</h3>', {
   *   copies: 1,
   *   fileName: 'Receipt_1042.pdf',
   *   customDir: 'C:\\POS\\Receipts'
   * });
   * ```
   */
  static printHtml(html: string, options?: PrintHtmlOptions): Promise<PrintResult> {
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
      window.parent.postMessage(
        {
          type: '__apexapp_print_request',
          payload: {
            html,
            copies: options?.copies ?? 1,
            file_name: options?.fileName,
            custom_dir: options?.customDir,
          },
        },
        '*'
      );
    });
  }

  /**
   * Spools an existing local file directly to the bound printer by path.
   * @param filePath Absolute system path to a printable file (e.g. PDF, image, binary PRN).
   * @param options Optional copy count.
   */
  static printFile(filePath: string, options?: PrintFileOptions): Promise<PrintResult> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        return reject(new Error('Direct file printing requires ApexApp desktop wrapper'));
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
      window.parent.postMessage(
        {
          type: '__apexapp_print_request',
          payload: {
            file_path: filePath,
            copies: options?.copies ?? 1,
          },
        },
        '*'
      );
    });
  }

  /**
   * Sends an ESC/POS pulse to open the cash drawer kick solenoid via RJ11/RJ12.
   * @param options Pin selection (2 for standard pin 2, 5 for pin 5) and optional printer ID override.
   * @returns Promise resolving to true when the solenoid pulse is dispatched.
   *
   * @example
   * ```typescript
   * await ApexAppBridge.openCashDrawer({ pin: 2 });
   * ```
   */
  static openCashDrawer(options?: CashDrawerOptions): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        return reject(new Error('Cash drawer kick requires ApexApp desktop shell'));
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_cash_drawer_response') {
          window.removeEventListener('message', handler);
          if (event.data.success) resolve(true);
          else reject(new Error(event.data.error || 'Cash drawer kick failed'));
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage(
        {
          type: '__apexapp_open_cash_drawer',
          payload: {
            pin: (options?.pin ?? 2) === 2 ? 0 : 1,
            printerId: options?.printerId,
          },
        },
        '*'
      );
    });
  }

  /**
   * Reads weight telemetry from an RS-232 / USB-to-Serial digital scale.
   * @param options Port identifier (defaults to "COM1") and baud rate (defaults to 9600).
   * @returns Promise resolving to the parsed weight, unit, stability, and raw string.
   *
   * @example
   * ```typescript
   * const scale = await ApexAppBridge.readScale({ port: 'COM1', baudRate: 9600 });
   * if (scale.success && scale.stable) {
   *   console.log(`Weight: ${scale.weight} ${scale.unit}`);
   * }
   * ```
   */
  static readScale(options?: ScaleOptions): Promise<ScaleResult> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) {
        return resolve({
          success: false,
          raw: 'Scale bridge requires desktop host',
          stable: false,
        });
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_scale_reading') {
          window.removeEventListener('message', handler);
          resolve(event.data.reading);
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage(
        {
          type: '__apexapp_read_scale',
          payload: {
            port: options?.port || 'COM1',
            baudRate: options?.baudRate || 9600,
          },
        },
        '*'
      );
    });
  }

  /**
   * Clears screen and writes text lines to a customer-facing 2-line VFD pole display.
   * @param line1 Top row text (typically 20 characters max).
   * @param line2 Bottom row text (typically 20 characters max).
   * @param options Serial port configuration (defaults to "COM2").
   *
   * @example
   * ```typescript
   * ApexAppBridge.setPoleDisplay('TOTAL: $14.50', 'CHANGE: $5.50', { port: 'COM2' });
   * ```
   */
  static setPoleDisplay(line1: string, line2 = '', options?: PoleDisplayOptions): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage(
      {
        type: '__apexapp_pole_display',
        payload: {
          line1,
          line2,
          port: options?.port || 'COM2',
        },
      },
      '*'
    );
  }

  // ── 2. UNIVERSAL MULTI-FORMAT FILE EXPORTER ───────────────────────────────

  /**
   * Silently exports ANY file format (.xlsx, .pdf, .csv, .docx, .png, .txt, .json) directly
   * to disk without browser download prompts, with optional automatic OS application launch.
   *
   * @param options File configuration containing target name, Base64 data, and auto-open preference.
   * @returns Promise resolving to the absolute system path where the file was saved.
   *
   * @example
   * ```typescript
   * const path = await ApexAppBridge.exportFile({
   *   fileName: 'Monthly_Audit.xlsx',
   *   base64Data: 'UEsDBBQACAgIAAAA...', // Raw Base64 string from SheetJS / xlsx
   *   autoOpen: true
   * });
   * console.log(`Excel file saved and opened from: ${path}`);
   * ```
   */
  static exportFile(options: ExportFileOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        return reject(new Error('Silent file export requires ApexApp host shell'));
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_export_response') {
          window.removeEventListener('message', handler);
          if (event.data.success) resolve(event.data.filePath);
          else reject(new Error(event.data.error || 'Export failed'));
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage(
        {
          type: '__apexapp_export_file',
          payload: {
            fileName: options.fileName,
            base64Data: options.base64Data,
            autoOpen: options.autoOpen ?? true,
            customDir: options.customDir,
          },
        },
        '*'
      );
    });
  }

  // ── 3. SCANNER METHODS (CAMERA & USB GUN) ─────────────────────────────────

  /**
   * Explicitly triggers the optical camera scanner modal (webcam on desktop, rear lens on mobile).
   * @returns Promise resolving to the decoded barcode or QR code text.
   */
  static requestCameraScan(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        return reject(new Error('Camera optical scanning requires ApexApp wrapper'));
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
   * Focuses and arms the listener for physical handheld USB / wireless barcode guns.
   * @returns Promise resolving to the scanned string once the trigger is pulled.
   */
  static requestUsbScan(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isInsideApexApp()) {
        return reject(new Error('USB gun scanning requires ApexApp wrapper'));
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
   * Generic scanner request supporting both camera and USB wedge guns.
   * @param mode 'camera' | 'usb' (defaults to 'camera')
   */
  static requestScan(mode: 'camera' | 'usb' = 'camera'): Promise<string> {
    return mode === 'camera' ? this.requestCameraScan() : this.requestUsbScan();
  }

  // ── 4. SECURITY, KIOSK & DISPLAY CONTROLS ─────────────────────────────────

  /**
   * Triggers an operating system biometric or supervisor credential verification prompt.
   * (Windows Hello, macOS Touch ID / Admin Prompt, Linux Polkit / Zenity).
   *
   * @param reason Description displayed on the OS dialog (e.g. "Authorize 20% Staff Discount").
   * @returns Promise resolving to true if supervisor authorized, false if rejected or canceled.
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
      window.parent.postMessage(
        {
          type: '__apexapp_authenticate_biometrics',
          payload: { reason },
        },
        '*'
      );
    });
  }

  /**
   * Locks or unlocks borderless, unresizable, always-on-top Kiosk Mode.
   * @param enabled Set to true to pin window and lock borders; false to restore normal windowing.
   */
  static setKiosk(enabled: boolean): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_set_kiosk', payload: { enabled } }, '*');
  }

  /**
   * Enters or exits native OS fullscreen.
   * @param enabled Set to true for fullscreen, false for windowed.
   */
  static setFullscreen(enabled: boolean): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_set_fullscreen', payload: { enabled } }, '*');
  }

  /**
   * Prevents system display from sleeping or dimming during active shifts.
   * @param enabled Set to true to hold screen awake, false to allow default OS sleep.
   */
  static setWakeLock(enabled: boolean): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_set_wakelock', payload: { enabled } }, '*');
  }

  // ── 5. HARDWARE AUDIO, HAPTICS & NOTIFICATIONS ────────────────────────────

  /**
   * Plays a direct hardware speaker tone with zero browser user-gesture restrictions.
   * @param frequency Tone pitch in Hertz (e.g. 1400 for high scan chime, 400 for error buzz).
   * @param durationMs Length of the tone in milliseconds (defaults to 150ms).
   */
  static beep(frequency = 1200, durationMs = 150): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage(
      {
        type: '__apexapp_beep',
        payload: { frequency, durationMs },
      },
      '*'
    );
  }

  /**
   * Triggers tactile mobile vibration feedback on supported mobile devices (ApexClient).
   * @param style Vibration profile: 'light' | 'medium' | 'heavy' | 'success' | 'error'.
   */
  static haptic(style: HapticStyle = 'light'): void {
    if (!this.isInsideApexApp()) return;
    window.parent.postMessage({ type: '__apexapp_haptic', payload: { style } }, '*');
  }

  /**
   * Displays an operating system desktop or mobile push toast notification.
   * Dispatches a rich notification banner with system chime, vibration, and deep-link payload.
   * @param title Header title of the notification banner.
   * @param body Descriptive text content.
   */
  static notify(options: NotificationOptions): void {
    if (!this.isInsideApexApp()) {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(options.title, { body: options.body });
      }
      return;
    }
    window.parent.postMessage(
      {
        type: '__apexapp_notify',
        payload: options,
      },
      '*'
    );
  }

  /**
   * Registers a 5-second background polling endpoint for this workspace in ApexClient.
   * The shell queries this endpoint even when the iframe is in the background.
   *
   * @example
   * ```typescript
   * ApexAppBridge.registerNotificationPoll({
   *   endpoint: '/api/notifications/poll',
   *   headers: { 'Authorization': 'Bearer <token>' }
   * });
   * ```
   */
  static registerNotificationPoll(options: PollRegistrationOptions): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) return resolve(false);

      const handler = (event: MessageEvent) => {
        if (event.data?.type === '__apexapp_register_notification_poll_response') {
          window.removeEventListener('message', handler);
          resolve(Boolean(event.data.success));
        }
      };

      window.addEventListener('message', handler);
      window.parent.postMessage(
        {
          type: '__apexapp_register_notification_poll',
          payload: options,
        },
        '*'
      );
    });
  }

  /**
   * Subscribes to deep-link notification actions triggered when the operator clicks a notification
   * action inside the ApexClient Notification Center.
   *
   * @example
   * ```typescript
   * const unbind = ApexAppBridge.onNotificationAction((action) => {
   *   if (action.route) {
   *     router.push(action.route); // Navigate React / Vue router
   *   }
   * });
   * ```
   */
  static onNotificationAction(callback: (action: NotificationAction) => void): () => void {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === '__apexapp_notification_action' && event.data.action) {
        callback(event.data.action);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }

  // ── 6. TELEMETRY & CLIPBOARD ──────────────────────────────────────────────

  /**
   * Queries terminal battery level and AC charging status.
   * @returns Promise resolving to battery metrics.
   */
  static getBattery(): Promise<BatteryInfo> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) {
        return resolve({ has_battery: false, percentage: 100, is_charging: true });
      }

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

  /**
   * Queries operating system network metrics, local IP address, and gateway ping latency.
   * @returns Promise resolving to active network telemetry.
   */
  static getNetwork(): Promise<NetworkInfo> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) {
        return resolve({ is_online: navigator.onLine, local_ip: '127.0.0.1' });
      }

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

  /**
   * Writes text to the host system clipboard (bypassing cross-origin iframe security restrictions).
   * @param text String data to place onto the operating system clipboard.
   */
  static copyToClipboard(text: string): void {
    if (!this.isInsideApexApp()) {
      navigator.clipboard?.writeText(text);
      return;
    }
    window.parent.postMessage({ type: '__apexapp_clipboard_write', payload: { text } }, '*');
  }

  /**
   * Reads string data from the host system clipboard.
   * @returns Promise resolving to current clipboard string contents.
   */
  static readClipboard(): Promise<string> {
    return new Promise((resolve) => {
      if (!this.isInsideApexApp()) {
        navigator.clipboard
          ?.readText()
          .then(resolve)
          .catch(() => resolve(''));
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

  // ── 7. REAL-TIME EVENT SUBSCRIPTIONS ──────────────────────────────────────

  /**
   * Listens continuously for background barcode scan events from Camera or USB laser guns.
   * @param callback Function called whenever a barcode is decoded.
   * @returns Unsubscribe clean-up function.
   *
   * @example
   * ```typescript
   * const unbind = ApexAppBridge.onScan((code, details) => {
   *   console.log(`Scanned ${code} from ${details?.source}`);
   * });
   * // When unmounting:
   * unbind();
   * ```
   */
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

  /**
   * Listens for printer connect / disconnect events triggered in desktop Settings.
   * @param callback Function receiving the updated PrinterState.
   * @returns Unsubscribe clean-up function.
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
import {
  ApexAppBridge,
  PrinterState,
  BatteryInfo,
  NetworkInfo,
  PrintHtmlOptions,
  CashDrawerOptions,
  ScaleOptions,
  ExportFileOptions,
} from '../lib/apexapp';

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
    printHtml: (html: string, opts?: PrintHtmlOptions) => ApexAppBridge.printHtml(html, opts),
    openCashDrawer: (opts?: CashDrawerOptions) => ApexAppBridge.openCashDrawer(opts),
    readScale: (opts?: ScaleOptions) => ApexAppBridge.readScale(opts),
    setPoleDisplay: ApexAppBridge.setPoleDisplay,
    exportFile: (opts: ExportFileOptions) => ApexAppBridge.exportFile(opts),
    requestCameraScan: ApexAppBridge.requestCameraScan,
    requestUsbScan: ApexAppBridge.requestUsbScan,
    onScan: ApexAppBridge.onScan,
    authenticateSupervisor: ApexAppBridge.authenticateSupervisor,
    setKiosk: ApexAppBridge.setKiosk,
    setFullscreen: ApexAppBridge.setFullscreen,
    setWakeLock: ApexAppBridge.setWakeLock,
    beep: ApexAppBridge.beep,
    haptic: ApexAppBridge.haptic,
    notify: ApexAppBridge.notify,
    copyToClipboard: ApexAppBridge.copyToClipboard,
    readClipboard: ApexAppBridge.readClipboard,
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
    network,
    printHtml,
    openCashDrawer,
    readScale,
    setPoleDisplay,
    exportFile,
    requestCameraScan,
    onScan,
    authenticateSupervisor,
    beep,
    haptic,
    notify,
  } = useApexApp();

  const [barcode, setBarcode] = useState('');
  const [scaleWeight, setScaleWeight] = useState('0.000 kg');
  const [status, setStatus] = useState('');

  // Continuous background barcode listener
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
  const handleReadScale = async () => {
    setStatus('Polling digital scale...');
    const result = await readScale({ port: 'COM1', baudRate: 9600 });
    if (result.success && result.weight !== undefined) {
      const weightText = `${result.weight.toFixed(3)} ${result.unit || 'kg'}`;
      setScaleWeight(weightText);
      setPoleDisplay('WEIGHT ITEM', weightText);
      setStatus(`Weight: ${weightText} (${result.stable ? 'Stable' : 'Moving'})`);
      haptic('light');
    } else {
      setStatus(`Scale error: ${result.raw}`);
      beep(400, 200);
    }
  };

  // Complete checkout: Print thermal receipt with custom name & fire cash drawer
  const handleCashSale = async () => {
    try {
      setStatus('Printing receipt & kicking cash drawer...');
      setPoleDisplay('TOTAL: $14.50', 'PAID CASH');

      await printHtml(
        `
        <div style="font-family: monospace; width: 260px; padding: 10px;">
          <h2 style="text-align: center; margin: 0;">APEX WORKSHOP</h2>
          <p style="text-align: center; font-size: 12px; margin: 4px 0;">Order #1042</p>
          <hr style="border-top: 1px dashed black;" />
          <div style="display: flex; justify-content: space-between;">
            <span>Weighed Item</span>
            <span>$14.50</span>
          </div>
          <hr style="border-top: 1px dashed black;" />
          <div style="display: flex; justify-content: space-between; font-weight: bold;">
            <span>TOTAL:</span>
            <span>$14.50</span>
          </div>
        </div>
        `,
        {
          copies: 1,
          fileName: 'Order_1042.pdf', // Used if virtual/PDF printer is connected
          customDir: 'C:\\Receipts',   // Optional directory override
        }
      );

      // Kick drawer on Pin 2
      await openCashDrawer({ pin: 2 });

      haptic('success');
      notify('Sale Finished', 'Receipt printed and cash drawer opened.');
      setStatus('Sale completed.');
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
      beep(400, 300);
      haptic('error');
    }
  };

  // Export spreadsheet directly to Microsoft Excel
  const handleExportExcel = async () => {
    try {
      setStatus('Generating Excel report...');
      const dummyExcelBase64 = 'UEsDBBQACAgIAAAA...'; // Base64 string from xlsx library
      const savedPath = await exportFile({
        fileName: 'Daily_Sales_Report.xlsx',
        base64Data: dummyExcelBase64,
        autoOpen: true, // Opens directly in Microsoft Excel without download bar
      });
      setStatus(`Report saved to: ${savedPath}`);
    } catch (err: any) {
      setStatus(`Export error: ${err.message}`);
    }
  };

  // Supervisor price override
  const handleSupervisorOverride = async () => {
    const verified = await authenticateSupervisor('Authorize 25% Staff Discount');
    if (verified) {
      setStatus('Discount authorized by supervisor.');
      haptic('success');
    } else {
      setStatus('Supervisor override rejected.');
      beep(400, 250);
      haptic('error');
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>POS Station</h1>
      <p>Terminal Environment: <b>{isDesktop ? 'ApexApp Desktop Active' : 'Standalone Browser'}</b></p>
      <p>Printer: <b>{printer.connected ? printer.name : 'No printer selected'}</b></p>
      {battery?.has_battery && (
        <p>Battery: <b>{battery.percentage}% {battery.is_charging ? '⚡ (Charging)' : ''}</b></p>
      )}
      {network && (
        <p>Network: <b>{network.local_ip} ({network.gateway_ping_ms ?? 0}ms latency)</b></p>
      )}

      <div style={{ display: 'flex', gap: 10, margin: '20px 0', flexWrap: 'wrap' }}>
        <button onClick={() => requestCameraScan()}>📷 Camera Scan</button>
        <button onClick={handleReadScale}>⚖️ Read Scale ({scaleWeight})</button>
        <button onClick={handleCashSale} disabled={!printer.connected}>💵 Cash Sale & Kick Drawer</button>
        <button onClick={handleExportExcel}>📊 Export Excel Audit</button>
        <button onClick={handleSupervisorOverride} style={{ background: '#fef2f2', color: '#b91c1c' }}>
          🛡️ Supervisor Override
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
import {
  ApexAppBridge,
  PrinterState,
  BatteryInfo,
  NetworkInfo,
  PrintHtmlOptions,
  CashDrawerOptions,
  ScaleOptions,
  ExportFileOptions,
} from '../lib/apexapp';

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
    printHtml: (html: string, opts?: PrintHtmlOptions) => ApexAppBridge.printHtml(html, opts),
    openCashDrawer: (opts?: CashDrawerOptions) => ApexAppBridge.openCashDrawer(opts),
    readScale: (opts?: ScaleOptions) => ApexAppBridge.readScale(opts),
    setPoleDisplay: ApexAppBridge.setPoleDisplay,
    exportFile: (opts: ExportFileOptions) => ApexAppBridge.exportFile(opts),
    requestCameraScan: ApexAppBridge.requestCameraScan,
    onScan: ApexAppBridge.onScan,
    authenticateSupervisor: ApexAppBridge.authenticateSupervisor,
    setKiosk: ApexAppBridge.setKiosk,
    setWakeLock: ApexAppBridge.setWakeLock,
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
const scaleWeight = ref('0.000 kg');
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
  const res = await readScale({ port: 'COM1', baudRate: 9600 });
  if (res.success && res.weight !== undefined) {
    scaleWeight.value = `${res.weight.toFixed(3)} ${res.unit || 'kg'}`;
  }
}

async function triggerCashSale() {
  try {
    status.value = 'Completing checkout...';
    await printHtml(
      '<div style="font-family:monospace;width:220px;"><h3>Receipt #1042</h3><p>Total: $20.00</p></div>',
      { fileName: 'Receipt_1042.pdf' }
    );
    await openCashDrawer({ pin: 2 });
    notify('Sale Done', 'Receipt printed.');
    status.value = 'Sale finalized.';
  } catch (err: any) {
    status.value = `Error: ${err.message}`;
  }
}
</script>

<template>
  <div class="pos-panel">
    <h2>POS Terminal (Vue 3)</h2>
    <p>Printer: <strong>{{ printer.connected ? printer.name : 'Disconnected' }}</strong></p>
    <p v-if="battery?.has_battery">Battery: <strong>{{ battery.percentage }}%</strong></p>

    <div class="actions">
      <button @click="triggerWeight">⚖️ Read Scale ({{ scaleWeight }})</button>
      <button @click="triggerCashSale" :disabled="!printer.connected">💵 Pay Cash & Kick Drawer</button>
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
      await ApexAppBridge.printHtml(
        `
        <div style="font-family: monospace; width: 220px;">
          <h3>APEX CAFE</h3>
          <p>Cash Order #1042</p>
          <hr />
          <b>Total: $12.00</b>
        </div>
        `,
        { fileName: 'Order_1042.pdf' }
      );
      await ApexAppBridge.openCashDrawer({ pin: 2 });
      status = 'Drawer opened and receipt printed!';
    } catch (e: any) {
      status = `Error: ${e.message}`;
    }
  }

  async function handleSupervisorAuth() {
    const verified = await ApexAppBridge.authenticateSupervisor('Authorize Price Override');
    status = verified ? 'Supervisor verified!' : 'Authorization declined.';
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

For static HTML pages served directly by ApexKit without build systems or bundling:

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
  <button id="btn-kiosk">🖥️ Toggle Kiosk</button>

  <p id="output" style="margin-top: 20px; color: #334155; font-family: monospace;"></p>

  <script>
    const outputEl = document.getElementById('output');
    const printerLabel = document.getElementById('printer-label');
    const btnPrint = document.getElementById('btn-print');
    const btnScan = document.getElementById('btn-scan');
    const btnScale = document.getElementById('btn-scale');
    const btnKiosk = document.getElementById('btn-kiosk');
    let isKiosk = false;

    // 1. Query active printer on load
    window.parent.postMessage({ type: '__apexapp_get_printer' }, '*');

    // 2. Handle incoming bridge events
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
        outputEl.textContent = reading?.success
          ? `Weight: ${reading.weight} ${reading.unit} (${reading.stable ? 'Stable' : 'Moving'})`
          : `Scale error: ${reading?.raw}`;
      }

      if (type === '__apexapp_cash_drawer_response') {
        outputEl.textContent = event.data.success ? 'Cash drawer kick pulse fired!' : `Drawer failed: ${error}`;
      }
    });

    // 3. Trigger Camera Scan
    btnScan.addEventListener('click', () => {
      window.parent.postMessage({ type: '__apexapp_camera_scan_request' }, '*');
    });

    // 4. Read Scale
    btnScale.addEventListener('click', () => {
      window.parent.postMessage({ type: '__apexapp_read_scale', payload: { port: 'COM1', baudRate: 9600 } }, '*');
    });

    // 5. Print Receipt with Custom File Name and Kick Cash Drawer
    btnPrint.addEventListener('click', () => {
      // Print HTML ticket
      window.parent.postMessage({
        type: '__apexapp_print_request',
        payload: {
          html: '<div style="font-family:monospace;width:220px;"><h3>Receipt</h3><p>Item - $5.00</p></div>',
          file_name: 'Receipt_1042.pdf', // Used if virtual PDF printer is connected
          custom_dir: 'C:\\Receipts',
          copies: 1
        }
      }, '*');

      // Kick drawer on Pin 2
      window.parent.postMessage({
        type: '__apexapp_open_cash_drawer',
        payload: { pin: 0 } // 0 maps to Pin 2, 1 maps to Pin 5
      }, '*');
    });

    // 6. Toggle Kiosk
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
| **Iframe ➔ Host** | `__apexapp_get_printer` | *None* | Queries active printer bound in Settings. |
| **Host ➔ Iframe** | `__apexapp_printer_state` | `{ printerId, printerName }` | Responds with current printer configuration. |
| **Host ➔ Iframe** | `__apexapp_printer_connected` | `{ printerId, printerName }` | Broadcasted when a printer is bound in Settings. |
| **Host ➔ Iframe** | `__apexapp_printer_disconnected` | *None* | Broadcasted when a printer is unbound in Settings. |
| **Iframe ➔ Host** | `__apexapp_print_request` | `{ payload: { html: string, copies?: number, file_name?: string, custom_dir?: string } }` | Spools HTML or virtual PDF receipt using custom output file names. |
| **Iframe ➔ Host** | `__apexapp_print_request` | `{ payload: { file_path: string, copies?: number } }` | Prints an existing local file directly by path. |
| **Host ➔ Iframe** | `__apexapp_print_response` | `{ success: boolean, savedPath?: string, error?: string }` | Confirms spooling or returns virtual receipt file path. |
| **Iframe ➔ Host** | `__apexapp_open_cash_drawer` | `{ payload: { pin: 0 \| 1, printerId?: string } }` | Fires RJ11/RJ12 drawer kick solenoid pulse (0 = Pin 2, 1 = Pin 5). |
| **Host ➔ Iframe** | `__apexapp_cash_drawer_response`| `{ success: boolean, error?: string }` | Confirms whether solenoid pulse was dispatched. |
| **Iframe ➔ Host** | `__apexapp_read_scale` | `{ payload: { port: string, baudRate?: number } }` | Reads weight data string from RS-232 / USB COM scale. |
| **Host ➔ Iframe** | `__apexapp_scale_reading` | `{ reading: ScaleResult }` | Returns parsed weight, stability indicator, and unit. |
| **Iframe ➔ Host** | `__apexapp_pole_display` | `{ payload: { line1: string, line2: string, port?: string } }` | Clears and writes text to customer-facing 2-line VFD pole display. |
| **Host ➔ Iframe** | `__apexapp_pole_response` | `{ success: boolean, error?: string }` | Confirms VFD pole display write status. |
| **Iframe ➔ Host** | `__apexapp_export_file` | `{ payload: { fileName, base64Data, autoOpen?, customDir? } }` | Saves any file format (.pdf, .xlsx, .csv, .png) and optionally opens it. |
| **Host ➔ Iframe** | `__apexapp_export_response` | `{ success: boolean, filePath?: string, error?: string }` | Returns the absolute file path where the document was saved. |
| **Iframe ➔ Host** | `__apexapp_camera_scan_request` | *None* | Opens camera overlay modal for barcode/QR detection. |
| **Iframe ➔ Host** | `__apexapp_usb_scan_request` | *None* | Arms keyboard buffer interceptor for handheld USB scanners. |
| **Host ➔ Iframe** | `__apexapp_scan_result` | `{ value: string, source: 'Camera' \| 'USB Scanner' }` | Dispatched as soon as a barcode or QR code is detected. |
| **Iframe ➔ Host** | `__apexapp_authenticate_biometrics`| `{ payload: { reason: string } }` | Prompts for Windows Hello, Touch ID, or OS supervisor password. |
| **Host ➔ Iframe** | `__apexapp_biometrics_result` | `{ authenticated: boolean, error?: string }` | Returns whether supervisor authentication succeeded. |
| **Iframe ➔ Host** | `__apexapp_set_kiosk` | `{ payload: { enabled: boolean } }` | Locks or unlocks borderless, unresizable, pinned kiosk mode. |
| **Host ➔ Iframe** | `__apexapp_kiosk_response` | `{ success: boolean, error?: string }` | Confirms kiosk mode status. |
| **Iframe ➔ Host** | `__apexapp_set_fullscreen` | `{ payload: { enabled: boolean } }` | Enters or exits native OS fullscreen. |
| **Iframe ➔ Host** | `__apexapp_set_wakelock` | `{ payload: { enabled: boolean } }` | Prevents operating system screen from sleeping or dimming. |
| **Host ➔ Iframe** | `__apexapp_wakelock_response` | `{ success: boolean, active: boolean, error?: string }` | Confirms screen wake lock state. |
| **Iframe ➔ Host** | `__apexapp_beep` | `{ payload: { frequency?: number, durationMs?: number } }` | Emits immediate low-latency hardware speaker tone. |
| **Iframe ➔ Host** | `__apexapp_haptic` | `{ payload: { style: 'light' \| 'medium' \| 'heavy' \| 'success' \| 'error' } }` | Triggers mobile tactile vibration motor pattern. |
| **Iframe ➔ Host** | `__apexapp_get_battery` | *None* | Queries device battery level and AC charging status. |
| **Host ➔ Iframe** | `__apexapp_battery_status` | `{ status: BatteryInfo }` | Returns battery percentage and charging indicator. |
| **Iframe ➔ Host** | `__apexapp_get_network` | *None* | Requests local IP address and gateway ping round-trip latency. |
| **Host ➔ Iframe** | `__apexapp_network_status` | `{ network: NetworkInfo }` | Returns local IP and ping response time. |
| **Iframe ➔ Host** | `__apexapp_clipboard_write` | `{ payload: { text: string } }` | Writes text to host OS clipboard (bypassing iframe sandbox). |
| **Host ➔ Iframe** | `__apexapp_clipboard_response`| `{ success: boolean, error?: string }` | Confirms clipboard write operation. |
| **Iframe ➔ Host** | `__apexapp_clipboard_read` | *None* | Reads text from host OS clipboard. |
| **Host ➔ Iframe** | `__apexapp_clipboard_data` | `{ text: string, error?: string }` | Returns current system clipboard string. |
| **Iframe ➔ Host** | `__apexapp_notify` | `{ payload: { title: string, body?: string } }` | Emits a native OS desktop or mobile push notification banner. |

---

## 7. Best Practices

### Thermal Receipt Layouts (58mm / 80mm)
1. **Explicit Widths:** Standard 58mm paper corresponds to `width: 200px` to `220px`. Standard 80mm paper corresponds to `width: 280px` to `300px`.
2. **Monospace Fonts:** Use system monospace fonts (`font-family: 'Courier New', Courier, monospace;`) so prices and product columns align cleanly across all OS spoolers.
3. **Pure Black & White:** Thermal print heads do not render grayscales well. Use `#000` text on `#fff` backgrounds, and use CSS dashed borders (`border-top: 1px dashed black;`) instead of `<hr>` gradients.

### Universal File Exporting
* Pass Base64 data cleanly (with or without `data:*/*;base64,` prefix). The host decodes the bytes directly.
* Specify `autoOpen: true` for audit spreadsheets or customer receipts so Microsoft Excel or Adobe Acrobat opens the exported file immediately.

---

# Designing a Device-Agnostic UI (React Example)

Here is a practical example showing how to build an interface that dynamically adapts between a handheld mobile view and a desktop workstation based on `getDeviceInfo()`:

```tsx
// src/components/DeviceAgnosticPOS.tsx
import React, { useState, useEffect } from 'react';
import { ApexAppBridge, DeviceInfo } from '../lib/apexapp';

export default function DeviceAgnosticPOS() {
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  useEffect(() => {
    ApexAppBridge.getDeviceInfo().then((info) => {
      setDevice(info);
      console.log('Detected Device Environment:', info);
    });
  }, []);

  if (!device) {
    return <div style={{ padding: 20 }}>Detecting device capabilities...</div>;
  }

  // ── 1. MOBILE SMARTPHONE LAYOUT ───────────────────────────────────────────
  if (device.formFactor === 'mobile') {
    return (
      <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>📱 Mobile Register</h2>
          <span style={{ fontSize: '0.75rem', background: '#e0e7ff', padding: '4px 8px', borderRadius: 12 }}>
            {device.platform.toUpperCase()}
          </span>
        </header>

        {/* Mobile-centric card deck */}
        <div style={{ margin: '20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            onClick={() => ApexAppBridge.requestCameraScan()}
            style={{ padding: 16, fontSize: '1rem', background: '#2563eb', color: 'white', borderRadius: 12, border: 'none' }}
          >
            📷 Tap to Scan Barcode
          </button>

          <button
            onClick={() => {
              ApexAppBridge.haptic('success');
              ApexAppBridge.notify('Order Placed', 'Order #104 sent to kitchen');
            }}
            style={{ padding: 16, fontSize: '1rem', background: '#10b981', color: 'white', borderRadius: 12, border: 'none' }}
          >
            ✓ Complete Mobile Sale
          </button>
        </div>
      </div>
    );
  }

  // ── 2. DESKTOP WORKSTATION / TABLET LAYOUT ────────────────────────────────
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
        <div>
          <h2>🖥️ High-Volume POS Workstation</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.85rem' }}>
            Running on {device.platform.toUpperCase()} ({device.arch}) | Screen: {device.screen.width}×{device.screen.height}
          </p>
        </div>

        {/* Dynamic capability badges */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {device.capabilities.hasHardwarePrinter && <span style={badgeStyle}>🖨️ Thermal Printer</span>}
          {device.capabilities.hasCashDrawer && <span style={badgeStyle}>💵 Cash Drawer</span>}
          {device.capabilities.hasSerialScale && <span style={badgeStyle}>⚖️ Scale Ready</span>}
        </div>
      </header>

      {/* Two-column layout for desktop monitors */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginTop: 20 }}>
        <div>
          <h3>Checkout Items</h3>
          <p>Scan items using your handheld USB laser gun (background listening active).</p>
        </div>

        <div style={{ background: '#f8fafc', padding: 16, borderRadius: 12, border: '1px solid #e2e8f0' }}>
          <h3>Total: $42.50</h3>

          {/* Render POS hardware actions ONLY if device supports them */}
          {device.capabilities.hasCashDrawer && (
            <button
              onClick={() => ApexAppBridge.openCashDrawer({ pin: 2 })}
              style={{ width: '100%', padding: 12, background: '#0f172a', color: 'white', borderRadius: 8, marginBottom: 8 }}
            >
              Open Cash Drawer
            </button>
          )}

          {device.capabilities.hasSerialScale && (
            <button
              onClick={async () => {
                const scale = await ApexAppBridge.readScale({ port: 'COM1' });
                alert(`Scale: ${scale.weight} ${scale.unit}`);
              }}
              style={{ width: '100%', padding: 12, background: '#2563eb', color: 'white', borderRadius: 8 }}
            >
              Poll Digital Scale
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const badgeStyle: React.CSSProperties = {
  background: '#f1f5f9',
  color: '#334155',
  fontSize: '0.75rem',
  padding: '4px 10px',
  borderRadius: 6,
  fontWeight: 600,
};
```
