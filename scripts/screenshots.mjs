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
  // Quick add: level and positions up front; cards and sliders folded.
  await page.getByPlaceholder('איך קוראים לו?').fill('שחר');
  for (const pos of ['שוער', 'הגנה', 'קישור']) await page.getByRole('button', { name: pos, exact: true }).click();
  await shot('03a-add-positions');
  await page.getByText('עוד על השחקן').click();
  await page.getByRole('button', { name: 'הצלף', exact: true }).click();
  await page.getByRole('button', { name: 'נגמר אחרי 5 דקות', exact: true }).click();
  await shot('03b-add-more', true);
  await page.getByText('דירוג מפורט מתקדם').click();
  await shot('03c-add-detailed', true);
  await checkLayout('quick add with detailed rating');
  await page.getByText('דירוג מפורט מתקדם').click();
  await page.getByText('עוד על השחקן').click();
  await page.getByPlaceholder('איך קוראים לו?').fill('');
  await page.getByRole('button', { name: /אבי/ }).click();
  await shot('04-player-sheet');
  await page.locator('.sheet').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot('04b-player-sheet-sliders');
  await checkLayout('player sheet');
  await page.getByRole('button', { name: 'סגירה' }).click();
  // Swipe a row (real touch drag) to reveal "מחיקה", then the confirmation.
  const cdp = await ctx.newCDPSession(page);
  const row = page.locator('.roster li').nth(3);
  await row.scrollIntoViewIfNeeded();
  const rb = await row.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rb.x + 100, y: rb.y + rb.height / 2 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rb.x + 100 + i * 12, y: rb.y + rb.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await shot('03c-swipe-revealed');
  await checkLayout('swiped row');
  await row.locator('.swipe-action').tap();
  await shot('03d-swipe-confirm');
  await page.getByRole('button', { name: 'ביטול' }).click();
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
  // 14 players at 5-a-side: the short team came on and borrows from the losing team.
  await page.locator('.borrow').scrollIntoViewIfNeeded();
  await page.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
  await shot('10b-borrow');
  await checkLayout('borrow');
  await page.locator('.borrow-picks button:not(.sel)').first().click();
  await shot('10c-borrow-other');
  await page.locator('.borrow').getByRole('button', { name: 'אישור' }).click();
  await shot('10d-borrow-done');
  // A few more matches with goals, then end the evening: summary and history.
  const playMatch = async (goals) => {
    for (const [side, pick] of goals) {
      await page.getByRole('button', { name: '+ גול' }).nth(side).click();
      if (pick === null) await page.getByRole('button', { name: 'דילוג' }).click();
      else await page.locator('.sheet .pick-list button').nth(pick).click();
    }
    await page.getByRole('button', { name: 'סיום משחק' }).click();
  };
  await playMatch([[0, 0], [0, 1], [1, 0]]);
  await playMatch([[0, 0], [0, 0], [0, null], [1, 3]]);
  await playMatch([[1, 2], [0, 0], [1, 2]]);
  await playMatch([[0, 4], [1, 1], [1, 1]]);
  await page.waitForTimeout(2600); // let the "who's next" toast fade
  await page.getByRole('button', { name: 'סיום הערב' }).click();
  await shot('12-end-evening-sheet');
  await page.locator('.sheet').getByRole('button', { name: 'סיום הערב' }).click();
  await page.waitForSelector('.evening');
  await shot('13-evening');
  await page.locator('.evening details').evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
  await shot('13b-evening-full', true);
  await checkLayout('evening');
  // An older evening, so the list and all-time view have something to compare.
  await page.evaluate(() => {
    const key = `kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`;
    const s = JSON.parse(localStorage.getItem(key));
    const week = 7 * 864e5;
    const r = structuredClone(s.history[0]);
    r.id = 'ev-older';
    r.startedAt -= week;
    r.endedAt -= week;
    r.matches = r.matches.slice(0, 3).map((m) => ({ ...m, goalsA: m.goalsB, goalsB: m.goalsA, goals: [], endedAt: m.endedAt - week }));
    s.history.push(r);
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.goto(base + '#history');
  await page.reload();
  await page.waitForSelector('.ev-list');
  await shot('14-history');
  await checkLayout('history');
  await page.getByRole('radio', { name: 'כל הזמנים' }).click();
  await shot('15-all-time', true);
  await checkLayout('all-time');
  await page.getByRole('button', { name: /^חזרה$/ }).click();
  await page.waitForSelector('.toast:not(.show)'); // let the match toast fade
  await page.getByRole('button', { name: /החלפת קבוצה/ }).click();
  await shot('12-groups-sheet');
  await checkLayout('groups sheet');
  await page.getByRole('button', { name: /קבוצה חדשה/ }).click();
  await page.getByLabel('שם הקבוצה').fill('כדורגל בשכונה');
  await shot('13-new-group');
  await page.getByRole('button', { name: 'ביטול' }).click();
  await page.getByRole('button', { name: 'סגירה' }).click();
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
