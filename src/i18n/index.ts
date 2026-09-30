import { en } from './en';
import { es, type ErrorKey, type Key } from './es';
import { interpolate, type Params } from './interpolate';

export type { ErrorKey, Key, Params };

export type Lang = 'es' | 'en';
export const LANGS: readonly Lang[] = ['es', 'en'];

const DICTIONARIES: Readonly<Record<Lang, Readonly<Record<Key, string>>>> = { es, en };

/** Configuración regional de `Intl` de cada idioma: números, moneda y fechas. La moneda sigue siendo el euro. */
const LOCALES: Readonly<Record<Lang, string>> = { es: 'es-ES', en: 'en-GB' };

let current: Lang = 'es';
const listeners = new Set<(lang: Lang) => void>();

export function isLang(value: unknown): value is Lang {
  return value === 'es' || value === 'en';
}

export function getLang(): Lang {
  return current;
}

/** Cambia el idioma activo y avisa a quien lo escuche. */
export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const listener of listeners) listener(lang);
}

/** Escucha los cambios de idioma. Devuelve la función para dejar de escuchar. */
export function onLangChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Configuración regional de `Intl` del idioma activo (o del indicado). */
export function getLocale(lang: Lang = current): string {
  return LOCALES[lang];
}

/** Traduce una clave a un idioma concreto. */
export function tIn(lang: Lang, key: Key, params?: Params): string {
  return interpolate(DICTIONARIES[lang][key], params);
}

/** Traduce una clave al idioma activo. */
export function t(key: Key, params?: Params): string {
  return tIn(current, key, params);
}

/**
 * Idioma inicial: el guardado si lo hay; si no, el primero de los idiomas del navegador que
 * sea español o inglés. Si el navegador no declara ninguno de los dos, inglés (lo entiende más
 * gente); si no declara nada, español.
 */
export function detectLang(navigatorLanguages: readonly string[], saved?: string | null): Lang {
  if (isLang(saved)) return saved;
  if (navigatorLanguages.length === 0) return 'es';
  for (const tag of navigatorLanguages) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (primary === 'es' || primary === 'en') return primary;
  }
  return 'en';
}

/** Idiomas que declara el navegador (vacío si no hay `navigator`). */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  const list = navigator.languages;
  if (list && list.length > 0) return list;
  return navigator.language ? [navigator.language] : [];
}
