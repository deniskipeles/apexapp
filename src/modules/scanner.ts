import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { SettingsStorage } from './storage';
import { BridgeManager } from './bridge';

export class ScannerManager {
  private static codeReader: BrowserMultiFormatReader | null = null;
  private static cameraControls: any = null;
  private static isUsbScannerActive = false;

  private static cameraModal = document.getElementById('camera-modal') as HTMLElement;
  private static cameraPreview = document.getElementById('camera-preview') as HTMLVideoElement;
  private static btnCloseCamera = document.getElementById('btn-close-camera') as HTMLButtonElement;
  private static cameraScanStatus = document.getElementById('camera-scan-status') as HTMLElement;

  private static btnStartCameraScan = document.getElementById('btn-start-camera-scan') as HTMLButtonElement;
  private static btnStartUsbScan = document.getElementById('btn-start-usb-scan') as HTMLButtonElement;
  private static btnCancelUsbScan = document.getElementById('btn-cancel-usb-scan') as HTMLButtonElement;

  private static scannerDot = document.querySelector('#scanner-dot') as HTMLElement;
  private static scannerStatusText = document.querySelector('#scanner-status-text') as HTMLElement;
  private static scannerResultBox = document.querySelector('#scanner-result-box') as HTMLElement;
  private static scannerResultText = document.querySelector('#scanner-result-text') as HTMLElement;
  private static btnCopyScan = document.querySelector('#btn-copy-scan') as HTMLButtonElement;

  // Customization Toggles in Settings
  private static toggleBeep = document.querySelector('#scanner-beep-toggle') as HTMLInputElement;
  private static toggleAutoCopy = document.querySelector('#scanner-autocopy-toggle') as HTMLInputElement;

  static init() {
    const settings = SettingsStorage.get();
    if (this.toggleBeep) {
      this.toggleBeep.checked = settings.scannerBeep;
      this.toggleBeep.addEventListener('change', () => {
        SettingsStorage.update({ scannerBeep: this.toggleBeep.checked });
      });
    }

    if (this.toggleAutoCopy) {
      this.toggleAutoCopy.checked = settings.scannerAutoCopy;
      this.toggleAutoCopy.addEventListener('change', () => {
        SettingsStorage.update({ scannerAutoCopy: this.toggleAutoCopy.checked });
      });
    }

    this.btnStartCameraScan?.addEventListener('click', () => this.startCameraScan());
    this.btnStartUsbScan?.addEventListener('click', () => this.startUsbScan());
    this.btnCloseCamera?.addEventListener('click', () => this.stopCameraScan());

    this.btnCopyScan?.addEventListener('click', () => {
      navigator.clipboard.writeText(this.scannerResultText.textContent || '');
      const orig = this.btnCopyScan.textContent;
      this.btnCopyScan.textContent = 'Copied!';
      setTimeout(() => (this.btnCopyScan.textContent = orig), 2000);
    });
  }

  static async startCameraScan() {
    this.cameraModal.style.display = 'flex';
    this.cameraScanStatus.textContent = 'Starting camera...';
    this.cameraScanStatus.style.color = '#64748b';

    try {
      if (!this.codeReader) {
        const hints = new Map();
        hints.set(DecodeHintType.TRY_HARDER, true);
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.QR_CODE,
        ]);
        this.codeReader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80 });
      }

      this.cameraScanStatus.textContent = 'Center barcode or QR in view...';

      const onScanResult = (result: any) => {
        if (result) {
          const text = result.getText();
          this.playFeedback();
          this.stopCameraScan();
          this.handleScanResult(text, 'Camera');
        }
      };

      try {
        this.cameraControls = await this.codeReader.decodeFromConstraints(
          {
            video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          },
          this.cameraPreview,
          onScanResult
        );
      } catch (_) {
        this.cameraControls = await this.codeReader.decodeFromVideoDevice(
          undefined,
          this.cameraPreview,
          onScanResult
        );
      }
    } catch (err: any) {
      console.error('Camera error:', err);
      this.cameraScanStatus.textContent = `Camera error: ${err.message || 'Permission denied'}`;
      this.cameraScanStatus.style.color = '#ef4444';
    }
  }

  static stopCameraScan() {
    if (this.cameraControls) {
      this.cameraControls.stop();
      this.cameraControls = null;
    }
    if (this.cameraPreview && this.cameraPreview.srcObject) {
      const stream = this.cameraPreview.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.cameraPreview.srcObject = null;
    }
    this.cameraModal.style.display = 'none';
  }

  static startUsbScan() {
    if (this.isUsbScannerActive) return;
    this.isUsbScannerActive = true;

    this.scannerStatusText.textContent = 'Armed: Pull trigger on handheld USB scanner...';
    this.scannerDot.classList.add('running');
    this.btnStartUsbScan.style.display = 'none';
    this.btnCancelUsbScan.style.display = 'inline-block';

    let hiddenInput = document.getElementById('usb-scanner-input') as HTMLInputElement;
    if (!hiddenInput) {
      hiddenInput = document.createElement('input');
      hiddenInput.id = 'usb-scanner-input';
      hiddenInput.style.cssText = 'position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;';
      document.body.appendChild(hiddenInput);
    }
    hiddenInput.value = '';
    hiddenInput.focus();

    let scanBuffer = '';
    let scanTimer: ReturnType<typeof setTimeout>;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (scanBuffer.length > 2) {
          cleanup();
          this.playFeedback();
          this.handleScanResult(scanBuffer, 'USB Scanner');
        }
        scanBuffer = '';
        return;
      }
      scanBuffer += e.key;
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        if (scanBuffer.length > 2) {
          cleanup();
          this.playFeedback();
          this.handleScanResult(scanBuffer, 'USB Scanner');
        }
        scanBuffer = '';
      }, 100);
    };

    const cleanup = () => {
      hiddenInput.removeEventListener('keydown', onKey);
      this.isUsbScannerActive = false;
      this.btnStartUsbScan.style.display = 'inline-block';
      this.btnCancelUsbScan.style.display = 'none';
    };

    hiddenInput.addEventListener('keydown', onKey);
    this.btnCancelUsbScan.onclick = () => {
      cleanup();
      this.scannerStatusText.textContent = 'USB scan cancelled';
      this.scannerDot.classList.remove('running');
    };
  }

  static handleScanResult(value: string, source: 'Camera' | 'USB Scanner') {
    this.scannerResultText.textContent = value;
    this.scannerResultBox.style.display = 'block';
    this.scannerStatusText.textContent = `Scanned via ${source}`;
    this.scannerDot.classList.remove('running');

    if (SettingsStorage.get().scannerAutoCopy) {
      navigator.clipboard.writeText(value);
    }

    BridgeManager.broadcast({ type: '__apexapp_scan_result', value, source });
  }

  private static playFeedback() {
    if (!SettingsStorage.get().scannerBeep) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 1400;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close();
      }, 100);
    } catch (_) {}
  }
}