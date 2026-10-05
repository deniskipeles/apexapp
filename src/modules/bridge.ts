import { invoke } from '@tauri-apps/api/core';
import { PrinterManager } from './printer';
import { ScannerManager } from './scanner';

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

export class BridgeManager {
  private static wakeLockSentinel: any = null;
  private static audioCtx: AudioContext | null = null;

  static init() {
    this.setupNotificationClickListeners();

    window.addEventListener('message', async (event) => {
      const { type, payload } = event.data || {};
      if (!type || !type.startsWith('__apexapp_')) return;

      const respond = (responseType: string, data: object) => {
        event.source?.postMessage({ type: responseType, ...data }, { targetOrigin: '*' });
      };

      // ── DEVICE INFO QUERY (DESKTOP) ───────────────────────────────────────
      if (type === '__apexapp_get_device_info') {
        try {
          const sys: any = await invoke('get_platform_info');
          const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

          respond('__apexapp_device_info', {
            info: {
              client: 'desktop',
              platform: sys.platform || 'windows',
              formFactor: 'desktop',
              osVersion: sys.os_version,
              arch: sys.arch,
              deviceModel: sys.hostname,
              appVersion: sys.app_version,
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
                hasTouch: isTouch,
              },
            },
          });
        } catch (_) {
          respond('__apexapp_device_info', {
            info: {
              client: 'desktop',
              platform: 'windows',
              formFactor: 'desktop',
              screen: { width: window.innerWidth, height: window.innerHeight, pixelRatio: 1 },
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
            },
          });
        }
        return;
      }

      // ── 1. HARDWARE AUDIO & INSTANT CHIME / BUZZ SYNTHESIZER ──────────────
      if (type === '__apexapp_beep') {
        const freq = payload?.frequency || 1200;
        const dur = payload?.durationMs || 150;

        this.playSynthesizedTone(freq, dur);
        invoke('play_system_beep', { frequency: freq, durationMs: dur }).catch(() => {});
        return;
      }

      // ── 2. NATIVE DESKTOP NOTIFICATIONS WITH TARGET TENANT RESOLUTION ─────
      if (type === '__apexapp_notify') {
        const notif: NotificationOptions = {
          title: payload?.title || 'ApexApp Alert',
          body: payload?.body || '',
          tenantId: payload?.tenantId,
          icon: payload?.icon,
          action: payload?.action,
          id: payload?.id,
        };

        this.dispatchDesktopNotification(notif);
        respond('__apexapp_notify_response', { success: true });
        return;
      }

      // ── 3. SCANNER ────────────────────────────────────────────────────────
      if (type === '__apexapp_camera_scan_request') {
        await ScannerManager.startCameraScan();
        return;
      }
      if (type === '__apexapp_usb_scan_request') {
        ScannerManager.startUsbScan();
        return;
      }

      // ── 4. CASH DRAWER & PRINTER ──────────────────────────────────────────
      if (type === '__apexapp_get_printer') {
        const { id, name } = PrinterManager.getActivePrinter();
        respond('__apexapp_printer_state', { printerId: id, printerName: name });
        return;
      }

      if (type === '__apexapp_open_cash_drawer') {
        try {
          const { id } = PrinterManager.getActivePrinter();
          const target = payload?.printerId || id;
          if (!target) throw new Error('No active printer selected');
          await invoke('open_cash_drawer', { printerId: target, pin: payload?.pin ?? 0 });
          respond('__apexapp_cash_drawer_response', { success: true });
        } catch (err: any) {
          respond('__apexapp_cash_drawer_response', { success: false, error: err?.message || err });
        }
        return;
      }

      // ── 5. PRINT REQUEST ──────────────────────────────────────────────────
      if (type === '__apexapp_print_request') {
        try {
          const savedPath = await PrinterManager.printPayload(payload || {});
          respond('__apexapp_print_response', { success: true, savedPath });
        } catch (err: any) {
          respond('__apexapp_print_response', { success: false, error: err?.message || err });
        }
        return;
      }

      // ── 6. MULTI-FORMAT FILE EXPORT ───────────────────────────────────────
      if (type === '__apexapp_export_file') {
        try {
          const filePath: string = await invoke('export_file', { payload });
          respond('__apexapp_export_response', { success: true, filePath });
        } catch (err: any) {
          respond('__apexapp_export_response', { success: false, error: err?.message || err });
        }
        return;
      }

      // ── 7. BIOMETRICS / SUPERVISOR AUTH ───────────────────────────────────
      if (type === '__apexapp_authenticate_biometrics') {
        try {
          const authenticated: boolean = await invoke('authenticate_biometrics', {
            reason: payload?.reason || 'Authorize Action',
          });
          respond('__apexapp_biometrics_result', { authenticated });
        } catch (err: any) {
          respond('__apexapp_biometrics_result', { authenticated: false, error: err?.message || err });
        }
        return;
      }

      // ── 8. KIOSK & FULLSCREEN ─────────────────────────────────────────────
      if (type === '__apexapp_set_kiosk') {
        try {
          await invoke('set_kiosk_mode', { enabled: Boolean(payload?.enabled) });
          respond('__apexapp_kiosk_response', { success: true });
        } catch (err: any) {
          respond('__apexapp_kiosk_response', { success: false, error: err?.message });
        }
        return;
      }

      if (type === '__apexapp_set_fullscreen') {
        try {
          await invoke('set_fullscreen', { enabled: Boolean(payload?.enabled) });
        } catch (_) {}
        return;
      }

      // ── 9. SERIAL SCALE & POLE DISPLAY ────────────────────────────────────
      if (type === '__apexapp_read_scale') {
        try {
          const reading = await invoke('read_serial_scale', {
            port: payload?.port || 'COM1',
            baudRate: payload?.baudRate || 9600,
          });
          respond('__apexapp_scale_reading', { reading });
        } catch (err: any) {
          respond('__apexapp_scale_reading', { reading: { success: false, raw: err?.message } });
        }
        return;
      }

      if (type === '__apexapp_pole_display') {
        try {
          await invoke('send_pole_display', {
            port: payload?.port || 'COM2',
            line1: payload?.line1 || '',
            line2: payload?.line2 || '',
          });
          respond('__apexapp_pole_response', { success: true });
        } catch (err: any) {
          respond('__apexapp_pole_response', { success: false, error: err?.message });
        }
        return;
      }

      // ── 10. BATTERY & NETWORK TELEMETRY ───────────────────────────────────
      if (type === '__apexapp_get_battery') {
        try {
          const status = await invoke('get_battery_status');
          respond('__apexapp_battery_status', { status });
        } catch (_) {}
        return;
      }

      if (type === '__apexapp_get_network') {
        try {
          const network = await invoke('get_network_status');
          respond('__apexapp_network_status', { network });
        } catch (_) {}
        return;
      }

      // ── 11. WAKELOCK & CLIPBOARD ──────────────────────────────────────────
      if (type === '__apexapp_set_wakelock') {
        const enabled = Boolean(payload?.enabled);
        if (enabled && 'wakeLock' in navigator) {
          this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        } else if (!enabled && this.wakeLockSentinel) {
          await this.wakeLockSentinel.release();
          this.wakeLockSentinel = null;
        }
        return;
      }

      if (type === '__apexapp_clipboard_write') {
        await navigator.clipboard.writeText(payload?.text || '');
        return;
      }

      if (type === '__apexapp_clipboard_read') {
        const text = await navigator.clipboard.readText();
        respond('__apexapp_clipboard_data', { text });
        return;
      }
    });
  }

  // ── DESKTOP NOTIFICATION CLICK RESOLUTION ─────────────────────────────────
  static resolveNotificationClick(notif: NotificationOptions) {
    // 1. Unminimize and focus main desktop window
    invoke('focus_main_window').catch(() => {});
    window.focus();

    // 2. Switch to the tenant App view (#view-app) if on Settings or Dashboard
    const viewApp = document.querySelector('#view-app') as HTMLElement;
    const viewDash = document.querySelector('#view-dash') as HTMLElement;
    const viewSettings = document.querySelector('#view-settings') as HTMLElement;
    const navSettingsBtn = document.querySelector('#nav-settings-btn') as HTMLElement;

    if (viewApp && !viewApp.classList.contains('active')) {
      viewApp.classList.add('active');
      viewDash?.classList.remove('active');
      viewSettings?.classList.remove('active');
      navSettingsBtn?.classList.remove('active');
    }

    // 3. Dispatch deep-link action to the tenant iframe
    if (notif.action) {
      const frameApp = document.querySelector('#frame-app') as HTMLIFrameElement;
      frameApp?.contentWindow?.postMessage(
        {
          type: '__apexapp_notification_action',
          action: notif.action,
        },
        '*'
      );
    }
  }

  // ── DESKTOP NOTIFICATION SENDER ───────────────────────────────────────────
  private static async dispatchDesktopNotification(notif: NotificationOptions) {
    // 1. Interactive Desktop In-App Toast
    this.showInAppToast(notif);

    // 2. Tauri v2 Plugin Notification (calls OS Notification Center)
    const tauriObj = (window as any).__TAURI__;
    if (tauriObj?.notification?.sendNotification) {
      try {
        await tauriObj.notification.sendNotification({
          title: notif.title,
          body: notif.body || '',
          extra: {
            tenantId: notif.tenantId,
            action: notif.action,
          },
        });
        return;
      } catch (_) {}
    }

    // 3. Web Notification API with direct .onclick resolution
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(notif.title, {
        body: notif.body,
        icon: notif.icon || '/src/assets/apex.svg',
        data: notif,
      });

      n.onclick = (e) => {
        e.preventDefault();
        this.resolveNotificationClick(notif);
      };
    } else {
      // Direct Rust show_system_notification command fallback
      invoke('show_system_notification', {
        title: notif.title,
        body: notif.body || '',
      }).catch(() => {});
    }
  }

  private static setupNotificationClickListeners() {
    const tauriObj = (window as any).__TAURI__;
    if (tauriObj?.notification?.onAction) {
      tauriObj.notification.onAction((notification: any) => {
        const extra = notification?.extra || {};
        this.resolveNotificationClick({
          title: notification.title,
          body: notification.body,
          tenantId: extra.tenantId,
          action: typeof extra.action === 'string' ? JSON.parse(extra.action) : extra.action,
        });
      });
    }
  }

  private static showInAppToast(notif: NotificationOptions) {
    let container = document.getElementById('desktop-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'desktop-toast-container';
      container.className = 'desktop-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'desktop-toast-banner';
    toast.innerHTML = `
      <div style="font-weight:700;font-size:0.85rem;color:#0f172a;margin-bottom:2px;">${escapeHtml(notif.title)}</div>
      ${notif.body ? `<div style="font-size:0.78rem;color:#475569;">${escapeHtml(notif.body)}</div>` : ''}
    `;

    toast.addEventListener('click', () => {
      toast.remove();
      this.resolveNotificationClick(notif);
    });

    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 4500);
  }

  private static playSynthesizedTone(frequency: number, durationMs: number) {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = frequency < 600 ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);

      gain.gain.setValueAtTime(0.18, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + durationMs / 1000);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + durationMs / 1000);
    } catch (e) {
      console.warn('Web Audio synthesis failed:', e);
    }
  }

  static broadcast(message: object) {
    const frames = [
      document.querySelector('#frame-app') as HTMLIFrameElement,
      document.querySelector('#frame-dash') as HTMLIFrameElement,
    ];
    frames.forEach((f) => f?.contentWindow?.postMessage(message, '*'));
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}