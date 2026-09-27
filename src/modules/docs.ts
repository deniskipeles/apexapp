import { DocSection } from '../types';

export const DOC_SECTIONS: Record<string, DocSection> = {
  dashboard: {
    id: 'dashboard',
    title: 'ApexKit Admin Dashboard',
    badge: 'Admin & Schema Studio',
    description:
      'The Admin Dashboard allows developers and site administrators to visually edit schemas, browse SQLite records, inspect vector collections, and review real-time API logs.',
    messages: [
      {
        direction: 'Iframe ➔ Desktop',
        type: '__apexapp_open_dashboard',
        payload: '{ path?: string, newWindow?: boolean }',
        description: 'Requests host wrapper to open the dashboard path.',
      },
    ],
    codeSnippet: `// Path is configured via ADMIN_DASHBOARD_PATH in .env (defaults to /_dashboard)
const dashboardUrl = \`\${window.location.origin}/_dashboard\`;

function openAdminStudio() {
  if (window.parent !== window) {
    window.open(dashboardUrl, '_blank');
  } else {
    window.location.href = dashboardUrl;
  }
}`,
  },

  printer: {
    id: 'printer',
    title: 'Printer Hardware Engine',
    badge: 'Desktop Spooler & Silent Output',
    description:
      'Iframe apps can print raw ESC/POS to thermal printers or save silent HTML/PDF receipts directly to a customizable folder with dynamic or timestamped filenames.',
    messages: [
      {
        direction: 'Iframe ➔ Desktop',
        type: '__apexapp_get_printer',
        payload: 'none',
        description: 'Queries active printer name & ID configured in Settings.',
      },
      {
        direction: 'Desktop ➔ Iframe',
        type: '__apexapp_printer_state',
        payload: '{ printerId: string, printerName: string }',
        description: 'Returns the connected printer details.',
      },
      {
        direction: 'Iframe ➔ Desktop',
        type: '__apexapp_print_request',
        payload: '{ html: string, file_name?: string, custom_dir?: string, copies?: number }',
        description: 'Dispatches receipt to spooler or silently saves to selected directory.',
      },
      {
        direction: 'Desktop ➔ Iframe',
        type: '__apexapp_print_response',
        payload: '{ success: boolean, savedPath?: string, error?: string }',
        description: 'Acknowledges print job completion or returns full output file path.',
      },
    ],
    codeSnippet: `// Print HTML receipt with custom or timestamped filename
window.parent.postMessage({
  type: '__apexapp_print_request',
  payload: {
    html: \`<div style="font-family:monospace;width:220px;">
      <h3>STORE RECEIPT</h3>
      <hr/>
      <p>Item #101 - $12.00</p>
      <b>TOTAL: $12.00</b>
    </div>\`,
    // Optional: override the custom folder and filename for this specific job
    file_name: 'Order_1042.html', // (leave blank to use Settings custom name / timestamp)
    copies: 1
  }
}, '*');

// Listen for the saved file path response
window.addEventListener('message', (e) => {
  if (e.data?.type === '__apexapp_print_response') {
    if (e.data.success) {
      console.log('Saved to file path:', e.data.savedPath);
    } else {
      console.error('Print failed:', e.data.error);
    }
  }
});`,
  },

  scanner: {
    id: 'scanner',
    title: 'Barcode & QR Scanner',
    badge: 'Camera & USB Wedge',
    description:
      'Interact with physical USB barcode scanners and laptop webcams directly from your web application.',
    messages: [
      {
        direction: 'Iframe ➔ Desktop',
        type: '__apexapp_camera_scan_request',
        payload: 'none',
        description: 'Opens laptop camera scanner overlay with optical barcode reader.',
      },
      {
        direction: 'Iframe ➔ Desktop',
        type: '__apexapp_usb_scan_request',
        payload: 'none',
        description: 'Arms host listener for rapid keystroke buffers from handheld USB barcode guns.',
      },
      {
        direction: 'Desktop ➔ Iframe',
        type: '__apexapp_scan_result',
        payload: '{ value: string, source: "Camera" | "USB Scanner" }',
        description: 'Dispatched the instant a barcode or QR code is detected.',
      },
    ],
    codeSnippet: `// 1. Arm Handheld USB Gun or trigger camera
window.parent.postMessage({ type: '__apexapp_usb_scan_request' }, '*');

// 2. Listen continuously for scans
window.addEventListener('message', (event) => {
  if (event.data?.type === '__apexapp_scan_result') {
    const { value, source } = event.data;
    console.log(\`Received code \${value} from \${source}\`);
  }
});`,
  },

  tunnels: {
    id: 'tunnels',
    title: 'Managed & Cloudflare Tunnels',
    badge: 'Public Edge Routing',
    description:
      'Host apps can detect whether they are being viewed through a public tunnel or local loopback, enabling seamless multi-device testing and mobile previewing.',
    messages: [],
    codeSnippet: `// Detect if running inside desktop shell
const isDesktopWrapper = window.parent !== window;

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:5000'
  : window.location.origin;

console.log('App connected to backend via:', API_BASE);`,
  },

  env: {
    id: 'env',
    title: 'Environment Variables (.env)',
    badge: 'Secrets Management',
    description:
      'Manage environment secrets and ApexKit configurations directly from the desktop shell. Values are stored securely on disk and read upon sidecar startup.',
    messages: [],
    codeSnippet: `# Recognized environment keys:
PORT=5000
ADMIN_DASHBOARD_PATH="/_dashboard"
APEXKIT_MASTER_KEY="your-secret-key"
CF_TUNNEL_TOKEN="optional-tunnel-token"
APEX_TUNNEL_SERVER="apexkit.io"
APEX_TUNNEL_DOMAIN="my-subdomain"
APEX_TUNNEL_TOKEN="your-frp-token"`,
  },
};