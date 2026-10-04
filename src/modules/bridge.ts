import { invoke } from '@tauri-apps/api/core';
import { PrinterManager } from './printer';
import { ScannerManager } from './scanner';

export class BridgeManager {
  private static wakeLockSentinel: any = null;
  private static audioCtx: AudioContext | null = null;

  static init() {
    window.addEventListener('message', async (event) => {
      const { type, payload } = event.data || {};
      if (!type || !type.startsWith('__apexapp_')) return;

      const respond = (responseType: string, data: object) => {
        event.source?.postMessage({ type: responseType, ...data }, { targetOrigin: '*' });
      };

      // ── 1. HARDWARE AUDIO & INSTANT CHIME / BUZZ SYNTHESIZER ──────────────
      if (type === '__apexapp_beep') {
        const freq = payload?.frequency || 1200;
        const dur = payload?.durationMs || 150;

        // Instant zero-delay Web Audio playback (< 5ms)
        this.playSynthesizedTone(freq, dur);

        // Also notify hardware spooler / Win32 MessageBeep
        invoke('play_system_beep', { frequency: freq, durationMs: dur }).catch(() => {});
        return;
      }

      // ── 2. NATIVE DESKTOP NOTIFICATIONS ───────────────────────────────────
      if (type === '__apexapp_notify') {
        const title = payload?.title || 'ApexApp Alert';
        const body = payload?.body || '';

        try {
          await invoke('show_system_notification', { title, body });
          respond('__apexapp_notify_response', { success: true });
        } catch (err: any) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body });
          }
          respond('__apexapp_notify_response', { success: false, error: err?.message || err });
        }
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

  /**
   * Zero-latency (< 5ms) Web Audio tone synthesizer:
   * High pitches play a crisp bell chime, low pitches play an error buzz.
   */
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

      // Lower frequencies (< 600Hz) use sawtooth for a raspy error buzz; higher ones use smooth sine
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