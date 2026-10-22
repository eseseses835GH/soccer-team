// Playwright route → the real Vercel Function (api/gsi.ts; Node strips the types). Used by the e2e check.
import { POST } from '../api/gsi.ts';

export async function handleGsi(route, st) {
  const req = route.request();
  const headers = await req.allHeaders();
  const res = await POST(new Request(req.url(), { method: req.method(), headers, body: req.method() === 'POST' ? req.postDataBuffer() : undefined }));
  st.gsi = { status: res.status, cacheControl: res.headers.get('cache-control'), location: res.headers.get('location')?.replace(/=.*/, '=…') };
  const out = {};
  res.headers.forEach((v, k) => (out[k] = v));
  await route.fulfill({ status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) });
}
