import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cardStyleOf, photoVersion, removePlayerPhoto, savePlayerCard } from './photos';
import { withPhotoChange } from './style';
import { SyncError } from '../sync/supabase';

function client(opts: { uploadError?: string; rpcError?: { message: string; code?: string } } = {}) {
  const log: string[] = [];
  const bucket = {
    upload: vi.fn(async (path: string, blob: Blob, o: { contentType: string }) => {
      log.push(`upload ${path} ${o.contentType} ${blob.size}`);
      return { data: opts.uploadError ? null : { path }, error: opts.uploadError ? { message: opts.uploadError } : null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      log.push(`remove ${paths.join(',')}`);
      return { data: [], error: null };
    }),
  };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    log.push(`rpc ${name} ${JSON.stringify(name === 'set_my_card' ? args.p_card : args.p_version)}`);
    if (opts.rpcError) return { data: null, error: opts.rpcError };
    return { data: name === 'set_my_card' ? { ...(args.p_card as object), junk: 1 } : null, error: null };
  });
  const sb = { storage: { from: vi.fn(() => bucket) }, rpc } as unknown as SupabaseClient;
  return { sb, log, rpc };
}

const blob = (type: string, n = 10) => new Blob([new Uint8Array(n)], { type });
const style = { shirt: 'sky', pattern: 'stripes', number: 10 };

describe('savePlayerCard', () => {
  it('uploads the portrait and the cutout (real types), one version, then the style', async () => {
    const { sb, log } = client();
    const r = await savePlayerCard('g1', 'p1', { portrait: blob('image/webp', 30), cutout: blob('image/png', 20), style }, sb);
    expect(r.version).toMatch(/^[0-9a-z]+$/);
    expect(r.card).toEqual(style);
    expect(log).toEqual([
      'upload g1/p1.webp image/webp 30',
      'upload g1/p1-cut.webp image/png 20',
      `rpc set_player_photo "${r.version}"`,
      `rpc set_my_card ${JSON.stringify(style)}`,
    ]);
    expect(photoVersion('g1', 'p1', 'old')).toBe(r.version);
    expect(cardStyleOf('g1', 'p1', undefined)).toEqual(style);
  });

  it('no cutout: the old cutout file goes', async () => {
    const { sb, log } = client();
    await savePlayerCard('g1', 'p2', { portrait: blob('image/jpeg'), cutout: null, style }, sb);
    expect(log.slice(0, 2)).toEqual(['upload g1/p2.webp image/jpeg 10', 'remove g1/p2-cut.webp']);
    expect(log[2]).toMatch(/^rpc set_player_photo/);
  });

  it('a refused upload throws "denied" and points nothing at it', async () => {
    const { sb, rpc } = client({ uploadError: 'new row violates row-level security policy' });
    await expect(savePlayerCard('g1', 'p3', { portrait: blob('image/webp'), cutout: null, style }, sb)).rejects.toMatchObject({ code: 'denied' });
    expect(rpc).not.toHaveBeenCalled();
    expect(photoVersion('g1', 'p3', undefined)).toBeUndefined();
  });

  it('a failed set_player_photo throws a SyncError', async () => {
    const { sb } = client({ rpcError: { message: 'denied', code: '42501' } });
    const e = await savePlayerCard('g1', 'p4', { portrait: blob('image/webp'), cutout: blob('image/webp'), style }, sb).catch((x) => x);
    expect(e).toBeInstanceOf(SyncError);
    expect(photoVersion('g1', 'p4', undefined)).toBeUndefined();
  });

  it('remove: the roster first, then both files', async () => {
    const { sb, log } = client();
    await removePlayerPhoto('g1', 'p5', sb);
    expect(log).toEqual(['rpc set_player_photo null', 'remove g1/p5.webp,g1/p5-cut.webp']);
    expect(photoVersion('g1', 'p5', 'v1')).toBeUndefined();
  });
});

describe('withPhotoChange', () => {
  const p = { id: 'a', name: 'A', photo: 'v1', card: { shirt: 'red' } };
  it('applies a new photo, a removal, a kept photo', () => {
    expect(withPhotoChange(p, { photo: 'v2', card: style })).toEqual({ id: 'a', name: 'A', photo: 'v2', card: style });
    expect(withPhotoChange(p, { photo: null })).toEqual({ id: 'a', name: 'A', card: { shirt: 'red' } });
    expect(withPhotoChange(p, { card: null })).toEqual({ id: 'a', name: 'A', photo: 'v1' });
  });
});
