import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildServiceWorker } from '../scripts/pwa-plugin';

const SCOPE = 'https://taller.test/printquote/';
const PRECACHE = ['index.html', 'assets/index-1.js'];
const template = readFileSync(join(process.cwd(), 'src', 'sw.js'), 'utf8');

type Req = string | { readonly url: string };
const urlOf = (request: Req): string => {
  const url = new URL(typeof request === 'string' ? request : request.url);
  url.hash = '';
  return url.href;
};

/** Las cachés y la red, en memoria: lo justo de `caches` y `fetch` que usa el service worker. */
function fakeEnv(initial: Record<string, Record<string, string>> = {}) {
  const stores = new Map<string, Map<string, Response>>();
  for (const [name, entries] of Object.entries(initial)) {
    stores.set(name, new Map(Object.entries(entries).map(([url, body]) => [url, new Response(body)])));
  }
  let network: (url: string) => Promise<Response> = async () => new Response('no', { status: 404 });
  const fetch = (request: Req): Promise<Response> => network(urlOf(request));
  const caches = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        put: async (request: Req, response: Response) => void store.set(urlOf(request), response),
        addAll: async (requests: Req[]) => {
          for (const request of requests) {
            const response = await fetch(request);
            if (!response.ok) throw new TypeError('addAll: respuesta no válida');
            store.set(urlOf(request), response);
          }
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: Req, options: { cacheName?: string; ignoreSearch?: boolean } = {}) => {
      const wanted = new URL(urlOf(request));
      if (options.ignoreSearch) wanted.search = '';
      for (const [name, store] of stores) {
        if (options.cacheName && name !== options.cacheName) continue;
        for (const [key, response] of store) {
          const stored = new URL(key);
          if (options.ignoreSearch) stored.search = '';
          if (stored.href === wanted.href) return response.clone();
        }
      }
      return undefined;
    },
  };
  return {
    stores,
    online: (body: (url: string) => string = (url) => `red:${url}`) => void (network = async (url) => new Response(body(url))),
    offline: () =>
      void (network = async () => {
        throw new TypeError('sin red');
      }),
    fetch,
    caches,
  };
}

type Listener = (event: Record<string, unknown>) => void;

/** Carga `src/sw.js` (con la plantilla rellena como lo hace el plugin) en un contexto aislado. */
function load(version: string, env = fakeEnv()) {
  const listeners = new Map<string, Listener>();
  const self = {
    registration: { scope: SCOPE },
    clients: { claim: async () => undefined },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
  runInNewContext(buildServiceWorker(template, PRECACHE, version), {
    self, caches: env.caches, fetch: env.fetch, Request, Response, URL, Promise, Object, JSON,
  });
  const lifecycle = async (type: 'install' | 'activate'): Promise<void> => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => (pending = promise) });
    await pending;
  };
  /** La respuesta del service worker, o `null` si no intercepta la petición. */
  const request = async (
    url: string,
    init: { method?: string; mode?: string; range?: boolean } = {},
  ): Promise<Response | null> => {
    let answer: Promise<Response> | null = null;
    const headers = { has: (name: string): boolean => name.toLowerCase() === 'range' && init.range === true };
    listeners.get('fetch')?.({
      request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors', headers },
      respondWith: (promise: Promise<Response>) => (answer = promise),
    });
    return answer ? await (answer as Promise<Response>) : null;
  };
  return { lifecycle, request };
}

describe('service worker', () => {
  it('al instalar guarda el precaché y la raíz del scope en la caché de su versión', async () => {
    const env = fakeEnv();
    env.online();
    await load('v1', env).lifecycle('install');
    expect([...(env.stores.get('printquote-v1')?.keys() ?? [])].sort()).toEqual(
      [SCOPE, `${SCOPE}assets/index-1.js`, `${SCOPE}index.html`].sort(),
    );
  });

  it('al activar borra las cachés printquote-* de otras versiones y respeta las de otras apps', async () => {
    const env = fakeEnv({ 'printquote-v0': { a: '1' }, 'printquote-v1': { b: '2' }, 'otra-app': { c: '3' } });
    await load('v1', env).lifecycle('activate');
    expect([...env.stores.keys()].sort()).toEqual(['otra-app', 'printquote-v1']);
  });

  it('una navegación va a la red y, sin red, se abre la app desde la caché', async () => {
    const env = fakeEnv();
    env.online(() => '<html>nueva');
    const sw = load('v1', env);
    await sw.lifecycle('install');

    expect(await (await sw.request(SCOPE, { mode: 'navigate' }))?.text()).toBe('<html>nueva');

    env.offline();
    expect(await (await sw.request(SCOPE, { mode: 'navigate' }))?.text()).toBe('<html>nueva');
    expect(await (await sw.request(`${SCOPE}?utm=1`, { mode: 'navigate' }))?.text()).toBe('<html>nueva');
  });

  it('un recurso nuevo (el chunk del PDF, una fuente) se guarda al pedirlo y después se sirve sin red', async () => {
    const env = fakeEnv();
    env.online();
    const sw = load('v1', env);
    await sw.lifecycle('install');
    const pdf = `${SCOPE}assets/render-9.js`;

    expect(await (await sw.request(pdf))?.text()).toBe(`red:${pdf}`);
    env.offline();
    expect(await (await sw.request(pdf))?.text()).toBe(`red:${pdf}`);
    await expect(sw.request(`${SCOPE}assets/otro.js`)).rejects.toThrow(); // lo que nunca se descargó falla como sin red
  });

  it('lo precacheado se sirve de la caché sin tocar la red', async () => {
    const env = fakeEnv();
    env.online();
    const sw = load('v1', env);
    await sw.lifecycle('install');
    env.offline();
    expect(await (await sw.request(`${SCOPE}assets/index-1.js`))?.text()).toBe(`red:${SCOPE}assets/index-1.js`);
  });

  it('no se mete con otros orígenes, con peticiones que no son GET, con Range, con su propio sw.js ni con lo de fuera del scope', async () => {
    const env = fakeEnv();
    env.online();
    const sw = load('v1', env);
    await sw.lifecycle('install');
    expect(await sw.request('https://otro.test/printquote/x.js')).toBeNull();
    expect(await sw.request(`${SCOPE}assets/x.js`, { method: 'POST' })).toBeNull();
    expect(await sw.request(`${SCOPE}assets/x.js`, { range: true })).toBeNull();
    expect(await sw.request(`${SCOPE}sw.js`)).toBeNull();
    expect(await sw.request('https://taller.test/otra-ruta/x.js')).toBeNull();
  });

  it('no guarda respuestas de error', async () => {
    const env = fakeEnv();
    const sw = load('v1', env);
    expect((await sw.request(`${SCOPE}assets/falta.js`))?.status).toBe(404);
    expect(env.stores.get('printquote-v1')?.size ?? 0).toBe(0);
  });
});
