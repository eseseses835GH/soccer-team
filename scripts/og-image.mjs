// Renders public/og-image.png (1200×630, the link preview in WhatsApp / Google / social) in the app's style.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ball = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const team = (color, n) => Array.from({ length: n }, () => `<i style="background:${color}"></i>`).join('');
const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@500;800&display=block" rel="stylesheet">
<style>
  html,body{margin:0}
  body{width:1200px;height:630px;background:#151613;color:#f5f4ef;font-family:Heebo,system-ui,sans-serif;
    display:flex;align-items:center;justify-content:space-between;padding:0 96px;box-sizing:border-box}
  .text{display:flex;flex-direction:column;gap:18px}
  .logo{display:flex;align-items:center;gap:28px}
  .logo svg{width:132px;height:132px}
  h1{font-size:168px;font-weight:800;line-height:1;margin:0;letter-spacing:-2px}
  p{font-size:50px;font-weight:500;margin:0;color:#d9d8d0}
  .url{font-size:36px;color:#3ccf80;direction:ltr;text-align:right;margin-top:14px}
  .teams{display:flex;flex-direction:column;align-items:center;gap:22px}
  .row{display:flex;gap:16px}
  .row i{width:46px;height:46px;border-radius:50%;display:block}
  .vs{font-size:40px;font-weight:800;color:#8b8c83}
</style></head><body>
<div class="text">
  <div class="logo">${ball}<h1>כוחות</h1></div>
  <p>חלוקה לקבוצות כדורגל הוגנות</p>
  <p style="font-size:36px;color:#8b8c83">בלחיצה אחת · בחינם · בלי להוריד אפליקציה</p>
  <div class="url">kadoregel.com</div>
</div>
<div class="teams">
  <div class="row">${team('#e0362c', 5)}</div>
  <div class="vs">נגד</div>
  <div class="row">${team('#2468e0', 5)}</div>
</div>
</body></html>`;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('../public/og-image.png', import.meta.url).pathname });
await browser.close();
console.log('og-image written');
