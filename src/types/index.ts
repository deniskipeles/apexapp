export interface EnvVar {
  key: string;
  value: string;
}

export interface PrinterInfo {
  id: string;
  name: string;
  is_default: boolean;
  isOnline?: boolean;
}

export interface PrintResult {
  success: boolean;
  savedPath?: string;
  error?: string;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface ScanResult {
  value: string;
  source: 'Camera' | 'USB Scanner';
}

export interface AppSettings {
  autoStartServer: boolean;
  openInNewWindow: boolean;
  dashboardPath: string;
  wifiSharingEnabled: boolean;
  wifiCustomPort: number;
  printSaveDir: string;
  printCustomFileName: string;
  printUseTimestamp: boolean;
  scannerBeep: boolean;
  scannerAutoCopy: boolean;
  preferredScanMode: 'camera' | 'usb';
  savedPrinterId: string | null;
  savedPrinterName: string | null;
  cfTunnelToken: string;
  frpServer: string;
  frpDomain: string;
  frpToken: string;
  customIcon: string | null;
  customAppName: string | null;
}

export interface DocSection {
  id: string;
  title: string;
  badge: string;
  description: string;
  messages: Array<{
    direction: 'Iframe ➔ Desktop' | 'Desktop ➔ Iframe';
    type: string;
    payload: string;
    description: string;
  }>;
  codeSnippet: string;
}