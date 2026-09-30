import { isLang, type Lang } from '../i18n';
import { normalizeBusiness, type BusinessProfile } from '../quote/business';
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

const BUSINESS_KEY = 'printquote:negocio:v1';

/** Lee los datos del negocio guardados (o los de por defecto). */
export function loadBusiness(): BusinessProfile {
  try {
    const raw = window.localStorage.getItem(BUSINESS_KEY);
    return normalizeBusiness(raw ? (JSON.parse(raw) as unknown) : undefined);
  } catch {
    return normalizeBusiness(undefined);
  }
}

/** Guarda los datos del negocio. Devuelve false si el navegador no ha dejado (sin espacio, modo privado…). */
export function saveBusiness(business: BusinessProfile): boolean {
  try {
    window.localStorage.setItem(BUSINESS_KEY, JSON.stringify(business));
    return true;
  } catch {
    return false;
  }
}

export function clearBusiness(): void {
  try {
    window.localStorage.removeItem(BUSINESS_KEY);
  } catch {
    // Ídem.
  }
}

const LANG_KEY = 'printquote:idioma:v1';

/** Idioma elegido a mano, si lo hay. */
export function loadLang(): Lang | null {
  try {
    const raw = window.localStorage.getItem(LANG_KEY);
    return isLang(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Modo privado o almacenamiento lleno: se usará el idioma del navegador.
  }
}
