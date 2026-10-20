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
  await page.locator('.swipe-tip').scrollIntoViewIfNeeded();
  await shot('03-players-tip');
  await page.evaluate(() => scrollTo(0, 0));
  await shot('03-players');
  await checkLayout('players');
  // Quick add: level and positions up front; cards and sliders folded.
  await page.getByPlaceholder('איך קוראים לו?').fill('שחר');
  for (const pos of ['טוב בשער', 'הגנה', 'קישור']) await page.getByRole('button', { name: pos, exact: true }).click();
  await shot('03a-add-positions');
  await page.getByText('עוד על השחקן').click();
  await page.getByRole('button', { name: "צ'יטה", exact: true }).click();
  await page.getByRole('button', { name: 'מדויק', exact: true }).click();
  await page.getByRole('button', { name: 'נגמר אחרי 5 דקות', exact: true }).click();
  await shot('03b-add-more', true);
  await page.getByText('דירוג מפורט מתקדם').click();
  await shot('03c-add-detailed', true);
  // Folds: "more" open with "detailed" closed, then both open (chevrons down / up).
  await page.getByText('דירוג מפורט מתקדם').click();
  await page.locator('form.add details.more > summary').scrollIntoViewIfNeeded();
  await shot('03e-folds-outer-open');
  await page.getByText('דירוג מפורט מתקדם').click();
  await page.locator('form.add details.more > summary').scrollIntoViewIfNeeded();
  await shot('03f-folds-both-open');
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
  // Select mode: three picked, the bar, then the one confirmation (cancelled).
  await page.getByRole('button', { name: 'בחירה', exact: true }).click();
  for (const i of [1, 2, 5]) await page.locator('.roster li').nth(i).locator('.swipe-content > button').click();
  await page.locator('.roster li').nth(2).scrollIntoViewIfNeeded();
  await shot('03g-select-mode');
  await checkLayout('select mode');
  await page.locator('.select-bar').getByRole('button', { name: 'מחיקה' }).click();
  await shot('03h-multi-confirm');
  await page.locator('.sheet').getByRole('button', { name: 'ביטול' }).click();
  await page.locator('.select-bar').getByRole('button', { name: 'ביטול' }).click();
  await page.getByRole('button', { name: /^חזרה$/ }).click();
  await page.getByRole('button', { name: 'עושים כוחות' }).click();
  await page.waitForSelector('.team');
  await shot('05-teams');
  await shot('05b-teams-full', true);
  await page.getByText('פירוט האיזון').click();
  await page.locator('details.fold[open] > summary').first().scrollIntoViewIfNeeded();
  await shot('05c-teams-fold-open');
  await page.locator('details.fold[open] > summary').first().click();
  await page.evaluate(() => scrollTo(0, 0));
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
  // Match length (v5): the sheet from the chip under the clock; +1 minute for this match; no timer.
  await page.waitForSelector('.goal-burst', { state: 'detached', timeout: 8000 }).catch(() => {});
  await page.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
  await page.getByRole('button', { name: /^אורך המשחק/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '+1 דק׳' }).click();
  await shot('09b-match-length');
  await checkLayout('match length sheet');
  await page.getByRole('dialog').locator('label.toggle').click();
  await shot('09c-match-no-timer');
  await page.getByRole('dialog').locator('label.toggle').click();
  await page.getByRole('dialog').getByRole('button', { name: '+1 דק׳' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  await shot('09d-match-added-time');
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
  // A 1–1 decided on penalties: the sheet, then the optional shoot-out score.
  await page.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
  for (const side of [0, 1]) {
    await page.getByRole('button', { name: '+ גול' }).nth(side).click();
    await page.locator('.sheet').getByRole('button', { name: 'דילוג' }).click();
  }
  await page.waitForSelector('.goal-burst', { state: 'detached', timeout: 5000 }).catch(() => {});
  await page.getByRole('button', { name: 'סיום משחק' }).click();
  await shot('11a-pens-sheet');
  await checkLayout('penalties sheet');
  await page.locator('.sheet .pens-team').first().click();
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
  await page.evaluate(() => scrollTo(0, 0));
  await shot('11-settings', true);
  // Every fold open (v7), then the bibs fold with bibs switched on.
  await page.locator('details.settings-fold').evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
  await page.waitForTimeout(100);
  await shot('11b-settings-all-open', true);
  await checkLayout('settings (open)');
  await page.locator('details.settings-fold').evaluateAll((ds) => ds.forEach((d) => (d.open = false)));
  await page.locator('summary', { hasText: 'גופיות' }).click();
  await page.locator('summary', { hasText: 'גופיות' }).scrollIntoViewIfNeeded();
  await shot('11c-settings-bibs-off');
  await page.locator('label.toggle', { hasText: 'יש לכם גופיות' }).click();
  await shot('11d-settings-bibs-on');
  await page.locator('label.toggle', { hasText: 'יש לכם גופיות' }).click();
  await page.locator('summary', { hasText: 'גופיות' }).click();
  await checkLayout('settings');
  const dir = await page.evaluate(() => getComputedStyle(document.body).direction);
  if (dir !== 'rtl') errors.push(`${scheme}: direction is ${dir}`);

  // Add to home screen (v6): the card on the second use, on iPhone Safari, Instagram on iOS, and Android Chrome.
  const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const INSTA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0';
  for (const [name, ua] of [['16a-install-ios', IOS], ['16b-install-ios-inapp', INSTA], ['16c-install-android', null]]) {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: scheme,
      isMobile: true,
      hasTouch: true,
      locale: 'he-IL',
      reducedMotion: 'reduce',
      ...(ua ? { userAgent: ua } : {}),
    });
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(`${scheme} ${name}: ${e.message}`));
    await p.goto(base);
    await p.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
    await p.evaluate(() => {
      const f = JSON.parse(localStorage.getItem('kochot:install'));
      localStorage.setItem('kochot:install', JSON.stringify({ ...f, useAt: Date.now() - 13 * 3600e3 }));
    });
    await p.reload();
    if (!ua)
      await p.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        e.prompt = async () => {};
        e.userChoice = new Promise(() => {});
        window.dispatchEvent(e);
      });
    await p.waitForSelector('.install-card');
    // A reload restores the scroll anchor (the title), which now sits below the card; a real launch starts at the top.
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${out}/${scheme}-${name}.png` });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${name}: ${sw}px`);
    if (name === '16a-install-ios') {
      await p.getByRole('button', { name: 'הגדרות' }).click();
      await p.locator('summary', { hasText: 'גישה מהירה' }).click();
      await p.locator('.install-settings').scrollIntoViewIfNeeded();
      await p.waitForTimeout(150);
      await p.screenshot({ path: `${out}/${scheme}-16d-install-settings.png` });
    }
    await c.close();
  }
  await ctx.close();

  // Left early (v6): pick → confirm → the best sub comes in; then (no subs) a swap suggestion.
  {
    const lctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true, locale: 'he-IL', reducedMotion: 'reduce' });
    const pg = await lctx.newPage();
    pg.on('pageerror', (e) => errors.push(`${scheme} leave: ${e.message}`));
    pg.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(`${scheme} leave console: ${m.text()}`));
    const lshot = async (name) => {
      await pg.waitForTimeout(150);
      await pg.screenshot({ path: `${out}/${scheme}-${name}.png` });
      const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${name}: ${sw}px`);
    };
    await pg.goto(base);
    await pg.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
    await pg.getByRole('button', { name: 'עושים כוחות' }).click();
    await pg.waitForSelector('.team');
    await pg.getByRole('button', { name: /התחלת משחק/ }).click();
    await pg.getByRole('button', { name: 'התחלה' }).click();
    await pg.getByRole('button', { name: '+ גול' }).first().click();
    await pg.getByRole('button', { name: 'דילוג' }).click();
    await pg.getByRole('button', { name: 'סיום משחק' }).click();
    await pg.locator('.borrow').getByRole('button', { name: 'דילוג' }).click();
    await pg.getByRole('button', { name: /לקבוצות/ }).click();
    for (const name of ['אלון', 'ברק']) {
      await pg.getByRole('button', { name: /הגיע מאוחר/ }).click();
      await pg.getByPlaceholder('שם').fill(name);
      await pg.getByRole('button', { name: 'הצטרף' }).click();
      if (await pg.getByRole('button', { name: 'להשאיר ככה' }).isVisible()) await pg.getByRole('button', { name: 'להשאיר ככה' }).click();
    }
    await pg.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
    await pg.getByRole('button', { name: /עזב באמצע/ }).click();
    await lshot('16a-leave-pick');
    const outside = () => pg.getByRole('dialog').locator('.leave-team').filter({ hasNotText: 'על המגרש' }).filter({ hasNotText: 'מחליפים' }).first();
    await outside().locator('.member').first().click();
    await lshot('16b-leave-confirm');
    await pg.getByRole('button', { name: 'כן, הוא עזב' }).click();
    await lshot('16c-leave-sub');
    await pg.getByRole('dialog').getByRole('button', { name: /נכנס$/ }).first().click();
    await pg.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
    await lshot('16d-teams-after-leave');
    await pg.getByRole('button', { name: /חזרה למשחק/ }).click();
    await lshot('16e-match-leave-link');
    // No subs left: try the team outside until a swap is suggested (at most 3 leave).
    let swapShown = false;
    for (let n = 0; n < 3 && !swapShown; n++) {
      await pg.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
      await pg.getByRole('button', { name: 'מישהו עזב?' }).click();
      await outside().locator('.member').last().click();
      await pg.getByRole('button', { name: 'כן, הוא עזב' }).click();
      if (await pg.getByRole('dialog').isVisible()) {
        swapShown = true;
        await lshot('16f-leave-swaps');
        await pg.getByRole('button', { name: 'להשאיר ככה' }).click();
      }
    }
    if (!swapShown) console.log(`${scheme}: no swap suggestion came up`);
    await lctx.close();
  }
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
