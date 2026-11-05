// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/i18n';
import { normalizeHistory } from '../src/quote/history';
import { startApp } from '../src/ui/app';
import { loadBatch, loadBusiness, loadHistory, takeStorageIssues } from '../src/ui/storage';

/**
 * Lo que guardaba printquote 1.1.0 (generado con el código de la etiqueta v1.1.0, ver `note` del archivo): el 1.2 debe
 * leerlo igual, sin avisos y sin perder nada, aunque ahora el historial admita el correo y el teléfono del cliente y el
 * negocio recuerde si guardarlos. No hace falta migrar el esquema: los campos nuevos son opcionales.
 */
const saved = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/datos-v1.1.json'), 'utf8')) as Record<string, unknown>;
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

function restore(): void {
  for (const key of ['printquote:historial:v1', 'printquote:lote:v1', 'printquote:negocio:v1']) {
    window.localStorage.setItem(key, JSON.stringify(saved[key]));
  }
}

describe('datos guardados por la 1.1', () => {
  beforeEach(() => {
    window.localStorage.clear();
    takeStorageIssues();
    restore();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('el historial (con un lote) se lee entero y sin avisos, sin correo ni teléfono', () => {
    const entries = loadHistory();
    expect(entries.map((entry) => entry.id)).toEqual(['lote-1-1', 'pieza-1-1']);
    expect(entries[0]).toMatchObject({ client: 'Taller Ejemplo', note: 'Color rojo' });
    expect(entries[0]?.parts).toHaveLength(2);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty('email');
      expect(entry).not.toHaveProperty('phone');
    }
    // Lo leído es lo mismo que se guardó: volver a guardarlo no cambia nada.
    expect(JSON.parse(JSON.stringify(normalizeHistory(saved['printquote:historial:v1'])))).toEqual(saved['printquote:historial:v1']);
    expect(takeStorageIssues()).toEqual([]);
  });

  it('el lote en curso (`printquote:lote:v1`) se sigue leyendo y el negocio guarda el contacto por defecto', () => {
    const parts = loadBatch();
    expect(parts.map((part) => part.fileName)).toEqual(['soporte.stl', 'tapa.stl']);
    expect(parts[1]?.settings.copies).toBe(4);
    expect(loadBusiness()).toMatchObject({ name: 'Taller Ejemplo', quoteNumber: '2026-007', saveContact: true });
    expect(takeStorageIssues()).toEqual([]);
  });

  it('en la interfaz: el lote de la 1.1 se abre con su cliente y sus notas, y los campos de contacto quedan vacíos', () => {
    document.body.innerHTML = body;
    startApp();
    expect(document.body.textContent).not.toContain(t('storage.issue.title')); // sin el aviso de datos ilegibles
    expect($<HTMLInputElement>('in-contact-save').checked).toBe(true);
    $<HTMLInputElement>('in-client-email').value = 'resto@example.com';
    $<HTMLInputElement>('in-client-phone').value = '600 000 000';
    const open = document.querySelector<HTMLButtonElement>('button[data-action="open"][data-id="lote-1-1"]');
    if (!open) throw new Error('falta «Abrir» en el lote guardado por la 1.1');
    open.click(); // hay un lote en curso: pide un segundo clic
    document.querySelector<HTMLButtonElement>('button[data-action="open"][data-id="lote-1-1"]')?.click();
    expect($<HTMLInputElement>('in-client').value).toBe('Taller Ejemplo');
    expect($<HTMLTextAreaElement>('in-quote-notes').value).toBe('Color rojo');
    expect($<HTMLInputElement>('in-client-email').value).toBe('');
    expect($<HTMLInputElement>('in-client-phone').value).toBe('');
    expect(loadBatch().map((part) => part.fileName)).toEqual(['soporte.stl', 'tapa.stl']);
  });
});
