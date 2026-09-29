import { DEFAULT_SETTINGS, normalizeSettings, type QuoteSettings } from '../quote/settings';

const STORAGE_KEY = 'printquote:ajustes:v1';

/** Lee los ajustes guardados. Si no hay, están corruptos o el navegador bloquea el almacenamiento, usa los de por defecto. */
export function loadSettings(): QuoteSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(raw ? (JSON.parse(raw) as unknown) : undefined);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: QuoteSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Modo privado o almacenamiento lleno: la app sigue funcionando sin recordar ajustes.
  }
}

export function clearSettings(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ídem.
  }
}
