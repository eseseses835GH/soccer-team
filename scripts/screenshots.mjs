// Visual smoke test: drives the built app at a 390px mobile viewport and saves screenshots.
// Usage: npm run build && npx vite preview --port 4173 & npm run screenshots -- [outDir]
import { chromium } from '@playwright/test';
import { quietWelcome } from './no-welcome.mjs';
import { mkdirSync } from 'node:fs';
import { ORG, playerContext, SB_URL } from './player-mock.mjs';
import { groupState, liveServer, organizerRoutes, playOnElsewhere, signInOrganizer } from './organizer-mock.mjs';
import { cloudRoutes, cloudServer, loginInSheet } from './cloud-mock.mjs';

const out = process.argv[2] ?? 'screenshots';
const base = process.env.BASE_URL ?? 'http://localhost:4173/';
mkdirSync(out, { recursive: true });

const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = quietWelcome(await chromium.launch({ executablePath: exe }));
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
  // Help: from the top bar "?", all folded, one question open, the icon legend.
  await page.getByRole('button', { name: 'שאלות ותשובות' }).click();
  await shot('02c-help');
  await checkLayout('help');
  await page.locator('#help-level > summary').click();
  await page.locator('#help-score > summary').click();
  await page.locator('#help-level').scrollIntoViewIfNeeded();
  await shot('02d-help-open');
  for (const id of ['icons-positions', 'icons-strengths', 'icons-weaknesses']) await page.locator(`#help-${id} > summary`).click();
  await page.evaluate(() => scrollTo(0, 0));
  await shot('02e-help-legend');
  await shot('02f-help-legend-full', true);
  await checkLayout('help legend');
  await page.getByLabel('חיפוש בשאלות').fill('שוער');
  await shot('02g-help-search');
  await page.getByRole('button', { name: /^חזרה$/ }).click();
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
  await page.getByPlaceholder('שם').fill('אורח');
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
  await shot('07b-late-choose');
  await checkLayout('late choose');
  await page.getByRole('button', { name: 'סגירה' }).click();
  await page.getByRole('button', { name: /התחלת משחק/ }).click();
  await page.waitForSelector('.clock');
  await page.getByRole('button', { name: /התחלה/ }).click();
  await page.getByRole('button', { name: '+ גול' }).first().click();
  await shot('08-scorer-sheet');
  await page.locator('.sheet .pick-list button').first().click();
  await shot('09-match');
  await checkLayout('match');
  await page.getByRole('button', { name: 'מישהו הגיע?' }).click();
  await page.getByPlaceholder('שם').fill('אורח');
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
  await page.waitForSelector('.goal-burst', { state: 'detached', timeout: 8000 }).catch(() => {});
  await shot('09l-late-choose-live');
  await checkLayout('late choose live');
  await page.getByRole('button', { name: 'סגירה' }).click();
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
      await p.goto(base + '#help/install');
      await p.locator('#help-install .install-settings').scrollIntoViewIfNeeded();
      await p.waitForTimeout(150);
      await p.screenshot({ path: `${out}/${scheme}-16d-install-settings.png` });
    }
    await c.close();
  }

  // Login sheet (v11): Google's own button (the real GIS script when online; this preview origin
  // isn't an authorized one, so GIS logs that, and it's ignored). Supabase's settings are mocked.
  if (SB_URL) {
    await page.route(/\/auth\/v1\/settings/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"external":{"google":true,"email":true}}' }));
    page.removeAllListeners('console');
    page.on('console', (m) => m.type() === 'error' && !/fonts\.g|GSI_LOGGER/.test(m.text()) && !/google\.com/.test(m.location()?.url ?? '') && errors.push(`${scheme} console: ${m.text()}`));
    await page.goto(base + '#settings');
    await page.locator('#set-account').evaluate((d) => (d.open = true));
    await page.getByRole('button', { name: 'התחברות', exact: true }).click();
    await page.locator('.gis-btn iframe, .sheet .btn-quiet:not(:disabled)').first().waitFor({ state: 'attached', timeout: 12000 });
    await page.waitForTimeout(1200);
    await shot('11e-login');
    await checkLayout('login');
    await page.getByRole('button', { name: 'סגירה' }).click();
    // Logged out past the free limits (v13): the 5th own player, and a second group.
    const waitLogin = async () => {
      await page.locator('.gis-btn iframe, .sheet .btn-quiet:not(:disabled)').first().waitFor({ state: 'attached', timeout: 12000 });
      await page.waitForTimeout(1200);
    };
    await page.goto(base + '#players');
    for (const n of ['רועי', 'שגיא', 'עידו', 'אורי', 'נדב', 'יואב']) {
      await page.getByPlaceholder('איך קוראים לו?').fill(n);
      await page.getByRole('button', { name: /^הוספה$/ }).click();
      if (await page.getByRole('dialog', { name: 'התחברות' }).count()) break;
    }
    await waitLogin();
    await page.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
    await shot('11f-login-players');
    await checkLayout('login for players');
    await page.getByRole('dialog', { name: 'התחברות' }).getByRole('button', { name: 'סגירה' }).click();
    await page.goto(base + '#home');
    await page.getByRole('button', { name: /החלפת קבוצה/ }).click();
    await page.getByRole('button', { name: /קבוצה חדשה/ }).click();
    await waitLogin();
    await shot('11g-login-group');
    await checkLayout('login for a group');
  }
  await ctx.close();

  // Logged in (mocked; v13: a new group needs a login): the new-group form.
  {
    const nctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true, locale: 'he-IL', reducedMotion: 'reduce' });
    await cloudRoutes(nctx, cloudServer());
    const np = await nctx.newPage();
    np.on('pageerror', (e) => errors.push(`${scheme} new group: ${e.message}`));
    await np.goto(base);
    await np.getByRole('button', { name: /החלפת קבוצה/ }).click();
    await np.getByRole('button', { name: /קבוצה חדשה/ }).click();
    await loginInSheet(np);
    await np.getByLabel('שם הקבוצה').fill('כדורגל בשכונה');
    await np.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
    await np.screenshot({ path: `${out}/${scheme}-13-new-group.png` });
    await nctx.close();
  }

  // WhatsApp import (v14): the sheet with the WhatsApp button + the export hint (contacts picker
  // stubbed, as on Android Chrome), the names checklist from the iPhone .zip, a quick-rating step.
  {
    const wctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true, locale: 'he-IL', reducedMotion: 'reduce' });
    await wctx.addInitScript(() => {
      navigator.contacts = { select: async () => [] };
    });
    const wp = await wctx.newPage();
    wp.on('pageerror', (e) => errors.push(`${scheme} wa: ${e.message}`));
    const wshot = async (name) => {
      await wp.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
      await wp.waitForTimeout(150);
      await wp.screenshot({ path: `${out}/${scheme}-${name}.png` });
      const sw = await wp.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${name}: ${sw}px`);
    };
    await wp.goto(base + '#players');
    await wp.getByPlaceholder('איך קוראים לו?').fill('אבי');
    await wp.getByRole('button', { name: /^הוספה$/ }).click();
    await wp.getByRole('button', { name: /ייבוא רשימה/ }).click();
    await wshot('03i-import-sheet');
    await wp.locator('details.wa-help > summary').click();
    await wshot('03j-import-wa-hint');
    await wp.getByLabel('קובץ לייבוא').setInputFiles(new URL('./fixtures/wa-chat-ios.zip', import.meta.url).pathname);
    await wp.locator('.wa-picks').waitFor();
    for (const n of ['נועם', 'ליאור', 'עומר', 'יוסי כהן']) await wp.getByRole('button', { name: n, exact: true }).click();
    await wshot('03k-import-picked');
    await wp.getByRole('button', { name: 'הוספת 3 שחקנים' }).click();
    const rating = wp.getByRole('dialog', { name: 'דירוג מהיר' });
    await rating.getByRole('radio', { name: '7', exact: true }).click();
    await rating.getByRole('button', { name: 'הגנה', exact: true }).click();
    await wshot('03l-quick-rate');
    await wctx.close();
  }

  // Bench add and leave cases (v15): a sub waits (6 players at 4-a-side, 3×3 + 1 sub), "להוסיף
  // לקבוצה…" → the team step; then mid-match someone on the pitch leaves → the confirm with its case line.
  {
    const bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true, locale: 'he-IL', reducedMotion: 'reduce' });
    const bp = await bctx.newPage();
    bp.on('pageerror', (e) => errors.push(`${scheme} bench: ${e.message}`));
    const bshot = async (name) => {
      await bp.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
      await bp.waitForTimeout(150);
      await bp.screenshot({ path: `${out}/${scheme}-${name}.png` });
      const sw = await bp.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${name}: ${sw}px`);
    };
    await bp.goto(base);
    await bp.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
    await bp.getByRole('button', { name: 'ניקוי' }).click();
    for (let i = 0; i < 6; i++) await bp.locator('.attend label').nth(i).click();
    await bp.getByRole('radiogroup', { name: 'כמה בקבוצה' }).getByRole('radio', { name: '4' }).click();
    await bp.getByRole('button', { name: 'עושים כוחות' }).click();
    await bp.waitForSelector('.team');
    for (let n = 0; n < 2; n++) {
      await bp.getByRole('button', { name: /הגיע מאוחר/ }).click();
      await bp.locator('.pick-list button').first().click();
      await bp.getByRole('button', { name: /^מחכה בצד$/ }).click();
    }
    await bp.locator('.bench .member').first().click();
    await bp.locator('.bench').scrollIntoViewIfNeeded();
    await bshot('06b-sub-selected');
    await bp.getByRole('button', { name: 'להוסיף לקבוצה…' }).click();
    await bshot('06c-bench-add');
    await bp.getByRole('dialog').getByRole('button', { name: 'סגירה' }).click();
    await bp.getByRole('button', { name: /התחלת משחק/ }).click();
    await bp.getByRole('button', { name: 'התחלה' }).click();
    await bp.getByRole('button', { name: 'מישהו עזב?' }).click();
    await bp.getByRole('dialog').locator('.leave-team').first().locator('.member').first().click();
    await bshot('09m-leave-confirm-live');
    await bctx.close();
  }

  // Organizers sheet with the player link and players who joined (v10): a mocked session, every
  // Supabase call answered locally (nothing reaches the real project).
  {
    const octx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true, locale: 'he-IL', reducedMotion: 'reduce' });
    const pg = await octx.newPage();
    pg.on('pageerror', (e) => errors.push(`${scheme} org: ${e.message}`));
    pg.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(`${scheme} org console: ${m.text()}`));
    const ME = '00000000-0000-4000-8000-0000000000aa';
    const calls = [];
    let roster = [];
    let members = [];
    await pg.routeWebSocket(/supabase\.co/, () => {}); // realtime: accepted, silent
    await pg.route(/supabase\.co/, async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      calls.push(`${req.method()} ${u.pathname}`);
      if (u.pathname.endsWith('/rest/v1/groups')) {
        if (req.method() === 'GET') return json({ id: u.searchParams.get('id').slice(3), name: 'שישי בשכונה', version: 1, data: { v: 1, players: roster, constraints: { together: [], apart: [] } } });
        return json([{ version: 2 }]);
      }
      if (u.pathname.endsWith('/rest/v1/group_invites')) {
        if (u.searchParams.get('role') === 'eq.player') return json([{ token: 'player-token' }]);
        return json([]);
      }
      const rpc = u.pathname.split('/rpc/')[1];
      if (rpc === 'group_organizers') return json([{ user_id: ME, display_name: 'אלי', joined_at: '2026-10-18T10:00:00Z', is_me: true }]);
      if (rpc === 'group_members_list') return json(members);
      if (rpc === 'group_votes') return json([]);
      if (rpc === 'live_get') return json([]);
      return json(null);
    });
    await pg.goto(base);
    await pg.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
    await pg.waitForTimeout(200);
    roster = await pg.evaluate(() => {
      const idx = JSON.parse(localStorage.getItem('kochot:groups'));
      return JSON.parse(localStorage.getItem(`kochot:group:${idx.currentId}`)).players;
    });
    const at = (n) => `2026-10-${n}T18:00:00Z`;
    members = [
      { user_id: ME, display_name: 'אלי', role: 'organizer', player_id: null, can_rate: false, joined_at: at(18), is_me: true },
      { user_id: 'u1', display_name: 'Moshe Levi', role: 'player', player_id: roster[0].id, can_rate: true, joined_at: at(19), is_me: false },
      { user_id: 'u2', display_name: 'דני', role: 'player', player_id: roster[3].id, can_rate: false, joined_at: at(20), is_me: false },
      { user_id: 'u3', display_name: 'yossi.k', role: 'player', player_id: null, can_rate: false, joined_at: at(21), is_me: false },
    ];
    await pg.evaluate((me) => {
      const idx = JSON.parse(localStorage.getItem('kochot:groups'));
      idx.groups = idx.groups.map((g) => (g.id === idx.currentId ? { ...g, name: 'שישי בשכונה', synced: true } : g));
      localStorage.setItem('kochot:groups', JSON.stringify(idx));
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const user = { id: me, aud: 'authenticated', role: 'authenticated', email: 'eli@example.com', app_metadata: {}, user_metadata: { name: 'אלי' }, created_at: '2026-10-18T10:00:00Z' };
      const access_token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: me, exp, role: 'authenticated', aud: 'authenticated', email: user.email })}.c2ln`;
      localStorage.setItem('sb-cieyeoyuwddobrxjcffw-auth-token', JSON.stringify({ access_token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user }));
    }, ME);
    await pg.reload();
    await pg.goto(base + '#settings');
    await pg.getByRole('button', { name: 'מארגנים והזמנות' }).click();
    await pg.getByText('שחקנים שהתחברו').waitFor();
    await pg.waitForTimeout(200);
    await pg.screenshot({ path: `${out}/${scheme}-17a-organizers-players.png` });
    await pg.getByRole('dialog').locator('.org-list.members li').last().scrollIntoViewIfNeeded();
    await pg.waitForTimeout(150);
    await pg.screenshot({ path: `${out}/${scheme}-17b-organizers-members.png` });
    await pg.getByRole('button', { name: 'הסרה של דני' }).click();
    await pg.waitForTimeout(150);
    await pg.screenshot({ path: `${out}/${scheme}-17c-member-menu.png` });
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 390) errors.push(`${scheme}: horizontal overflow on organizers: ${sw}px`);
    if (!calls.some((c) => c.endsWith('/rpc/group_members_list'))) errors.push(`${scheme}: members were never asked for`);
    await octx.close();
  }

  // Runner handoff, organizer side (v12), mocked: a player runs tonight → read-only with whose
  // phone → home → take it back (his goal imported).
  {
    const hctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true, locale: 'he-IL', reducedMotion: 'reduce' });
    const pg = await hctx.newPage();
    pg.on('pageerror', (e) => errors.push(`${scheme} handoff: ${e.message}`));
    pg.on('console', (m) => m.type() === 'error' && !/fonts\.g|409|404/.test(m.text()) && errors.push(`${scheme} handoff console: ${m.text()}`));
    const hshot = async (name, full = false) => {
      await pg.waitForTimeout(200);
      await pg.screenshot({ path: `${out}/${scheme}-${name}.png`, fullPage: full });
      const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${name}: ${sw}px`);
    };
    const srv = liveServer();
    await organizerRoutes(pg, srv);
    await pg.goto(base);
    await pg.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
    await pg.waitForTimeout(200);
    srv.roster = (await groupState(pg)).app.players;
    await signInOrganizer(pg);
    await pg.reload();
    await pg.getByRole('button', { name: 'עושים כוחות' }).click();
    await pg.waitForSelector('.team');
    await pg.getByRole('button', { name: /התחלת משחק/ }).click();
    await pg.getByRole('button', { name: /התחלה/ }).click();
    await pg.waitForTimeout(1600);
    playOnElsewhere(srv);
    await pg.reload();
    await pg.getByText('מנוהל מהטלפון של דני').waitFor();
    await hshot('18a-handoff-viewer');
    await hshot('18b-handoff-viewer-full', true);
    await pg.goto(base + '#home');
    await pg.getByText('מנוהל מהטלפון של דני').waitFor();
    await hshot('18c-handoff-home');
    await pg.getByRole('button', { name: /^לערב/ }).click();
    await pg.getByRole('button', { name: 'לקחת את הניהול בחזרה' }).click();
    await pg.getByRole('button', { name: '+ גול' }).first().waitFor();
    await hshot('18d-handoff-taken-back');
    await hctx.close();
  }

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
    for (const [name, choice] of [['אלון', /^נכנס עכשיו/], ['ברק', /^מחכה בצד$/]]) {
      await pg.getByRole('button', { name: /הגיע מאוחר/ }).click();
      await pg.getByPlaceholder('שם').fill(name);
      await pg.getByRole('button', { name: 'המשך' }).click();
      await pg.getByRole('button', { name: choice }).click();
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
    // No subs left, between matches, 3 teams: the two on the pitch and the next one in are locked,
    // so nothing is offered (v15).
    await pg.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
    await pg.getByRole('button', { name: 'מישהו עזב?' }).click();
    await outside().locator('.member').last().click();
    await pg.getByRole('button', { name: 'כן, הוא עזב' }).click();
    if (await pg.getByRole('dialog').isVisible()) errors.push(`${scheme}: a swap was offered with every team locked`);
    await lctx.close();
  }

  // Player side (v10), on a mocked Supabase: who are you → live evening (me highlighted) → rating → no evening.
  if (SB_URL) {
    const { ctx: pctx, page: pp, db } = await playerContext(browser, { scheme, me: null, canRate: true, live: true });
    pp.on('pageerror', (e) => errors.push(`${scheme} player: ${e.message}`));
    pp.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(`${scheme} player console: ${m.text()}`));
    const pshot = async (name, full = false) => {
      await pp.waitForTimeout(200);
      await pp.screenshot({ path: `${out}/${scheme}-${name}.png`, fullPage: full });
      const sw = await pp.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${name}: ${sw}px`);
    };
    await pp.goto(base);
    await pp.waitForSelector('.claim-grid');
    await pshot('p01-claim');
    await pp.getByRole('button', { name: 'גיל', exact: true }).click();
    await pp.waitForSelector('.live');
    await pshot('p02-home-live');
    await pshot('p02b-home-live-full', true);
    if (!(await pp.locator('.member.me', { hasText: 'גיל' }).count())) errors.push(`${scheme} player: "me" not highlighted`);
    await pp.getByRole('button', { name: 'לדרג' }).click();
    await pp.waitForSelector('.rate-levels');
    await pshot('p03-survey');
    await pp.getByRole('radio', { name: '7' }).click();
    await pp.getByRole('button', { name: 'דילוג' }).click();
    await pp.getByRole('radio', { name: '4' }).click();
    await pshot('p03b-survey-step');
    if (JSON.stringify(db.votes) !== JSON.stringify({ p1: 7, p4: 4 })) errors.push(`${scheme} player: votes ${JSON.stringify(db.votes)}`);
    await pp.getByRole('button', { name: 'סיום' }).click();
    await pp.waitForSelector('.rate-card');
    await pshot('p04-home-update');
    await pp.getByRole('button', { name: /החלפת קבוצה/ }).click();
    await pshot('p05-groups');
    await pp.keyboard.press('Escape');
    await pp.getByRole('button', { name: 'ערבים קודמים' }).click();
    await pshot('p06-history');
    await pp.locator('.ev-list button').first().click();
    await pshot('p06b-evening', true);
    if (await pp.getByRole('button', { name: 'מחיקה מההיסטוריה' }).count()) errors.push(`${scheme} player: delete shown on an evening`);
    await pp.goto(base + '#settings');
    await pshot('p07-settings');
    db.live = false;
    await pp.goto(base + '#home');
    await pp.reload();
    await pp.waitForSelector('text=אין ערב עכשיו');
    await pshot('p08-no-evening');
    await pctx.close();

    // A player runs the match from his phone (v12): viewer → confirm → controls → the organizer takes it back.
    const { ctx: rctx, page: rp, db: rdb } = await playerContext(browser, { scheme, me: 'p3', canRate: false, live: true });
    rp.on('pageerror', (e) => errors.push(`${scheme} runner: ${e.message}`));
    const rshot = async (name, full = false) => {
      await rp.waitForTimeout(250);
      await rp.screenshot({ path: `${out}/${scheme}-${name}.png`, fullPage: full });
      const sw = await rp.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${name}: ${sw}px`);
    };
    await rp.goto(base);
    await rp.waitForSelector('.live');
    await rshot('p09-run-viewer');
    await rp.getByRole('button', { name: 'לנהל מהטלפון שלי' }).click();
    await rshot('p09b-run-confirm');
    await rp.getByRole('dialog').getByRole('button', { name: 'לנהל מהטלפון שלי' }).click();
    await rp.waitForSelector('.clock-ctrl');
    await rshot('p10-runner');
    await rshot('p10b-runner-full', true);
    rdb.runner = ORG;
    rdb.runnerName = 'אלי';
    rdb.rev++;
    await rp.locator('.btn-goal').first().click();
    await rp.getByRole('dialog').getByRole('button', { name: 'דילוג' }).click();
    await rp.waitForSelector('.live');
    await rp.getByText('הניהול עבר לאלי').waitFor();
    await rshot('p11-run-lost');
    await rctx.close();

    // v15: the runner marks arrivals and leaves (ליאור isn't here tonight).
    const { ctx: lctx, page: lp, db: ldb } = await playerContext(browser, { scheme, me: 'p3', canRate: false, live: true });
    lp.on('pageerror', (e) => errors.push(`${scheme} runner late: ${e.message}`));
    ldb.data.teams[2].ids = ldb.data.teams[2].ids.filter((id) => id !== 'p12');
    ldb.data.players = ldb.data.players.filter((p) => p.id !== 'p12');
    const lshot = async (name, full = false) => {
      await lp.waitForTimeout(250);
      await lp.screenshot({ path: `${out}/${scheme}-${name}.png`, fullPage: full });
      const sw = await lp.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${name}: ${sw}px`);
    };
    await lp.goto(base);
    await lp.waitForSelector('.live');
    await lp.getByRole('button', { name: 'לנהל מהטלפון שלי' }).click();
    await lp.getByRole('dialog').getByRole('button', { name: 'לנהל מהטלפון שלי' }).click();
    await lp.waitForSelector('.clock-ctrl');
    await lp.getByRole('button', { name: 'מישהו הגיע?' }).scrollIntoViewIfNeeded();
    await lshot('p12-runner-links');
    await lp.getByRole('button', { name: 'מישהו הגיע?' }).click();
    await lshot('p12b-runner-late-pick');
    await lp.getByRole('dialog').getByRole('button', { name: 'ליאור' }).click();
    await lshot('p12c-runner-late-choose');
    await lp.getByRole('dialog').getByRole('button', { name: /^נכנס עכשיו/ }).click();
    await lp.getByText('ליאור השלים').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await lp.getByRole('button', { name: 'מישהו עזב?' }).click();
    await lp.getByRole('dialog').getByRole('button', { name: 'יוסי' }).click();
    await lp.getByRole('dialog').getByRole('button', { name: 'כן, הוא עזב' }).click();
    await lshot('p12d-runner-leave-sub');
    await lctx.close();
  }

  // My page (v17): the avatar in the top bar (Google photo, then the letter), "הדף שלי" with a
  // player group and an organizer group, my numbers, last evenings; the organizer's "who am I".
  if (SB_URL) {
    for (const [tag, opts] of [
      ['photo', { google: true, orgMe: 'o1' }],
      ['letter', { google: false, orgMe: null }],
    ]) {
      const { ctx: mctx, page: mp } = await playerContext(browser, { scheme, me: 'p3', canRate: false, live: false, org: true, ...opts });
      mp.on('pageerror', (e) => errors.push(`${scheme} me: ${e.message}`));
      mp.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(`${scheme} me console: ${m.text()}`));
      const mshot = async (name, full = false) => {
        await mp.waitForTimeout(250);
        await mp.screenshot({ path: `${out}/${scheme}-${name}.png`, fullPage: full });
        const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
        if (sw > 390) errors.push(`${scheme}: horizontal overflow on ${name}: ${sw}px`);
      };
      await mp.goto(base);
      await mp.getByRole('button', { name: 'הדף שלי' }).waitFor();
      await mp.waitForTimeout(400);
      await mshot(`me01-topbar-${tag}`);
      await mp.getByRole('button', { name: 'הדף שלי' }).click();
      await mp.getByRole('heading', { name: 'הקבוצות שלי' }).waitFor();
      await mshot(`me02-page-${tag}`, true);
      if (tag === 'letter') {
        await mp.getByRole('button', { name: 'עוד לא בחרת מי אתה' }).click();
        await mshot('me03-org-claim');
      }
      await mctx.close();
    }
  }
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
