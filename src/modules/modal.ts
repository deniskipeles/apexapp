import { DOC_SECTIONS } from './docs';

export class ModalManager {
  private static docsModal = document.querySelector('#docs-modal') as HTMLElement;
  private static docsTitle = document.querySelector('#docs-modal-title') as HTMLElement;
  private static docsBadge = document.querySelector('#docs-modal-badge') as HTMLElement;
  private static docsDesc = document.querySelector('#docs-modal-desc') as HTMLElement;
  private static docsMessages = document.querySelector('#docs-modal-messages') as HTMLElement;
  private static docsCode = document.querySelector('#docs-modal-code') as HTMLElement;
  private static btnCopyDocCode = document.querySelector('#btn-copy-doc-code') as HTMLButtonElement;
  private static btnCloseDocs = document.querySelector('#btn-close-docs') as HTMLButtonElement;

  static init() {
    this.btnCloseDocs?.addEventListener('click', () => this.closeDocs());
    this.docsModal?.addEventListener('click', (e) => {
      if (e.target === this.docsModal) this.closeDocs();
    });

    this.btnCopyDocCode?.addEventListener('click', () => {
      navigator.clipboard.writeText(this.docsCode.textContent || '');
      const orig = this.btnCopyDocCode.textContent;
      this.btnCopyDocCode.textContent = 'Copied!';
      setTimeout(() => (this.btnCopyDocCode.textContent = orig), 2000);
    });

    // Wire up all [data-docs-target] buttons throughout Settings
    document.querySelectorAll('[data-docs-target]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = (e.currentTarget as HTMLElement).dataset.docsTarget;
        if (target && DOC_SECTIONS[target]) {
          this.openDocs(target);
        }
      });
    });
  }

  static openDocs(sectionKey: string) {
    const doc = DOC_SECTIONS[sectionKey];
    if (!doc || !this.docsModal) return;

    this.docsTitle.textContent = doc.title;
    this.docsBadge.textContent = doc.badge;
    this.docsDesc.textContent = doc.description;
    this.docsCode.textContent = doc.codeSnippet;

    if (doc.messages.length > 0) {
      this.docsMessages.style.display = 'block';
      this.docsMessages.innerHTML = `
        <h4 style="margin: 14px 0 8px; font-size: 0.85rem; color: #1e293b;">PostMessage Bridge Contracts</h4>
        <div style="border:1px solid #e2e8f0; border-radius:6px; overflow:hidden;">
          <table style="width:100%; font-size:0.75rem; border-collapse:collapse; text-align:left;">
            <thead style="background:#f8fafc; border-bottom:1px solid #e2e8f0;">
              <tr>
                <th style="padding:6px 10px;">Flow</th>
                <th style="padding:6px 10px;">Message Type</th>
                <th style="padding:6px 10px;">Payload</th>
                <th style="padding:6px 10px;">Description</th>
              </tr>
            </thead>
            <tbody>
              ${doc.messages
                .map(
                  (m) => `
                <tr style="border-bottom:1px solid #f1f5f9;">
                  <td style="padding:6px 10px; font-weight:600; color:#3b82f6;">${m.direction}</td>
                  <td style="padding:6px 10px;"><code>${m.type}</code></td>
                  <td style="padding:6px 10px;"><code>${m.payload}</code></td>
                  <td style="padding:6px 10px; color:#64748b;">${m.description}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    } else {
      this.docsMessages.style.display = 'none';
      this.docsMessages.innerHTML = '';
    }

    this.docsModal.style.display = 'flex';
  }

  static closeDocs() {
    if (this.docsModal) this.docsModal.style.display = 'none';
  }
}