// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../src/ui/app';
import { loadBusiness } from '../src/ui/storage';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
}

function type(id: string, value: string): void {
  const input = $<HTMLInputElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('contacto del cliente en la interfaz', () => {
  beforeEach(() => {
    document.body.innerHTML = body;
    window.localStorage.clear();
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(binaryStl(cubeTriangles(20)))));
  });

  afterEach(() => vi.unstubAllGlobals());

  async function start(): Promise<void> {
    startApp();
    $('sample-button').click();
    await until(() => $('out-total').textContent !== '—');
  }

  it('avisa sin bloquear botones y limpia el aviso al corregir', async () => {
    await start();
    type('in-client-email', 'no-es-correo');
    $('in-client-email').dispatchEvent(new Event('blur'));
    expect($('in-client-email').getAttribute('aria-invalid')).toBe('true');
    expect($('in-client-email').getAttribute('aria-describedby')).toContain('err-client-email');
    expect($<HTMLButtonElement>('history-save').disabled).toBe(false);
    type('in-client-email', 'ana@example.com');
    expect($('in-client-email').hasAttribute('aria-invalid')).toBe(false);
    type('in-client-phone', '12');
    $('in-client-phone').dispatchEvent(new Event('change'));
    expect($('in-client-phone').getAttribute('aria-invalid')).toBe('true');
  });

  it('guarda el contacto marcado, pero no lo guarda al desmarcar', async () => {
    await start();
    type('in-client-email', 'ana@example.com');
    type('in-client-phone', '+34 600 123 456');
    $('history-save').click();
    let saved = JSON.parse(window.localStorage.getItem('printquote:historial:v1') ?? '[]') as { email?: string; phone?: string }[];
    expect(saved[0]).toMatchObject({ email: 'ana@example.com', phone: '+34 600 123 456' });
    $('in-contact-save').click();
    $('history-save').click();
    saved = JSON.parse(window.localStorage.getItem('printquote:historial:v1') ?? '[]') as { email?: string; phone?: string }[];
    expect(saved[0]).not.toHaveProperty('email');
    expect(saved[0]).not.toHaveProperty('phone');
    expect(loadBusiness().saveContact).toBe(false);
  });

  it('restaura el contacto al abrir y vacía los campos si no existe', async () => {
    await start();
    type('in-client-email', 'ana@example.com');
    type('in-client-phone', '600123456');
    $('history-save').click();
    type('in-client-email', 'otro@example.com');
    type('in-client-phone', '600000000');
    document.querySelector<HTMLButtonElement>('button[data-action="open"]')?.click();
    expect($<HTMLInputElement>('in-client-email').value).toBe('ana@example.com');
    expect($<HTMLInputElement>('in-client-phone').value).toBe('600123456');
    window.localStorage.setItem('printquote:historial:v1', JSON.stringify([{ ...JSON.parse(window.localStorage.getItem('printquote:historial:v1') ?? '[]')[0], email: undefined, phone: undefined }]));
    await start();
    document.querySelector<HTMLButtonElement>('button[data-action="open"]')?.click();
    expect($<HTMLInputElement>('in-client-email').value).toBe('');
    expect($<HTMLInputElement>('in-client-phone').value).toBe('');
  });

  it('mantiene la preferencia tras iniciar la aplicación de nuevo', async () => {
    await start();
    $('in-contact-save').click();
    expect(loadBusiness().saveContact).toBe(false);
    document.body.innerHTML = body;
    startApp();
    expect($<HTMLInputElement>('in-contact-save').checked).toBe(false);
  });

  it('el enlace para compartir no lleva ni el correo ni el teléfono', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async (text: string) => void written.push(text)) },
      configurable: true,
    });
    await start();
    type('in-client', 'Ana Ejemplo');
    type('in-client-email', 'ana@example.com');
    type('in-client-phone', '+34 600 123 456');
    $('share-copy').click();
    await until(() => written.length > 0);
    expect(written[0]).toMatch(/#v=1&/);
    for (const secret of ['ana', 'example', '600', '%40', 'Ejemplo']) expect(written[0]).not.toContain(secret);
  });

  it('el aviso de formato se rehace al cambiar de idioma y al abrir un presupuesto con datos válidos', async () => {
    await start();
    type('in-client-email', 'ana@example.com');
    $('history-save').click();
    type('in-client-email', 'mal');
    $('in-client-email').dispatchEvent(new Event('blur'));
    expect($('err-client-email').textContent).toMatch(/Revisa el correo/);
    document.querySelector<HTMLButtonElement>('button[data-lang="en"]')?.click();
    expect($('err-client-email').textContent).toMatch(/Check the email/);
    document.querySelector<HTMLButtonElement>('button[data-lang="es"]')?.click();
    document.querySelector<HTMLButtonElement>('button[data-action="open"]')?.click();
    expect($<HTMLInputElement>('in-client-email').value).toBe('ana@example.com');
    expect($('err-client-email').textContent).toBe('');
    expect($('in-client-email').hasAttribute('aria-invalid')).toBe(false);
  });

  describe('al desmarcar la casilla con presupuestos ya guardados', () => {
    const stored = (): { email?: string; phone?: string; note?: string }[] =>
      JSON.parse(window.localStorage.getItem('printquote:historial:v1') ?? '[]') as { email?: string; phone?: string }[];

    async function saveTwo(): Promise<void> {
      await start();
      type('in-client-email', 'ana@example.com');
      type('in-client-phone', '600123456');
      type('in-quote-notes', 'Rojo');
      $('history-save').click();
      $('history-save').click();
      expect(stored().filter((entry) => entry.email)).toHaveLength(2);
    }

    it('pregunta si se quitan de los ya guardados y, al confirmar, los quita de todos (y solo eso)', async () => {
      await saveTwo();
      expect($('contact-purge').hidden).toBe(true);
      $('in-contact-save').click();
      expect($('contact-purge').hidden).toBe(false);
      expect($('contact-purge-text').textContent).toBe('¿Quitar también el correo y el teléfono de los 2 presupuestos ya guardados que los tienen?');
      expect(document.activeElement).toBe($('contact-purge-yes'));
      document.querySelector<HTMLButtonElement>('button[data-lang="en"]')?.click();
      expect($('contact-purge-text').textContent).toBe('Also remove the email and phone from the 2 saved quotes that have them?');
      expect($('contact-purge-yes').textContent).toBe('Remove them');
      document.querySelector<HTMLButtonElement>('button[data-lang="es"]')?.click();
      $('contact-purge-yes').click();
      expect($('contact-purge').hidden).toBe(true);
      expect(stored()).toHaveLength(2);
      for (const entry of stored()) {
        expect(entry).not.toHaveProperty('email');
        expect(entry).not.toHaveProperty('phone');
        expect(entry.note).toBe('Rojo');
      }
      expect(loadBusiness().saveContact).toBe(false);
    });

    it('«Dejarlos» no toca lo guardado, volver a marcar oculta la pregunta y sin contactos guardados no pregunta', async () => {
      await saveTwo();
      $('in-contact-save').click();
      $('contact-purge-no').click();
      expect($('contact-purge').hidden).toBe(true);
      expect(stored().filter((entry) => entry.email === 'ana@example.com')).toHaveLength(2);
      $('in-contact-save').click(); // marcada otra vez
      expect($('contact-purge').hidden).toBe(true);
      window.localStorage.removeItem('printquote:historial:v1');
      document.body.innerHTML = body;
      await start();
      $('in-contact-save').click();
      expect($('contact-purge').hidden).toBe(true);
    });

    it('si el navegador no deja escribir, avisa y no da por quitados los datos', async () => {
      await saveTwo();
      $('in-contact-save').click();
      const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('lleno');
      });
      $('contact-purge-yes').click();
      setItem.mockRestore();
      expect($('contact-purge').hidden).toBe(false);
      expect(document.body.textContent).toContain('No se ha podido guardar');
      expect(stored().filter((entry) => entry.email)).toHaveLength(2);
    });
  });
});
