// Organizer side of the live evening (DECISIONS → "Players and live evening — organizer side (v10)").
// A small queue in front of liveApi.set: changes are debounced, only the latest snapshot per group
// is kept (offline it waits for 'online'), unchanged snapshots aren't re-sent, and a refusal
// (not an organizer, bad data) is dropped instead of retried forever. No React, so it is unit-tested.
import { stableKey } from './doc';
import type { LiveData } from './live';
import { SyncError } from './supabase';

/** Equality key of a snapshot, ignoring its publish time. */
export const liveKey = (live: LiveData | null) => (live ? stableKey({ ...live, at: 0 }) : 'ended');

export interface PublisherOptions {
  send(gid: string, live: LiveData | null): Promise<unknown>;
  /** Called after a successful send (e.g. to remember that this phone runs the evening). */
  onSent?(gid: string, live: LiveData | null): void;
  /** The server said someone else runs the evening (or the rev moved on): the snapshot was dropped. */
  onConflict?(gid: string, live: LiveData | null): void;
  isOnline?(): boolean;
  now?(): number;
  delay?: number;
  /** After a failed send that may work later (server hiccup), try again this much later. */
  retryMs?: number;
}

export interface LivePublisher {
  /** What the server is assumed to have, without sending (when a group is opened). */
  baseline(gid: string, live: LiveData | null): void;
  /** Tonight changed: send after the debounce if it differs from the last one. */
  update(gid: string, live: LiveData | null): void;
  /** Send now even if unchanged (app opened / back on screen). */
  republish(gid: string, live: LiveData | null): void;
  /** Send whatever waits (back online). */
  flush(): Promise<void>;
  /** Waiting snapshots, by group (for tests and debugging). */
  pending(): Map<string, LiveData | null>;
  dispose(): void;
}

export function createLivePublisher(o: PublisherOptions): LivePublisher {
  const delay = o.delay ?? 1000;
  const retryMs = o.retryMs ?? 30_000;
  const online = o.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const now = o.now ?? Date.now;
  const sent = new Map<string, string>(); // gid → key the server has (or will have, once queued)
  const queue = new Map<string, LiveData | null>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing: Promise<void> | null = null;
  let again = false;
  let disposed = false;

  const arm = (ms: number) => {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  };

  const enqueue = (gid: string, live: LiveData | null, force: boolean, ms: number) => {
    const key = liveKey(live);
    if (!force && sent.get(gid) === key && !queue.has(gid)) return;
    if (!force && queue.has(gid) && liveKey(queue.get(gid)!) === key) return;
    queue.set(gid, live);
    arm(ms);
  };

  async function run() {
    let retry = false;
    for (const [gid, live] of [...queue]) {
      if (!online()) return;
      const out = live ? { ...live, at: now() } : null;
      try {
        await o.send(gid, out);
        if (queue.get(gid) === live) queue.delete(gid);
        sent.set(gid, liveKey(live));
        o.onSent?.(gid, live);
      } catch (e) {
        const code = e instanceof SyncError ? e.code : 'other';
        if (code === 'denied' || code === 'invalid' || code === 'conflict') {
          // Not allowed, data the server won't take, or someone else runs it now: resending won't help.
          if (queue.get(gid) === live) queue.delete(gid);
          sent.set(gid, liveKey(live));
          if (code === 'conflict') o.onConflict?.(gid, live);
        } else if (code !== 'offline') retry = true;
        // offline: stays queued until 'online' calls flush()
      }
    }
    if (retry && queue.size) arm(retryMs);
  }

  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (flushing) {
      again = true;
      return flushing;
    }
    flushing = (async () => {
      do {
        again = false;
        await run();
      } while (again && queue.size && online() && !disposed);
    })();
    try {
      await flushing;
    } finally {
      flushing = null;
    }
  }

  return {
    baseline(gid, live) {
      if (!queue.has(gid)) sent.set(gid, liveKey(live));
    },
    update: (gid, live) => enqueue(gid, live, false, delay),
    republish: (gid, live) => enqueue(gid, live, true, 0),
    flush,
    pending: () => new Map(queue),
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}

/** Another organizer's phone wrote the live row this recently: don't take it over just by opening the app. */
export const FOREIGN_FRESH_MS = 10 * 60_000;

/** On open/focus: republish only if the row is ours, missing, ended, or stale. */
export function shouldRepublish(row: { updatedBy: string | null; updatedAt: string } | null, me: string, now = Date.now()): boolean {
  if (!row || !row.updatedBy || row.updatedBy.toLowerCase() === me.toLowerCase()) return true;
  const t = Date.parse(row.updatedAt);
  return Number.isNaN(t) || now - t > FOREIGN_FRESH_MS;
}
