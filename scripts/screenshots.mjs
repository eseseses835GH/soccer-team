// Visual smoke test: drives the built app at a 390px mobile viewport and saves screenshots.
// Usage: npm run build && npx vite preview --port 4173 & npm run screenshots -- [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'screenshots';
const base = process.env.BASE_URL ?? 'http://localhost:4173/';
mkdirSync(out, { recursive: true });

const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const errors = [];

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    isMobile: true,
    hasTouch: true,
    locale: 'he-IL',
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${scheme}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(`${scheme} console: ${m.text()}`));
  const shot = async (name, full = false) => {
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${scheme}-${name}.png`, fullPage: full });
  };
  const checkLayout = async (where) => {
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${where}: ${sw}px`);
  };

  await page.goto(base);
  await shot('01-empty');
  await page.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  await shot('02-home');
  await shot('02b-home-full', true);
  await checkLayout('home');
  await page.getByRole('button', { name: 'השחקנים' }).click();
  await shot('03-players');
  await checkLayout('players');
  await page.getByRole('button', { name: 'הצלף', exact: true }).click();
  await page.getByRole('button', { name: 'נגמר אחרי 5 דקות', exact: true }).click();
  await page.getByText('דירוג מפורט').click();
  await shot('03b-add-detailed', true);
  await checkLayout('quick add with detailed rating');
  await page.getByText('דירוג מפורט').click();
  await page.getByRole('button', { name: /אבי/ }).click();
  await shot('04-player-sheet');
  await page.locator('.sheet').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot('04b-player-sheet-sliders');
  await checkLayout('player sheet');
  await page.getByRole('button', { name: 'סגירה' }).click();
  await page.getByRole('button', { name: /^חזרה$/ }).click();
  await page.getByRole('button', { name: 'עושים כוחות' }).click();
  await page.waitForSelector('.team');
  await shot('05-teams');
  await shot('05b-teams-full', true);
  await checkLayout('teams');
  await page.locator('.team').first().locator('.member').nth(1).click();
  await shot('06-swap-selected');
  await page.locator('.team').nth(1).locator('.member').nth(1).click();
  await page.getByRole('button', { name: /הגיע מאוחר/ }).click();
  await shot('07-late-sheet');
  await page.getByRole('button', { name: 'סגירה' }).click();
  await page.getByRole('button', { name: /התחלת משחק/ }).click();
  await page.waitForSelector('.clock');
  await page.getByRole('button', { name: /התחלה/ }).click();
  await page.getByRole('button', { name: '+ גול' }).first().click();
  await shot('08-scorer-sheet');
  await page.locator('.sheet .pick-list button').first().click();
  await shot('09-match');
  await checkLayout('match');
  await page.getByRole('button', { name: 'סיום משחק' }).click();
  await shot('10-match-after', true);
  await page.getByRole('button', { name: /לקבוצות/ }).click();
  await page.getByRole('button', { name: /^חזרה$/ }).click();
  await page.getByRole('button', { name: 'הגדרות' }).click();
  await shot('11-settings', true);
  await checkLayout('settings');
  const dir = await page.evaluate(() => getComputedStyle(document.body).direction);
  if (dir !== 'rtl') errors.push(`${scheme}: direction is ${dir}`);
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
