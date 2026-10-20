import { useEffect, useState } from 'react';
import { authErrorText, authProviders, redirectUrl } from '../sync/supabase';
import { useSync, type LoginReason } from '../sync/SyncProvider';
import { Segmented, Sheet } from './components';

const LEADS: Record<LoginReason, string> = {
  join: 'קיבלתם הזמנה לקבוצה. כדי להצטרף צריך להתחבר (פעם אחת בטלפון הזה).',
  upload: 'כדי לסנכרן את הקבוצה בין כמה טלפונים צריך להתחבר. הנתונים שכבר בטלפון נשארים.',
  account: 'עם חשבון אפשר לסנכרן קבוצות בין כמה מארגנים. בלי חשבון הכול ממשיך לעבוד בטלפון הזה.',
};

type Method = 'code' | 'password';

/** Login: Google, a one-time code by email, or email + password. */
export function AccountSheet({ reason, onClose }: { reason: LoginReason; onClose: () => void }) {
  const sync = useSync();
  const [method, setMethod] = useState<Method>('code');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [google, setGoogle] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    authProviders().then((p) => live && setGoogle(p.google));
    return () => {
      live = false;
    };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const withGoogle = () =>
    run(async () => {
      if (google === false) throw new Error('provider is not enabled');
      const c = await sync.client();
      const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } });
      if (error) throw error;
    });

  const sendCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validEmail) return setError('כתובת המייל לא תקינה');
    run(async () => {
      const c = await sync.client();
      const { error } = await c.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: redirectUrl() } });
      if (error) throw error;
      setCodeSent(true);
      setInfo('המייל בדרך. לפעמים זה לוקח דקה; כדאי לבדוק גם בספאם.');
    });
  };

  const verifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.replace(/\D/g, '');
    if (token.length < 6) return setError('הקוד צריך להיות באורך 6 ספרות לפחות');
    run(async () => {
      const c = await sync.client();
      const { error } = await c.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
      if (error) throw error;
    });
  };

  const withPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validEmail) return setError('כתובת המייל לא תקינה');
    if (password.length < 6) return setError('הסיסמה חלשה מדי. לפחות 6 תווים');
    if (mode === 'up' && password !== password2) return setError('הסיסמאות לא זהות');
    run(async () => {
      const c = await sync.client();
      if (mode === 'in') {
        const { error } = await c.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await c.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectUrl() } });
        if (error) throw error;
        if (!data.session) {
          setMode('in');
          setInfo('נרשמתם! שלחנו מייל לאישור. אחרי האישור חוזרים לכאן ונכנסים.');
        }
      }
    });
  };

  return (
    <Sheet title="התחברות" onClose={onClose}>
      <p className="lead">{LEADS[reason]}</p>
      <div className="stack">
        <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={withGoogle}>
          <GoogleLogo />
          המשך עם Google
        </button>
        {google === false && <p className="hint small center">Google עוד לא הופעל בפרויקט. בינתיים אפשר להתחבר עם מייל.</p>}
      </div>
      <div className="or" aria-hidden="true">
        <span>או עם מייל</span>
      </div>
      <Segmented
        label="שיטת התחברות"
        value={method}
        onChange={(m) => {
          setMethod(m);
          setError(null);
          setInfo(null);
        }}
        options={[
          { value: 'code', label: 'קישור למייל' },
          { value: 'password', label: 'מייל וסיסמה' },
        ]}
      />
      {method === 'code' ? (
        !codeSent ? (
          <form className="auth-form" onSubmit={sendCode}>
            <input className="input" type="email" inputMode="email" autoComplete="email" dir="ltr" placeholder="name@example.com" aria-label="מייל" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              שליחת קישור למייל
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyCode}>
            <p className="hint">
              שלחנו מייל אל <bdi dir="ltr">{email.trim()}</bdi>. פותחים אותו <strong>בטלפון הזה</strong> ולוחצים על הקישור, וחוזרים לכאן מחוברים. אם במייל יש קוד, אפשר להקליד אותו כאן:
            </p>
            <input
              className="input input-big code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              placeholder="123456"
              aria-label="הקוד מהמייל"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              כניסה
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setCodeSent(false);
                setCode('');
                setInfo(null);
              }}
            >
              מייל אחר / שליחה מחדש
            </button>
          </form>
        )
      ) : (
        <form className="auth-form" onSubmit={withPassword}>
          <input className="input" type="email" inputMode="email" autoComplete="email" dir="ltr" placeholder="name@example.com" aria-label="מייל" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            className="input"
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            dir="ltr"
            placeholder="סיסמה"
            aria-label="סיסמה"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'up' && (
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              placeholder="סיסמה שוב"
              aria-label="אימות סיסמה"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {mode === 'in' ? 'כניסה' : 'הרשמה'}
          </button>
          <button type="button" className="text-btn" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
            {mode === 'in' ? 'אין לכם חשבון? הרשמה' : 'יש לכם חשבון? כניסה'}
          </button>
        </form>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {info && (
        <p className="auth-info" role="status">
          {info}
        </p>
      )}
      <p className="hint small">אחרי ההתחברות, הקבוצות שתסנכרנו נשמרות גם בשרת (Supabase), כולל הדירוגים. רק מארגני הקבוצה רואים אותן.</p>
    </Sheet>
  );
}

/** Google's four-colour "G" (brand colours, so the button is recognisable). */
function GoogleLogo() {
  return (
    <svg className="g-logo" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
