import { isLang, type Lang } from '../i18n';
import { normalizeBusiness, type BusinessProfile } from '../quote/business';
import type { BatchPart } from '../quote/batch';
import { batchFromParts, normalizeBatchParts, normalizeHistory, partToHistory, type HistoryEntry } from '../quote/history';
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

const HISTORY_KEY = 'printquote:historial:v1';

/** Presupuestos guardados (los que se puedan leer; lo roto se descarta entrada a entrada). */
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return normalizeHistory(raw ? (JSON.parse(raw) as unknown) : []);
  } catch {
    return [];
  }
}

/** Guarda el historial. Devuelve false si el navegador no ha dejado (sin espacio, modo privado…). */
export function saveHistory(entries: readonly HistoryEntry[]): boolean {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

const BATCH_KEY = 'printquote:lote:v1';

/** El lote guardado (vacío si no hay, está corrupto, es de otra versión del esquema o el navegador bloquea el almacenamiento). */
export function loadBatch(): BatchPart[] {
  try {
    const raw = window.localStorage.getItem(BATCH_KEY);
    const data = (raw ? (JSON.parse(raw) as unknown) : null) as { v?: unknown; parts?: unknown } | null;
    const saved = data?.v === 1 ? normalizeBatchParts(data.parts) : null;
    return (saved && batchFromParts(saved)) ?? [];
  } catch {
    return [];
  }
}

/** Guarda el lote (uno vacío borra la clave). Si no cabe o el navegador no deja, la app sigue sin recordarlo. */
export function saveBatch(parts: readonly BatchPart[]): void {
  try {
    if (parts.length === 0) window.localStorage.removeItem(BATCH_KEY);
    else window.localStorage.setItem(BATCH_KEY, JSON.stringify({ v: 1, parts: parts.map(partToHistory) }));
  } catch {
    // Modo privado o almacenamiento lleno: el lote vive solo en esta sesión. Se borra la copia vieja para que, al
    // recargar, no reaparezca un lote desfasado.
    try {
      window.localStorage.removeItem(BATCH_KEY);
    } catch {
      // Ni eso: sin almacenamiento.
    }
  }
}
