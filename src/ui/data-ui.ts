import { t } from '../i18n';
import { BACKUP_MAX_BYTES, backupFileName, buildBackup, parseBackup } from '../quote/backup';
import type { BusinessProfile } from '../quote/business';
import type { QuoteSettings } from '../quote/settings';
import { clearAllData, saveBusiness, saveProfiles, saveSettings, type SavedProfiles } from './storage';

interface Host {
  settings(): QuoteSettings;
  business(): BusinessProfile;
  profiles(): SavedProfiles;
  applySettings(next: QuoteSettings): void;
  applyBusiness(next: BusinessProfile): void;
  applyProfiles(next: SavedProfiles): void;
  download(blob: Blob, name: string): void;
  announce(message: string): void;
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function setupData(host: Host): void {
  const status = byId('data-status');
  byId('data-export').addEventListener('click', () => {
    const { printers, materials } = host.profiles();
    const text = buildBackup({ settings: host.settings(), printers, materials, business: host.business() });
    host.download(new Blob([text], { type: 'application/json' }), backupFileName());
    host.announce(t('data.exported'));
  });
  const input = byId<HTMLInputElement>('data-file');
  byId('data-import').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Se mira el tamaño antes de leerlo: un archivo enorme no llega a cargarse en memoria.
    if (file.size > BACKUP_MAX_BYTES) {
      status.textContent = t('backup.err.tooBig');
      return;
    }
    void file
      .text()
      .then((text) => {
        const result = parseBackup(text);
        if (!result.ok) {
          status.textContent = t(result.error);
          return;
        }
        const { data } = result;
        if (data.settings) {
          saveSettings(data.settings);
          host.applySettings(data.settings);
        }
        if (data.business) {
          saveBusiness(data.business);
          host.applyBusiness(data.business);
        }
        if (data.printers || data.materials) {
          // Lo que no venga en el archivo se queda como estaba.
          const current = host.profiles();
          const profiles = { printers: data.printers ?? current.printers, materials: data.materials ?? current.materials };
          saveProfiles(profiles);
          host.applyProfiles(profiles);
        }
        status.textContent = result.dropped > 0 ? t('data.imported.dropped', { dropped: result.dropped }) : t('data.imported');
        host.announce(status.textContent);
      })
      .catch(() => {
        status.textContent = t('backup.err.json');
      });
  });
  let confirming = false;
  byId('data-clear').addEventListener('click', () => {
    const button = byId<HTMLButtonElement>('data-clear');
    if (!confirming) {
      confirming = true;
      button.textContent = t('data.clear.confirm');
      byId('data-cancel').hidden = false;
      return;
    }
    const count = clearAllData();
    host.announce(t('data.cleared', { n: count }));
    try {
      if (typeof window.location.reload === 'function') window.location.reload();
    } catch {
      // happy-dom y algunos navegadores embebidos no permiten recargar la página.
    }
  });
  byId('data-cancel').addEventListener('click', () => {
    confirming = false;
    byId<HTMLButtonElement>('data-clear').textContent = t('data.clear');
    byId('data-cancel').hidden = true;
  });
}
