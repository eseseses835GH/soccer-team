import { search, type SearchResult } from '../engine';
import type { BalanceRequest, BalanceResponse } from './protocol';

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (r: SearchResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./balance.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<BalanceResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      // Worker failed to load (old browser, file://, CSP): fall back for good.
      worker = null;
      for (const [, p] of pending) p.reject(new Error('worker-failed'));
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Run the search off the main thread when possible, inline otherwise. */
export async function balance(req: Omit<BalanceRequest, 'id'>): Promise<SearchResult> {
  const runInline = () => search(req.players, req.k, req.options, req.constraints, { seed: req.seed, sizes: req.sizes });
  const w = getWorker();
  if (!w) return runInline();
  const id = nextId++;
  try {
    return await new Promise<SearchResult>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ ...req, id } satisfies BalanceRequest);
    });
  } catch {
    return runInline();
  }
}
