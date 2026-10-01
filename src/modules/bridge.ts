import { invoke } from '@tauri-apps/api/core';
import { PrinterManager } from './printer';
import { ScannerManager } from './scanner';

export class BridgeManager {
  private static wakeLockSentinel: any = null;

  static init() {
    window.addEventListener('message', async (event) => {
      const { type, payload } = event.data || {};
      if (!type || !type.startsWith('__apexapp_')) return;

      const respond = (responseType: string, data: object) => {
        event.source?.postMessage({ type: responseType, ...data }, { targetOrigin: '*' });
      };

      // ── SCANNER ───────────────────────────────────────────────────────────
      if (type === '__apexapp_camera_scan_request') {
        await ScannerManager.startCameraScan();
        return;
      }
      if (type === '__apexapp_usb_scan_request') {
        ScannerManager.startUsbScan();
        return;
      }

      // ── CASH DRAWER & PRINTER ─────────────────────────────────────────────
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

      // ── MULTI-FORMAT FILE EXPORT ──────────────────────────────────────────
      if (type === '__apexapp_export_file') {
        try {
          const filePath: string = await invoke('export_file', { payload });
          respond('__apexapp_export_response', { success: true, filePath });
        } catch (err: any) {
          respond('__apexapp_export_response', { success: false, error: err?.message || err });
        }
        return;
      }

      // ── BIOMETRICS / SUPERVISOR AUTH ──────────────────────────────────────
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

      // ── KIOSK & FULLSCREEN ────────────────────────────────────────────────
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

      // ── HARDWARE BUZZER & BEEP ────────────────────────────────────────────
      if (type === '__apexapp_beep') {
        try {
          await invoke('play_system_beep', {
            frequency: payload?.frequency,
            durationMs: payload?.durationMs,
          });
        } catch (_) {}
        return;
      }

      // ── DIGITAL WEIGHING SCALE ────────────────────────────────────────────
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

      // ── CUSTOMER POLE DISPLAY (VFD) ───────────────────────────────────────
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

      // ── BATTERY & NETWORK STATUS ──────────────────────────────────────────
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

      // ── WAKELOCK, NOTIFICATIONS, CLIPBOARD ────────────────────────────────
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

      if (type === '__apexapp_notify') {
        await invoke('show_system_notification', {
          title: payload?.title || 'ApexApp',
          body: payload?.body || '',
        });
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

  static broadcast(message: object) {
    const frames = [
      document.querySelector('#frame-app') as HTMLIFrameElement,
      document.querySelector('#frame-dash') as HTMLIFrameElement,
    ];
    frames.forEach((f) => f?.contentWindow?.postMessage(message, '*'));
  }
}