// The service worker's share target (Android: WhatsApp → share → כוחות), run against a fake worker scope.
import { describe, expect, it } from 'vitest';
import swSource from '../public/sw.js?raw';
import { SHARE_CACHE, SHARE_PATH, SHARED_HASH } from './state/whatsapp';

const ORIGIN = 'https://www.kadoregel.com';

function loadSw() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        put: async (url: string, res: Response) => void m.set(url, res),
        match: async (url: string) => m.get(url),
        addAll: async () => {},
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async () => undefined,
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  new Function('self', 'caches', 'fetch', swSource)(self, caches, () => Promise.reject(new Error('offline')));
  const fetchEvent = async (req: Request) => {
    let out: Promise<Response> | undefined;
    listeners.fetch({ request: req, respondWith: (p: Promise<Response>) => (out = p), waitUntil: () => {} });
    return out ? await out : undefined;
  };
  return { stores, caches, fetchEvent, listeners };
}

const share = (form: FormData) => new Request(`${ORIGIN}/share-target`, { method: 'POST', body: form });
const sharedUrl = new URL(SHARE_PATH, `${ORIGIN}/`).href;

describe('service worker share target', () => {
  it('keeps a shared chat file and opens the import sheet', async () => {
    const sw = loadSw();
    const form = new FormData();
    form.append('file', new File(['[1/1/26, 1:00:00] דני: אני'], 'WhatsApp Chat - כדורגל.txt', { type: 'text/plain' }));
    const res = await sw.fetchEvent(share(form));
    expect(res?.status).toBe(303);
    expect(res?.headers.get('location')).toBe(`${ORIGIN}/#players?${SHARED_HASH}`);
    const kept = sw.stores.get(SHARE_CACHE)?.get(sharedUrl);
    expect(await kept?.text()).toBe('[1/1/26, 1:00:00] דני: אני');
  });

  it('prefers the .txt/.zip among several files; falls back to shared text', async () => {
    const sw = loadSw();
    const form = new FormData();
    form.append('file', new File(['jpeg'], 'a.jpg'));
    form.append('file', new File(['PKzip'], 'WhatsApp Chat.zip'));
    await sw.fetchEvent(share(form));
    expect(await sw.stores.get(SHARE_CACHE)?.get(sharedUrl)?.text()).toBe('PKzip');

    const sw2 = loadSw();
    const t = new FormData();
    t.append('text', 'אבי 8\nדני');
    await sw2.fetchEvent(share(t));
    expect(await sw2.stores.get(SHARE_CACHE)?.get(sharedUrl)?.text()).toMatch(/^אבי 8\r?\nדני$/); // form posts use CRLF
  });

  it('a broken share still opens the app; other POSTs are left alone', async () => {
    const sw = loadSw();
    const res = await sw.fetchEvent(new Request(`${ORIGIN}/share-target`, { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } }));
    expect(res?.status).toBe(303);
    expect(await sw.fetchEvent(new Request(`${ORIGIN}/other`, { method: 'POST', body: 'x' }))).toBeUndefined();
  });

  it('a new version keeps the share cache', async () => {
    const sw = loadSw();
    await sw.caches.open('kochot-old');
    await sw.caches.open(SHARE_CACHE);
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect([...sw.stores.keys()]).toEqual([SHARE_CACHE]);
  });
});
