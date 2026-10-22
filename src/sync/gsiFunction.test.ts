import { describe, expect, it } from 'vitest';
import { GET, POST } from '../../api/gsi';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln-_';
const post = (body: Record<string, string>, cookie?: string) =>
  POST(
    new Request('https://www.kadoregel.com/api/gsi', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
      body: new URLSearchParams(body),
    }),
  );

describe('api/gsi (Google redirect mode)', () => {
  it('hands the token to the app in the hash, uncached', async () => {
    const r = await post({ credential: JWT, g_csrf_token: 'c1' }, 'other=1; g_csrf_token=c1');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`/#gsi=${JWT}`);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('checks the CSRF double-submit cookie', async () => {
    for (const cookie of [undefined, 'g_csrf_token=other', 'g_csrf_token=']) {
      const r = await post({ credential: JWT, g_csrf_token: 'c1' }, cookie);
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe('/#gsi_error=csrf');
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    expect((await post({ credential: JWT }, 'g_csrf_token=')).headers.get('location')).toBe('/#gsi_error=csrf');
  });
  it('refuses something that is not a token', async () => {
    for (const credential of ['', 'a.b', 'a.b.c<script>', `${'a'.repeat(9000)}.b.c`]) {
      expect((await post({ credential, g_csrf_token: 'c' }, 'g_csrf_token=c')).headers.get('location')).toBe('/#gsi_error=bad');
    }
    const r = await POST(new Request('https://x/api/gsi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }));
    expect(r.headers.get('location')).toMatch(/^\/#gsi_error=/);
  });
  it('rejects GET', async () => {
    const r = await GET(new Request('https://www.kadoregel.com/api/gsi'));
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('POST');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
