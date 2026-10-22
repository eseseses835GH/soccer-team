// Vercel Function: Google sign-in in redirect mode (iPhone/iPad and in-app browsers, v16).
// Google posts the ID token here (`credential`) with a CSRF value (`g_csrf_token`, also set as a
// cookie by Google's script: double-submit). We hand the token to the app in the hash, which never
// reaches a server: 303 → /#gsi=<token>. The app then sends it with the raw nonce to Supabase
// (signInWithIdToken), which checks the signature, audience and nonce. Nothing is logged or stored.
// Failures go back to the app too (#gsi_error=…), so nobody is left on a blank page.

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN = 8192;

const headers = (extra: Record<string, string>) => ({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...extra });
const back = (hash: string) => new Response(null, { status: 303, headers: headers({ Location: `/${hash}` }) });

function cookie(header: string | null, name: string): string {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST')
    return new Response('<!doctype html><meta charset="utf-8"><a href="/">כוחות</a>', {
      status: 405,
      headers: headers({ Allow: 'POST', 'Content-Type': 'text/html; charset=utf-8' }),
    });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return back('#gsi_error=bad');
  }
  const credential = form.get('credential');
  const csrf = form.get('g_csrf_token');
  if (typeof csrf !== 'string' || !csrf || csrf !== cookie(req.headers.get('cookie'), 'g_csrf_token')) return back('#gsi_error=csrf');
  if (typeof credential !== 'string' || credential.length > MAX_TOKEN || !JWT.test(credential)) return back('#gsi_error=bad');
  return back(`#gsi=${credential}`);
}

export const POST = handle;
export const GET = handle;
export const HEAD = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
