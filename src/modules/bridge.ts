import { PrinterManager } from './printer';
import { ScannerManager } from './scanner';

export class BridgeManager {
  static init() {
    window.addEventListener('message', async (event) => {
      const { type, payload } = event.data || {};
      if (!type || !type.startsWith('__apexapp_')) return;

      // 1. Camera Scan Request
      if (type === '__apexapp_camera_scan_request') {
        await ScannerManager.startCameraScan();
        return;
      }

      // 2. Handheld USB Scanner Request
      if (type === '__apexapp_usb_scan_request') {
        ScannerManager.startUsbScan();
        return;
      }

      // 3. Generic Scan Request
      if (type === '__apexapp_scan_request') {
        if (payload?.mode === 'camera') await ScannerManager.startCameraScan();
        else ScannerManager.startUsbScan();
        return;
      }

      // 4. Query Active Printer
      if (type === '__apexapp_get_printer') {
        const { id, name } = PrinterManager.getActivePrinter();
        event.source?.postMessage(
          {
            type: '__apexapp_printer_state',
            printerId: id,
            printerName: name,
          },
          { targetOrigin: '*' }
        );
        return;
      }

      // 5. Hardware or Silent PDF Print Request
      if (type === '__apexapp_print_request') {
        try {
          const savedPath = await PrinterManager.printPayload(payload || {});
          event.source?.postMessage(
            {
              type: '__apexapp_print_response',
              success: true,
              savedPath,
            },
            { targetOrigin: '*' }
          );
        } catch (err: any) {
          event.source?.postMessage(
            {
              type: '__apexapp_print_response',
              success: false,
              error: String(err?.message || err),
            },
            { targetOrigin: '*' }
          );
        }
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