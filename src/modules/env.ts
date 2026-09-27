import { invoke } from '@tauri-apps/api/core';
import { EnvVar } from '../types';

export class EnvManager {
  private static envVars: EnvVar[] = [];
  private static envListEl = document.querySelector('#env-list') as HTMLElement;
  private static envKeyInput = document.querySelector('#env-key-input') as HTMLInputElement;
  private static envValInput = document.querySelector('#env-val-input') as HTMLInputElement;
  private static btnAddEnv = document.querySelector('#btn-add-env') as HTMLButtonElement;
  private static btnSaveEnv = document.querySelector('#btn-save-env') as HTMLButtonElement;

  static init() {
    this.loadEnvVars();

    this.btnAddEnv?.addEventListener('click', () => {
      const key = this.envKeyInput.value.trim();
      const value = this.envValInput.value.trim();
      if (!key) return;
      this.upsertLocal(key, value);
      this.envKeyInput.value = '';
      this.envValInput.value = '';
      this.render();
    });

    this.btnSaveEnv?.addEventListener('click', async () => {
      const orig = this.btnSaveEnv.textContent;
      this.btnSaveEnv.textContent = 'Saving...';
      this.btnSaveEnv.disabled = true;
      try {
        await invoke('save_env_vars', { vars: this.envVars.filter((e) => e.key.trim() !== '') });
        this.btnSaveEnv.textContent = 'Saved!';
        setTimeout(() => {
          this.btnSaveEnv.textContent = orig!;
          this.btnSaveEnv.disabled = false;
        }, 2000);
        await this.loadEnvVars();
      } catch (err) {
        alert('Failed to save .env: ' + err);
        this.btnSaveEnv.textContent = orig!;
        this.btnSaveEnv.disabled = false;
      }
    });
  }

  static async loadEnvVars(): Promise<EnvVar[]> {
    try {
      this.envVars = await invoke('get_env_vars');
      this.render();
      return this.envVars;
    } catch (err) {
      console.error('Failed to load .env', err);
      return [];
    }
  }

  static async upsert(key: string, value: string) {
    this.upsertLocal(key, value);
    await invoke('save_env_vars', { vars: this.envVars.filter((e) => e.key.trim() !== '') });
    this.render();
  }

  private static upsertLocal(key: string, value: string) {
    const idx = this.envVars.findIndex((e) => e.key === key);
    if (idx !== -1) this.envVars[idx].value = value;
    else this.envVars.push({ key, value });
  }

  private static render() {
    if (!this.envListEl) return;
    this.envListEl.innerHTML = '';

    if (!this.envVars.length) {
      this.envListEl.innerHTML = `<div style="color:#64748b;font-size:0.85rem;font-style:italic;">No environment variables defined.</div>`;
      return;
    }

    this.envVars.forEach((env, index) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;align-items:center;';

      const keyInput = document.createElement('input');
      keyInput.value = env.key;
      keyInput.style.cssText =
        'flex:1;padding:6px;font-family:monospace;border:1px solid #e2e8f0;border-radius:4px;outline:none;';
      keyInput.oninput = (e) => (this.envVars[index].key = (e.target as HTMLInputElement).value);

      const valInput = document.createElement('input');
      valInput.value = env.value;
      valInput.style.cssText =
        'flex:2;padding:6px;font-family:monospace;border:1px solid #e2e8f0;border-radius:4px;outline:none;';
      valInput.oninput = (e) => (this.envVars[index].value = (e.target as HTMLInputElement).value);

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.cssText =
        'border:none;background:#fee2e2;color:#ef4444;cursor:pointer;padding:6px 12px;border-radius:4px;font-weight:bold;';
      delBtn.onclick = () => {
        this.envVars.splice(index, 1);
        this.render();
      };

      row.appendChild(keyInput);
      row.appendChild(valInput);
      row.appendChild(delBtn);
      this.envListEl.appendChild(row);
    });
  }
}