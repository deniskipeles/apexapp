import { listen } from '@tauri-apps/api/event';

export class ConsoleManager {
  private static consoleArea = document.querySelector('#console-area') as HTMLElement;
  private static btnClearConsole = document.querySelector('#btn-clear-console') as HTMLButtonElement;

  static init() {
    this.btnClearConsole?.addEventListener('click', () => {
      this.consoleArea.innerHTML = `<div style="color:#64748b;">-- Console Cleared --</div>`;
    });

    listen('sidecar-log', (event) => {
      this.appendLog(event.payload as string);
    });
  }

  static appendLog(message: string) {
    if (!this.consoleArea) return;
    const line = document.createElement('div');
    line.style.cssText = 'margin-bottom:2px;border-bottom:1px solid #1e293b;padding-bottom:2px;word-break:break-all;';

    const now = new Date().toLocaleTimeString();
    const timeSpan = document.createElement('span');
    timeSpan.style.cssText = 'color:#64748b;margin-right:8px;';
    timeSpan.textContent = `[${now}]`;

    const textSpan = document.createElement('span');
    if (message.includes('ERROR') || message.includes('reject') || message.includes('failed')) {
      textSpan.style.color = '#f87171';
    } else if (message.includes('[Tunnel]') || message.includes('WSS')) {
      textSpan.style.color = '#fb923c';
    } else {
      textSpan.style.color = '#38bdf8';
    }
    textSpan.textContent = message;

    line.appendChild(timeSpan);
    line.appendChild(textSpan);
    this.consoleArea.appendChild(line);
    this.consoleArea.scrollTop = this.consoleArea.scrollHeight;

    if (this.consoleArea.childNodes.length > 250) {
      this.consoleArea.removeChild(this.consoleArea.firstChild!);
    }
  }
}