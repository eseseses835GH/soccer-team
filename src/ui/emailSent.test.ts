import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmailSent } from './EmailSent';

const view = (codes: boolean) => renderToStaticMarkup(createElement(EmailSent, { codes, code: '', busy: false, onCode() {}, onVerify() {}, onAgain() {} }));

describe('after the login email is sent', () => {
  it('free plan (link only): two lines, no code field', () => {
    const html = view(false);
    expect(html).toContain('שלחנו מייל. פותחים אותו ולוחצים על הקישור');
    expect(html).toContain('אם הקישור נפתח בדפדפן אחר — ההתחברות תהיה שם.');
    expect(html).not.toContain('<input');
    expect(html).toContain('מייל אחר / שליחה מחדש');
  });
  it('VITE_EMAIL_CODE=1: the 6-digit field', () => {
    const html = view(true);
    expect(html).toContain('הקלידו את הקוד מהמייל');
    expect(html).toMatch(/<input[^>]*autoComplete="one-time-code"|<input[^>]*autocomplete="one-time-code"/);
    expect(html).toContain('כניסה');
    expect(html).not.toContain('בדפדפן אחר');
  });
});
