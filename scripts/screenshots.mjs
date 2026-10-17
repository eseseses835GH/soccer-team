// Visual smoke test: drives the built app at a 390px mobile viewport and saves screenshots.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/screenshots.mjs [outDir]
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
  page.on('console', (m) => m.type() === 'error' && errors.push(`${scheme} console: ${m.text()}`));
  const shot = (name) => page.screenshot({ path: `${out}/${scheme}-${name}.png`, fullPage: true });

  await page.goto(base);
  await shot('01-empty');
  await page.getByRole('button', { name: 'טעינת סגל לדוגמה' }).first().click();
  await shot('02-players');
  await page.getByRole('button', { name: /אבי/ }).click();
  await shot('03-edit-sheet');
  await page.getByRole('button', { name: 'סגירה' }).click();
  await page.getByRole('navigation').getByRole('button', { name: /המשחק/ }).click();
  await shot('04-game');
  await page.getByRole('button', { name: /חלוקה לקבוצות/ }).click();
  await page.waitForSelector('.team-card');
  await shot('05-teams');
  const members = page.locator('.member');
  await members.first().click();
  await shot('06-swap-selected');
  await page.locator('.team-card').nth(1).locator('.member').first().click();
  await page.locator('details.totals summary').click();
  await shot('07-teams-swapped-totals');
  await page.getByRole('button', { name: /הגרלה מחדש/ }).click();
  await shot('08-reroll');
  await page.getByRole('navigation').getByRole('button', { name: /המשחק/ }).click();
  await page.getByRole('button', { name: 'הוסף', exact: true }).click();
  await page.getByRole('button', { name: /חלוקה לקבוצות/ }).click();
  await page.waitForSelector('.teams-3');
  await shot('09-three-teams');
  await page.getByRole('navigation').getByRole('button', { name: /הגדרות/ }).click();
  await shot('10-settings');
  // Layout sanity: nothing should overflow horizontally at 390px.
  for (const tab of ['שחקנים', 'המשחק', 'קבוצות', 'הגדרות']) {
    await page.getByRole('navigation').getByRole('button', { name: new RegExp(tab) }).click();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${tab}: ${sw}px`);
    const dir = await page.evaluate(() => getComputedStyle(document.body).direction);
    if (dir !== 'rtl') errors.push(`${scheme}: direction is ${dir}`);
  }
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
