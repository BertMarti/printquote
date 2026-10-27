import { isLang, type Lang } from '../i18n';
import { normalizeBusiness, type BusinessProfile } from '../quote/business';
import type { BatchPart } from '../quote/batch';
import {
  batchFromParts,
  normalizeBatchParts,
  normalizeHistory,
  partToHistory,
  type HistoryEntry,
} from '../quote/history';
import {
  normalizeMaterialPresets,
  normalizePrinterPresets,
  type MaterialPreset,
  type PrinterPreset,
} from '../quote/profiles';
import { DEFAULT_SETTINGS, normalizeSettings, type QuoteSettings } from '../quote/settings';

/**
 * Todo lo que printquote guarda en `localStorage` lleva el prefijo `printquote:`. El origen
 * `https://bertmarti.github.io` lo comparten todas las webs de Pages de Alberto, así que cualquier otra página
 * de ese origen podría leer o **escribir** estas claves: todo lo que se lee se trata como dato no fiable y se
 * valida campo a campo. Si algo no se puede leer (JSON roto, tipo equivocado, entradas descartadas), la app
 * arranca con los valores por defecto para esa parte y lo apunta en `storageIssues` para avisar.
 */
export const STORAGE_PREFIX = 'printquote:';

const STORAGE_KEY = 'printquote:ajustes:v1';

/** Partes del almacenamiento que se pueden haber leído mal. */
export type StorageArea = 'settings' | 'business' | 'history' | 'batch' | 'profiles';

const issues = new Set<StorageArea>();

/** Devuelve (y olvida) las partes guardadas que no se pudieron leer enteras desde la última llamada. */
export function takeStorageIssues(): StorageArea[] {
  const list = [...issues];
  issues.clear();
  return list;
}

/** `JSON.parse` que apunta el problema en vez de lanzar. `undefined` si no hay nada guardado. */
function readJson(key: string, area: StorageArea): unknown {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    issues.add(area);
    return undefined;
  }
}

const isPlainObject = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Lee los ajustes guardados. Si no hay, están corruptos o el navegador bloquea el almacenamiento, usa los de por defecto. */
export function loadSettings(): QuoteSettings {
  try {
    const data = readJson(STORAGE_KEY, 'settings');
    if (data !== undefined && !isPlainObject(data)) issues.add('settings');
    return normalizeSettings(data);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Guarda los ajustes. Devuelve false si el navegador no deja (modo privado o almacenamiento lleno): la app sigue funcionando sin recordarlos. */
export function saveSettings(settings: QuoteSettings): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
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
    const data = readJson(BUSINESS_KEY, 'business');
    if (data !== undefined && !isPlainObject(data)) issues.add('business');
    // Un logotipo que no es un PNG/JPEG en base64 válido se descarta: se avisa porque es señal de manipulación.
    const business = normalizeBusiness(data);
    if (isPlainObject(data) && (data as { logo?: unknown }).logo !== null && (data as { logo?: unknown }).logo !== undefined && business.logo === null) issues.add('business');
    return business;
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
    const data = readJson(HISTORY_KEY, 'history');
    if (data === undefined) return [];
    if (!Array.isArray(data)) {
      issues.add('history');
      return [];
    }
    const entries = normalizeHistory(data);
    // Entradas rotas o repetidas descartadas. La app nunca guarda más de HISTORY_MAX, así que pasarse también es
    // señal de manipulación.
    if (entries.length < data.length) issues.add('history');
    return entries;
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
    const data = readJson(BATCH_KEY, 'batch');
    if (data === undefined) return [];
    const record = (isPlainObject(data) ? data : {}) as { v?: unknown; parts?: unknown };
    const saved = record.v === 1 ? normalizeBatchParts(record.parts) : null;
    const parts = saved && batchFromParts(saved);
    if (!parts) issues.add('batch');
    return parts ?? [];
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

const PROFILES_KEY = 'printquote:perfiles:v1';

export interface SavedProfiles {
  readonly printers: PrinterPreset[];
  readonly materials: MaterialPreset[];
}

/** Impresoras y materiales propios (`{ v: 1, printers, materials }`), validados uno a uno. */
export function loadProfiles(): SavedProfiles {
  try {
    const data = readJson(PROFILES_KEY, 'profiles');
    if (data === undefined) return { printers: [], materials: [] };
    const record = (isPlainObject(data) ? data : {}) as { v?: unknown; printers?: unknown; materials?: unknown };
    if (record.v !== 1) {
      issues.add('profiles');
      return { printers: [], materials: [] };
    }
    const printers = normalizePrinterPresets(record.printers);
    const materials = normalizeMaterialPresets(record.materials);
    const rawLength = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
    if (
      (record.printers !== undefined && !Array.isArray(record.printers)) ||
      (record.materials !== undefined && !Array.isArray(record.materials)) ||
      // La app nunca guarda más de PRESETS_MAX: si hay más, o se descartó alguno, algo se ha tocado.
      printers.length < rawLength(record.printers) ||
      materials.length < rawLength(record.materials)
    ) {
      issues.add('profiles');
    }
    return { printers, materials };
  } catch {
    return { printers: [], materials: [] };
  }
}

/** Guarda los perfiles propios (sin ninguno, borra la clave). Devuelve false si el navegador no deja. */
export function saveProfiles(profiles: SavedProfiles): boolean {
  try {
    if (profiles.printers.length === 0 && profiles.materials.length === 0) window.localStorage.removeItem(PROFILES_KEY);
    else window.localStorage.setItem(PROFILES_KEY, JSON.stringify({ v: 1, ...profiles }));
    return true;
  } catch {
    return false;
  }
}

const WELCOME_KEY = 'printquote:bienvenida:v1';

/** ¿Ya cerró la persona la guía de la primera visita? Sin almacenamiento, se considera que no (se vuelve a mostrar). */
export function loadWelcomeDone(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveWelcomeDone(): void {
  try {
    window.localStorage.setItem(WELCOME_KEY, '1');
  } catch {
    // Modo privado: la guía volverá a salir la próxima vez.
  }
}

/**
 * «Borrar mis datos»: quita **solo** las claves de printquote (`printquote:…`). Nunca `localStorage.clear()`,
 * que borraría también lo de las demás webs del mismo origen. Devuelve cuántas claves se borraron, o -1 si el
 * navegador no deja acceder al almacenamiento.
 */
export function clearAllData(): number {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return keys.length;
  } catch {
    return -1;
  }
}
