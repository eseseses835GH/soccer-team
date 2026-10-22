import type { FormEvent } from 'react';

/**
 * After the login email went out. Free plan: the email has only a link (no code), so no code field.
 * With custom SMTP and a template with {{ .Token }}, VITE_EMAIL_CODE=1 shows the 6-digit field.
 */
export function EmailSent(p: { codes: boolean; code: string; busy: boolean; onCode(v: string): void; onVerify(e: FormEvent): void; onAgain(): void }) {
  const again = (
    <button type="button" className="text-btn" onClick={p.onAgain}>
      מייל אחר / שליחה מחדש
    </button>
  );
  if (!p.codes)
    return (
      <div className="auth-form">
        <p className="hint">שלחנו מייל. פותחים אותו ולוחצים על הקישור</p>
        <p className="hint small">אם הקישור נפתח בדפדפן אחר — ההתחברות תהיה שם.</p>
        {again}
      </div>
    );
  return (
    <form className="auth-form" onSubmit={p.onVerify}>
      <p className="hint">הקלידו את הקוד מהמייל</p>
      <input
        className="input input-big code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        dir="ltr"
        maxLength={10}
        placeholder="123456"
        aria-label="הקוד מהמייל"
        value={p.code}
        onChange={(e) => p.onCode(e.target.value)}
      />
      <button type="submit" className="btn btn-primary btn-block" disabled={p.busy}>
        כניסה
      </button>
      {again}
    </form>
  );
}
