// Functional smoke test of the main flows against `vite preview` (see README).
import { chromium } from '@playwright/test';
import { quietWelcome } from './no-welcome.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { GID, ME, ORG, playerContext, SB_URL } from './player-mock.mjs';
import { liveServer, organizerRoutes, ORG_ME, groupState, playOnElsewhere, signInOrganizer } from './organizer-mock.mjs';
import { cloudRoutes, cloudServer, loginInSheet } from './cloud-mock.mjs';

const base = process.env.BASE_URL ?? 'http://localhost:4173/';
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = quietWelcome(await chromium.launch({ executablePath: exe }));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const assert = (c, m) => {
  if (!c) errors.push(m);
};
// The share picture: stub the share sheet, keep the file, check it's a 1080-wide PNG and save it to look at.
const shareOut = process.env.SHARE_OUT ?? `${tmpdir()}/kochot-share`;
async function sharePicture(pg, file) {
  await pg.evaluate(() => {
    window.__share = null;
    navigator.canShare = (d) => !!d?.files?.length;
    navigator.share = async (d) => {
      const f = d.files[0];
      const url = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(f);
      });
      const img = new Image();
      img.src = url;
      await img.decode();
      window.__share = { name: f.name, type: f.type, text: d.text, url, width: img.naturalWidth, height: img.naturalHeight };
    };
  });
  await pg.getByRole('button', { name: 'שיתוף', exact: true }).click();
  await pg.waitForFunction(() => window.__share, null, { timeout: 10000 });
  const sh = await pg.evaluate(() => window.__share);
  assert(sh.type === 'image/png' && sh.width === 1080 && sh.height > 400, `share picture: ${sh.type} ${sh.width}x${sh.height}`);
  assert(sh.text === 'הכוחות להערב ⚽', `share text with the picture: ${sh.text}`);
  mkdirSync(shareOut, { recursive: true });
  writeFileSync(`${shareOut}/${file}`, Buffer.from(sh.url.split(',')[1], 'base64'));
}
const back = () => page.getByRole('button', { name: /^חזרה$/ }).click();
const teamSizes = () => page.locator('.team').evaluateAll((cs) => cs.map((c) => c.querySelectorAll('.member').length));
const teamOf = (name) =>
  page.locator('.team').evaluateAll((cs, n) => cs.findIndex((c) => [...c.querySelectorAll('.name')].some((x) => x.textContent === n)), name);

// Supabase is mocked for this phone: it logs in from the login sheet at step 3 (v13), then syncs.
const cloud = cloudServer();
await cloudRoutes(ctx, cloud);
await page.goto(base);

// 1. Quick add with level + positions + card (cards and sliders are folded under "עוד על השחקן"), duplicate rejected.
await page.getByRole('button', { name: 'הוספת שחקנים' }).click();
const more = page.locator('form.add details.more');
assert(!(await more.evaluate((d) => d.open)), '"more about the player" starts folded');
for (const [n, lvl, positions, cards] of [['אלון', '7', ['התקפה'], ['גורילה']], ['Ben', '4', ['טוב בשער', 'הגנה', 'קישור'], ['איטי', 'מפחד מהכדור']], ['גיא', '9', [], ['קוסם']]]) {
  await page.getByPlaceholder('איך קוראים לו?').fill(n);
  await page.getByRole('radio', { name: lvl, exact: true }).click();
  for (const pos of positions) await page.getByRole('button', { name: pos, exact: true }).click();
  if (!(await more.evaluate((d) => d.open))) await page.getByText('עוד על השחקן').click();
  for (const card of cards) await page.getByRole('button', { name: card, exact: true }).click();
  if (n === 'Ben') {
    // Optional detailed rating in quick add: shooting slider 4-2 → 6.
    await page.getByText('דירוג מפורט מתקדם').click();
    await page.getByLabel('בעיטה').fill('6');
    await page.getByText('דירוג מפורט מתקדם').click();
  }
  await page.getByRole('button', { name: /^הוספה$/ }).click();
}
assert((await page.locator('.roster li').count()) === 3, 'quick add should create 3 players');
const ben = await page.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)).players.find((p) => p.name === 'Ben'));
assert(JSON.stringify(ben.cards) === '["slow","scared"]', `Ben's cards ${JSON.stringify(ben.cards)}`);
assert(ben.attrs.shooting === 6 && ben.attrs.stamina === 2 && ben.attrs.overall === 4, `Ben's ratings ${JSON.stringify(ben.attrs)}`);
assert(ben.canGK === true && JSON.stringify(ben.positions) === '["def","mid"]', `Ben's positions ${ben.canGK} ${JSON.stringify(ben.positions)}`);
assert((await page.locator('.roster li', { hasText: 'Ben' }).locator('.pos-badges').getAttribute('aria-label')) === 'טוב בשער, הגנה, קישור', 'position emojis in the roster');
// The edit sheet opens "more" (he has cards) and the sliders (hand-tuned); removing a position saves.
await page.locator('.roster li', { hasText: 'Ben' }).locator('.swipe-content > button').click();
assert(await page.locator('.sheet details.more').evaluate((d) => d.open), 'edit sheet opens "more" for a player with cards');
assert(await page.locator('.sheet details.detailed').evaluate((d) => d.open), 'edit sheet opens the sliders for a hand-tuned player');
await page.locator('.sheet').getByRole('button', { name: 'קישור', exact: true }).click();
await page.locator('.sheet').getByRole('button', { name: 'שמירה' }).click();
const ben2 = await page.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)).players.find((p) => p.name === 'Ben'));
assert(JSON.stringify(ben2.positions) === '["def"]' && ben2.canGK, `Ben's positions after edit ${JSON.stringify(ben2.positions)}`);
await page.getByPlaceholder('איך קוראים לו?').fill('גיא');
await page.getByRole('button', { name: /^הוספה$/ }).click();
assert(await page.getByText('כבר יש שחקן בשם הזה').isVisible(), 'duplicate name error');

// 2. Not enough players.
await back();
assert(await page.getByRole('button', { name: 'עושים כוחות' }).isDisabled(), 'split disabled with 3 players');
assert(await page.getByText(/צריך לפחות 4 שחקנים/).isVisible(), 'not-enough hint');

// 3. Import a pasted list (19 more players → 22). Logged out that's past the 4 free players (v13):
// the login sheet opens; after logging in the import goes through and the group is uploaded by itself.
await page.getByRole('button', { name: 'השחקנים' }).click();
await page.getByRole('button', { name: /ייבוא רשימה/ }).click();
const list = Array.from({ length: 19 }, (_, i) => `שחקן ${i + 1}, ${1 + (i % 10)}${i === 3 ? ', שוער' : ''}${i === 5 ? ', הסלע' : ''}${i % 4 === 1 ? ', הגנה' : ''}${i % 4 === 2 ? ', חלוץ קשר' : ''}`).join('\n');
await page.getByLabel('רשימת שחקנים').fill(list + '\nאלון 5');
assert(await page.getByText('19 שחקנים מוכנים, אחד דולג').isVisible(), 'import preview counts');
await page.getByRole('button', { name: /הוספת 19 שחקנים/ }).click();
assert(await page.getByRole('dialog', { name: 'התחברות' }).getByText('כדי להוסיף עוד שחקנים צריך להתחבר').isVisible(), 'gate: import past 4 asks to log in');
assert((await page.locator('.roster li').count()) === 3, 'gate: nothing imported before the login');
// Closing the login sheet drops the action; trying again asks again.
await page.getByRole('dialog', { name: 'התחברות' }).getByRole('button', { name: 'סגירה' }).click();
assert((await page.locator('.roster li').count()) === 3 && cloud.logins === 0, 'gate: closing the login adds nobody');
await page.getByRole('button', { name: /הוספת 19 שחקנים/ }).click();
await loginInSheet(page);
await page.waitForFunction(() => document.querySelectorAll('.roster li').length === 22, null, { timeout: 5000 }).catch(() => {});
assert((await page.locator('.roster li').count()) === 22, 'import adds 19 after logging in');
assert(!(await page.getByLabel('רשימת שחקנים').count()), 'the import sheet closes after the login');
await page.waitForFunction(() => JSON.parse(localStorage.getItem('kochot:groups')).groups[0].synced, null, { timeout: 5000 }).catch(() => {});
const up = cloud.calls.filter((c) => c.rpc === 'create_group');
assert(up.length === 1 && up[0].body.p_data.players.length >= 3, `the local group is uploaded after login (${up.length} uploads, ${up[0]?.body.p_data.players.length} players)`);
assert(await page.evaluate(() => JSON.parse(localStorage.getItem('kochot:groups')).groups[0].synced), 'the local group is a cloud group now');
await page.waitForFunction(() => JSON.parse(localStorage.getItem('kochot:sync:' + JSON.parse(localStorage.getItem('kochot:groups')).currentId) ?? 'null')?.base?.players?.length === 22, null, { timeout: 8000 }).catch(() => errors.push('the imported players reach the server'));
await back();

// 4. Persistence across reload; tick everyone; 22 players, 5-a-side → 4 teams of 5 + 2 subs.
await page.reload();
await page.getByRole('button', { name: /^כולם$/ }).click();
assert(await page.getByText('5 נגד 5 · 2 קבוצות בחוץ · 2 מחליפים').isVisible(), 'plan sentence for 22 @5');
const t0 = Date.now();
await page.getByRole('button', { name: 'עושים כוחות' }).click();
await page.waitForSelector('.team');
const dt = Date.now() - t0;
assert(dt < 1500, `split took ${dt}ms`);
assert((await page.locator('.team .team-pos').count()) === (await page.locator('.team').count()), 'position line on every team');
assert(JSON.stringify(await teamSizes()) === '[5,5,5,5]', `sizes ${await teamSizes()}`);
assert((await page.locator('.bench .member').count()) === 2, 'two subs');

// 5. Re-roll changes the split.
const snap = () => page.locator('.team').evaluateAll((cs) => cs.map((c) => [...c.querySelectorAll('.name')].map((n) => n.textContent).sort().join(',')).sort().join('|'));
const before = await snap();
await page.getByRole('button', { name: /הגרלה מחדש/ }).click();
await page.waitForTimeout(400);
assert((await snap()) !== before, 're-roll should change teams');

// 6. Late arrival: a third sub → a new short team (3), no reshuffle of the others.
const beforeLate = await snap();
await page.getByRole('button', { name: /הגיע מאוחר/ }).click();
await page.getByPlaceholder('שם').fill('מאחר');
await page.getByRole('button', { name: 'המשך' }).click();
assert((await page.getByRole('dialog').locator('.lead').innerText()) === 'עוד לא התחיל משחק', 'late: no match yet');
await page.getByRole('button', { name: /^נכנס עכשיו · קבוצה חדשה$/ }).click();
assert(JSON.stringify(await teamSizes()) === '[5,5,5,5,3]', `late → new team, sizes ${await teamSizes()}`);
const afterLate = (await snap()).split('|');
assert(beforeLate.split('|').every((team) => afterLate.includes(team)), 'existing teams untouched by a late arrival');

// 7. Match night: goal, end, the losing team goes to the back of the queue.
await page.getByRole('button', { name: /התחלת משחק/ }).click();
await page.getByRole('button', { name: /התחלה/ }).click();
await page.getByRole('button', { name: '+ גול' }).nth(1).click();
await page.getByRole('button', { name: 'דילוג' }).click();
await page.getByRole('button', { name: 'סיום משחק' }).click();
const pitch = await page.locator('.side h2').allInnerTexts();
assert(pitch[0] !== 'קבוצה 1' || pitch[1] !== 'קבוצה 2', `after a loss the pitch should change: ${pitch}`);
assert(await page.getByText('טבלת הערב').isVisible(), 'standings shown');
await page.getByRole('button', { name: /לקבוצות/ }).click();
assert(await page.getByRole('button', { name: /חזרה למשחק/ }).isVisible(), 'match continues');

// 7b. One more match with a scorer, then "end the evening" → summary → history.
await page.getByRole('button', { name: /חזרה למשחק/ }).click();
await page.getByRole('button', { name: /התחלה/ }).click();
for (let i = 0; i < 2; i++) {
  await page.getByRole('button', { name: '+ גול' }).first().click();
  await page.locator('.sheet .pick-list button').first().click();
}
await page.getByRole('button', { name: 'סיום משחק' }).click();
// 7c. A 0–0 decided on penalties (one tap, no shoot-out score): the winner stays, the loser goes to the back of the queue.
{
  const [first, second] = await page.locator('.side h2').allInnerTexts();
  await page.getByRole('button', { name: 'סיום משחק' }).click();
  const sheet = page.locator('.sheet');
  assert(await sheet.getByRole('heading', { name: 'תיקו. מי ניצחה בפנדלים?' }).isVisible(), 'penalties sheet on a draw');
  assert(await sheet.getByRole('button', { name: 'בלי פנדלים, תיקו' }).isVisible(), 'plain draw still offered');
  assert((await sheet.locator('.stepper').count()) === 0, 'no shoot-out score to fill in');
  await sheet.getByRole("button", { name: first, exact: true }).click();
  const after = await page.locator('.side h2').allInnerTexts();
  assert(after.includes(first) && !after.includes(second), `penalty winner stays: ${after}`);
  const m = await page.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)).match);
  const last = m.history[m.history.length - 1];
  assert(last.goalsA === 0 && last.goalsB === 0 && last.pens?.winner === last.a && last.pens.a === undefined, `pens recorded: ${JSON.stringify(last.pens)}`);
  assert(m.queue[m.queue.length - 1] === last.b && last.out === last.b, 'penalty loser to the back of the queue');
}
await page.getByRole('button', { name: 'סיום הערב' }).click();
await page.locator('.sheet').getByRole('button', { name: 'סיום הערב' }).click();
await page.waitForSelector('.evening');
const summary = await page.locator('.evening').innerText();
assert(/קבוצה \d לקחה את הערב/.test(summary), 'summary names the evening winner');
assert(summary.includes('מלך השערים'), 'summary shows the top scorer');
await page.waitForTimeout(1200); // the totals count up
const totals = await page.locator('.ev-stats dd').allInnerTexts();
assert(totals[0] === '3' && totals[1] === '3', `summary totals: ${totals}`);
assert(summary.includes('הוכרע בפנדלים'), 'summary mentions the penalty match');
await page.locator('.evening details').first().evaluate((d) => (d.open = true));
assert(/פנדלים/.test(await page.locator('.ev-matches').innerText()), 'match list marks the penalty match');
await back();
assert((await page.locator('.ev-list li').count()) === 1, 'history lists the evening');
await page.getByRole('radio', { name: 'כל הזמנים' }).click();
assert(await page.getByText('מלכי השערים').isVisible(), 'all-time scorers');
await back();
assert(await page.getByRole('button', { name: 'ערבים קודמים' }).isVisible(), 'history icon on the main screen');

// 8. Keep-apart pair is respected on a fresh split.
await page.getByRole('button', { name: 'הגדרות' }).click();
// Settings v7: only "משחק" is open; everything else is a fold (except "חשבון", open by default since 61ce017).
assert((await page.locator('details.settings-fold[open]:not(#set-account)').count()) === 0, 'settings folds start closed');
assert(await page.getByText('אורך משחק').isVisible(), 'game settings open');
assert(/גופיות\s*· אין/.test(await page.locator('details.settings-fold > summary', { hasText: 'גופיות' }).innerText()), 'bibs summary says none');
await page.locator('summary', { hasText: 'מי עם מי' }).click();
await page.getByLabel('שחקן ראשון').selectOption({ label: 'אלון' });
await page.getByLabel('שחקן שני').selectOption({ label: 'גיא' });
await page.getByRole('button', { name: 'הוספת כלל' }).click();
assert(await page.getByText(/אלון וגיא\s*· לא באותה קבוצה/).isVisible(), 'rule listed in plain words');
assert(/מי עם מי\s*· 1/.test(await page.locator('summary', { hasText: 'מי עם מי' }).innerText()), 'rules summary counts');
await back();
await page.getByRole('button', { name: 'עושים כוחות' }).click();
await page.waitForSelector('.team');
const ta = await teamOf('אלון');
const tg = await teamOf('גיא');
assert(ta === -1 || tg === -1 || ta !== tg, 'keep-apart respected');
// A match left half-played (no "end the evening")…
await page.getByRole('button', { name: /התחלת משחק/ }).click();
await page.getByRole('button', { name: '+ גול' }).first().click();
await page.getByRole('button', { name: 'דילוג' }).click();

// 9. A new game day starts with empty attendance and offers "same as last time".
await page.evaluate(() => {
  const key = `kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`;
  const s = JSON.parse(localStorage.getItem(key));
  s.dayAt = Date.now() - 13 * 3600 * 1000;
  localStorage.setItem(key, JSON.stringify(s));
});
await page.goto(base + '#home');
await page.reload();
assert(await page.getByText(/^0$/).first().isVisible(), 'attendance reset');
assert(await page.getByRole('button', { name: /כמו בפעם הקודמת/ }).isVisible(), 'same-as-last offered');
// …is saved to the history by the new-day reset.
await page.getByRole('button', { name: 'ערבים קודמים' }).click();
assert((await page.locator('.ev-list li').count()) === 2, 'new-day reset saved the unfinished evening');
await back();

// 10. Backup file → restore on another phone (players screen → "ייבוא רשימה"). The roster link is gone
// from Settings (v8), but an old #import= link that was already sent still opens.
await page.getByRole('button', { name: 'הגדרות' }).click();
await page.locator('summary', { hasText: /^גיבוי/ }).click();
assert((await page.getByRole('button', { name: /שליחת קישור/ }).count()) === 0, 'no roster link in Settings');
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'הורדת קובץ גיבוי' }).click()]);
const backupFile = await download.path();
{
  // Logged out, 23 players are past the free 4 (v13): log in first, then the restore goes through.
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ocloud = cloudServer();
  await cloudRoutes(octx, ocloud);
  const other = await octx.newPage();
  other.on('pageerror', (e) => errors.push(e.message));
  await other.goto(base + '#players');
  await other.getByRole('button', { name: /ייבוא רשימה/ }).click();
  await other.locator('input[type=file]').setInputFiles({ name: 'kochot-backup.json', mimeType: 'application/json', buffer: (await import('node:fs')).readFileSync(backupFile) });
  await other.getByRole('dialog', { name: 'התחברות' }).getByText('כדי להוסיף עוד שחקנים').waitFor({ timeout: 5000 }).catch(() => errors.push('gate: a backup past 4 asks to log in'));
  assert((await other.locator('.roster li').count()) === 0, 'gate: nothing restored before the login');
  await loginInSheet(other);
  await other.waitForSelector('.roster li');
  const imported = await other.locator('.roster li').count();
  assert(imported === 23, `restored ${imported} players from the file`);
  const restored = await other.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)));
  assert(restored.history.length === 2, `the file brings the history: ${restored.history.length}`);
  assert(restored.constraints.apart.length === 1, `the file keeps the rules between players: ${JSON.stringify(restored.constraints)}`);
  await other.context().close();
  // An old link (deflate-raw + base64url after "#import=z.") still imports.
  const { deflateRawSync } = await import('node:zlib');
  const old = { app: 'kochot', v: 2, exportedAt: 1, players: [{ id: 'l1', name: 'מקישור', attrs: { overall: 6 }, canGK: false, cards: [] }, { id: 'l2', name: 'עוד אחד', attrs: { overall: 4 }, canGK: false, cards: [] }], constraints: { together: [], apart: [] }, settings: {} };
  const lp = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  lp.on('pageerror', (e) => errors.push(e.message));
  await lp.goto(base + '#import=z.' + deflateRawSync(Buffer.from(JSON.stringify(old))).toString('base64url'));
  await lp.getByRole('button', { name: /^ייבוא$/ }).click();
  await lp.goto(base + '#players');
  assert((await lp.locator('.roster li').count()) === 2, 'an old #import= link still imports');
  await lp.context().close();
}

// 11. 14 players at 5-a-side (5 · 5 · 4): the short team borrows from the losing team for one match.
{
  const pg = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(base);
  await pg.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  await pg.getByRole('button', { name: 'עושים כוחות' }).click();
  await pg.waitForSelector('.team');
  assert((await pg.locator('.team.waiting .member').count()) === 4, 'a short team of 4 waits');
  await pg.getByRole('button', { name: /התחלת משחק/ }).click();
  assert((await pg.locator('.borrow').count()) === 0, 'no borrow step before the first match ends');
  await pg.getByRole('button', { name: '+ גול' }).first().click();
  await pg.getByRole('button', { name: 'דילוג' }).click();
  await pg.getByRole('button', { name: 'סיום משחק' }).click();
  const card = pg.locator('.borrow');
  assert(await card.isVisible(), 'borrow step shown when the short team comes on');
  const title = await card.locator('h3').innerText();
  assert(/^משלימים את קבוצה \d מקבוצה \d$/.test(title), `borrow title: ${title}`);
  assert(/מומלץ: .+ עובר ל.+, כך המשחק הבא הכי שווה/.test(await card.locator('.borrow-why').innerText()), 'borrow reason');
  assert((await card.locator('.borrow-picks button').count()) === 5, 'five donors to pick from');
  const suggested = await card.locator('.borrow-picks button.sel .name').innerText();
  // Pick someone else, then confirm.
  const other = card.locator('.borrow-picks button:not(.sel)').first();
  const otherName = await other.locator('.name').innerText();
  await other.click();
  assert(/בחרתם/.test(await card.locator('.borrow-why').innerText()), 'override shown');
  assert(/עם ההמלצה \d+/.test(await card.locator('.hint').innerText()), 'recommended score shown on override');
  await card.getByRole('button', { name: 'אישור' }).click();
  assert(await pg.getByText(new RegExp(`${otherName} משחק עם קבוצה \\d`)).isVisible(), 'borrow recorded');
  // The borrower can score for the short team (second side = the team that came on).
  await pg.getByRole('button', { name: '+ גול' }).nth(1).click();
  assert(await pg.locator('.sheet .pick-list').getByText(otherName, { exact: true }).isVisible(), 'borrower listed as a scorer');
  await pg.getByRole('button', { name: 'דילוג' }).click();
  // Survives a reload.
  await pg.reload();
  assert(await pg.getByText(new RegExp(`${otherName} משחק עם קבוצה \\d`)).isVisible(), 'borrow survives reload');
  // The short team wins and stays: the borrower goes back and it borrows again from the new loser.
  await pg.getByRole('button', { name: 'סיום משחק' }).click();
  assert(await pg.locator('.borrow').isVisible(), 'short team that stays borrows again');
  const donors = await pg.locator('.borrow-picks .name').allInnerTexts();
  assert(!donors.includes(otherName), 'borrows from the new loser, not the previous one');
  await pg.locator('.borrow').getByRole('button', { name: 'דילוג' }).click();
  assert((await pg.locator('.borrow').count()) === 0, 'skip hides the step');
  console.log(`borrow: suggested ${suggested}, picked ${otherName}`);
}

// 11a. Bibs (v7): off by default (numbered teams); switched on in Settings, teams get bib names.
{
  const pg = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(base);
  await pg.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  await pg.getByRole('button', { name: 'עושים כוחות' }).click();
  await pg.waitForSelector('.team');
  assert(JSON.stringify(await pg.locator('.team h2').allInnerTexts()) === '["קבוצה 1","קבוצה 2","קבוצה 3"]', `numbered teams: ${await pg.locator('.team h2').allInnerTexts()}`);
  const colours = await pg.locator('.team').evaluateAll((ts) => ts.map((t) => getComputedStyle(t).getPropertyValue('--team')));
  assert(new Set(colours).size === 3, `numbered teams have different colours: ${colours}`);
  assert((await pg.getByRole('button', { name: /העתקה/ }).count()) === 0, 'no separate copy button');
  await sharePicture(pg, 'teams-share.png');
  // No file sharing (desktop): the picture is saved and the short text copied.
  await pg.evaluate(() => {
    navigator.canShare = () => false;
    navigator.clipboard.writeText = async (t) => {
      window.__copied = t;
    };
  });
  const dl = pg.waitForEvent('download');
  await pg.getByRole('button', { name: 'שיתוף', exact: true }).click();
  assert((await dl).suggestedFilename() === 'kochot.png', 'fallback saves the picture');
  await pg.waitForFunction(() => window.__copied);
  const short = (await pg.evaluate(() => window.__copied)).split('\n');
  assert(short.length === 4 && /^\u200f🔵 \*קבוצה 1\*: /.test(short[1]) && !short.join().includes('מדד'), `short text: ${short.join(' | ')}`);
  await pg.goto(base + '#settings');
  await pg.locator('summary', { hasText: 'גופיות' }).click();
  assert((await pg.locator('button.bib[aria-pressed]').count()) === 0, 'no bib picker while bibs are off');
  await pg.locator('label.toggle', { hasText: 'יש לכם גופיות' }).click();
  assert((await pg.locator('button.bib[aria-pressed]').count()) === 8, 'bib picker shown when on');
  await pg.getByRole('button', { name: /^צהובים/ }).click(); // drop yellow: 7 colours
  assert(/גופיות\s*· 7 צבעים/.test(await pg.locator('summary', { hasText: 'גופיות' }).innerText()), 'bibs summary counts colours');
  await pg.goto(base + '#teams');
  assert(JSON.stringify(await pg.locator('.team h2').allInnerTexts()) === '["אדומים","כחולים","ירוקים"]', `bib names: ${await pg.locator('.team h2').allInnerTexts()}`);
  await sharePicture(pg, 'teams-share-bibs.png');
  await pg.getByRole('button', { name: /התחלת משחק/ }).click();
  await pg.getByRole('button', { name: '+ גול' }).first().click();
  assert((await pg.getByRole('dialog').locator('h2').innerText()) === 'מי הבקיע לאדומים?', 'scorer sheet with a bib name');
  await pg.getByRole('button', { name: 'דילוג' }).click();
  await pg.getByRole('button', { name: 'סיום משחק' }).click();
  assert(/^משלימים את הירוקים מהכחולים$/.test(await pg.locator('.borrow h3').innerText()), 'borrow title with bib names');
  await pg.context().close();
}

// 11b. Left early (v6): after a match, a player of the team outside leaves → he's out of the teams and
// the attendance, the best sub is offered and comes in, the evening goes on, the history keeps him.
{
  const pg = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  const stored = () => pg.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)));
  const sizes = () => pg.locator('.team').evaluateAll((cs) => cs.map((c) => c.querySelectorAll('.member').length));
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
  // Two late arrivals: one goes in and fills the short team, the other waits on the side.
  for (const [name, choice] of [['מאחר א', /^נכנס עכשיו/], ['מאחר ב', /^מחכה בצד$/]]) {
    await pg.getByRole('button', { name: /הגיע מאוחר/ }).click();
    await pg.getByPlaceholder('שם').fill(name);
    await pg.getByRole('button', { name: 'המשך' }).click();
    assert((await pg.getByRole('dialog').locator('.lead').innerText()) === 'בין משחקים', 'late: between matches');
    await pg.getByRole('button', { name: choice }).click();
    if (await pg.getByRole('button', { name: 'להשאיר ככה' }).isVisible()) await pg.getByRole('button', { name: 'להשאיר ככה' }).click();
  }
  assert(JSON.stringify(await sizes()) === '[5,5,5]', `before leaving: ${await sizes()}`);
  assert((await pg.locator('.bench .member').count()) === 1, 'one sub before leaving');
  const before = await stored();
  const played = before.match.history[0].sides.flat();
  // Someone from the team outside (it lost and waits) leaves.
  await pg.getByRole('button', { name: /עזב באמצע/ }).click();
  const sheet = pg.getByRole('dialog');
  assert((await sheet.locator('h2').innerText()) === 'מי עזב?', 'leave sheet title');
  const outside = sheet.locator('.leave-team').filter({ hasNotText: 'על המגרש' }).filter({ hasNotText: 'מחליפים' }).first();
  const gone = await outside.locator('.member').first().innerText();
  const goneId = before.players.find((p) => p.name === gone).id;
  assert(played.includes(goneId), 'he played the first match');
  await outside.locator('.member').first().click();
  assert((await sheet.locator('h2').innerText()) === `${gone} עזב?`, 'confirm step');
  assert(/נשארים 4/.test(await sheet.locator('.lead').innerText()), `confirm says what happens: ${await sheet.locator('.lead').innerText()}`);
  assert((await sheet.locator('.leave-case').innerText()) === 'בין משחקים · יש מחליף', `leave case line: ${await sheet.locator('.leave-case').innerText()}`);
  await sheet.getByRole('button', { name: 'כן, הוא עזב' }).click();
  assert((await sheet.locator('h2').innerText()) === 'להכניס מחליף?', 'sub suggestion shown');
  await sheet.getByRole('button', { name: 'מאחר ב נכנס' }).click();
  assert(JSON.stringify(await sizes()) === '[5,5,5]', `after the sub came in: ${await sizes()}`);
  assert((await pg.locator('.bench .member').count()) === 0, 'the sub is on a team now');
  assert((await pg.locator('.team .name').allInnerTexts()).every((n) => n !== gone), 'he is off the teams');
  assert((await pg.getByText('הנוכחות או גודל הקבוצה השתנו').count()) === 0, 'not flagged as changed since the split');
  const after = await stored();
  assert(!after.presentIds.includes(goneId), 'off today’s attendance');
  assert(JSON.stringify(after.match.history) === JSON.stringify(before.match.history), 'history unchanged');
  // The evening goes on.
  await pg.getByRole('button', { name: /חזרה למשחק/ }).click();
  await pg.getByRole('button', { name: 'התחלה' }).click();
  await pg.getByRole('button', { name: '+ גול' }).first().click();
  await pg.getByRole('button', { name: 'דילוג' }).click();
  await pg.getByRole('button', { name: 'סיום משחק' }).click();
  const end = await stored();
  assert(end.match.history.length === 2, 'second match recorded');
  assert(end.match.history[0].sides.flat().includes(goneId), 'the first match still has him');
  assert(!end.match.history[1].sides.flat().includes(goneId), 'the next match does not');
  // From the match screen, with no subs left: someone else leaves (a swap may be offered).
  await pg.getByRole('button', { name: 'מישהו עזב?' }).click();
  const out2 = pg.getByRole('dialog').locator('.leave-team').filter({ hasNotText: 'על המגרש' }).first();
  const gone2 = await out2.locator('.member').first().innerText();
  await out2.locator('.member').first().click();
  assert((await pg.getByRole('dialog').locator('.leave-case').innerText()) === 'בין משחקים · אין מחליף', 'leave: between-matches case line');
  const asgBefore = (await stored()).result;
  await pg.getByRole('button', { name: 'כן, הוא עזב' }).click();
  // Between matches with 3 teams, the two on the pitch and the next one in are all locked: no swap.
  assert(!(await pg.getByRole('dialog').count()), 'leave between matches: no swap touching the pitch or the next team');
  const end2 = await stored();
  const teamOf = (r, id) => r.assignment[r.playerIds.indexOf(id)];
  assert(end2.result.playerIds.every((id) => teamOf(end2.result, id) === teamOf(asgBefore, id)), 'leave between matches: nobody moved');
  assert(!end2.result.playerIds.includes(end2.players.find((p) => p.name === gone2).id), 'second leaver off the teams');
  assert(await pg.locator('.clock').isVisible(), 'still on the match screen');
  console.log(`left early: ${gone}, then ${gone2}`);
}

// 11c. Late arrival v8, always asked: 6 players at 4-a-side play 3×3. Before kickoff "מחכה בצד" keeps 3×3;
// mid-match "נכנס עכשיו" joins the suggested team on the pitch (4×3); mid-match "מחכה בצד" → bench,
// then swapped in after the match the usual way (tap the sub, then a player).
{
  const pg = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  const stored = () => pg.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)));
  const sizes = () => pg.locator('.team').evaluateAll((cs) => cs.map((c) => c.querySelectorAll('.member').length));
  const arrive = async (open, choice, context) => {
    await pg.getByRole('button', { name: open }).click();
    const sheet = pg.getByRole('dialog');
    const name = await sheet.locator('.pick-list .name').first().innerText();
    await sheet.locator('.pick-list button').first().click();
    assert((await sheet.locator('h2').innerText()) === `${name} הגיע`, `late: choice step for ${name}`);
    assert(context.test(await sheet.locator('.lead').innerText()), `late: context line ${await sheet.locator('.lead').innerText()}`);
    await sheet.getByRole('button', { name: choice }).click();
    await pg.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
    return name;
  };
  await pg.goto(base);
  await pg.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  await pg.getByRole('button', { name: 'ניקוי' }).click();
  for (let i = 0; i < 6; i++) await pg.locator('.attend label').nth(i).click();
  await pg.getByRole('radiogroup', { name: 'כמה בקבוצה' }).getByRole('radio', { name: '4' }).click();
  await pg.getByRole('button', { name: 'עושים כוחות' }).click();
  await pg.waitForSelector('.team');
  assert(JSON.stringify(await sizes()) === '[3,3]', `3×3 at 4-a-side: ${await sizes()}`);
  await arrive(/הגיע מאוחר/, /^מחכה בצד$/, /^עוד לא התחיל משחק$/);
  assert(JSON.stringify(await sizes()) === '[3,3]', `wait keeps 3×3: ${await sizes()}`);
  assert((await pg.locator('.bench .member').count()) === 1, 'he waits on the bench');
  assert(await pg.getByText('להכנסה: נוגעים במחליף ואז בשחקן שיוצא').isVisible(), 'bench hint');
  assert((await pg.getByText('הנוכחות או גודל הקבוצה השתנו').count()) === 0, 'late: not flagged as changed');
  await pg.getByRole('button', { name: /התחלת משחק/ }).click();
  await pg.getByRole('button', { name: 'התחלה' }).click();
  const keeperBefore = await pg.locator('.keeper').allInnerTexts();
  const joined = await arrive('מישהו הגיע?', /^נכנס עכשיו לקבוצה 2$/, /^משחק באמצע · קבוצה 1 נגד קבוצה 2$/);
  const s1 = await stored();
  const joinedId = s1.players.find((p) => p.name === joined).id;
  assert(s1.result.assignment[s1.result.playerIds.indexOf(joinedId)] === 1, 'mid-match: joined the suggested team on the pitch');
  assert(s1.match.clock.running, 'the clock keeps running');
  assert(JSON.stringify(await pg.locator('.keeper').allInnerTexts()) === JSON.stringify(keeperBefore), 'the keepers in goal stay');
  const waiting = await arrive('מישהו הגיע?', /^מחכה בצד$/, /^משחק באמצע/);
  await pg.getByRole('button', { name: '+ גול' }).first().click();
  await pg.getByRole('button', { name: 'דילוג' }).click();
  await pg.getByRole('button', { name: 'סיום משחק' }).click();
  const s2 = await stored();
  assert(s2.match.history[0].sides[1].includes(joinedId), 'the match record has him');
  await pg.getByRole('button', { name: /לקבוצות/ }).click();
  assert(JSON.stringify(await sizes()) === '[3,4]', `after the match: ${await sizes()}`);
  assert((await pg.locator('.bench .member').count()) === 2, 'two wait on the bench');
  await pg.locator('.bench .member', { hasText: waiting }).click();
  await pg.locator('.team').first().locator('.member').first().click();
  assert((await pg.locator('.team .name').allInnerTexts()).includes(waiting), 'the waiting sub is swapped in');
  assert(JSON.stringify(await sizes()) === '[3,4]', `swap keeps sizes: ${await sizes()}`);
  await pg.context().close();
}

// 11d. Bench add and leave cases (v15): a sub joins a team on request (3×3 → 4×3); a sub who leaves
// is just removed; someone on the pitch leaves mid-match → the sub comes in now.
{
  const pg = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  const stored = () => pg.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)));
  const sizes = () => pg.locator('.team').evaluateAll((cs) => cs.map((c) => c.querySelectorAll('.member').length));
  const wait = async (open) => {
    await pg.getByRole('button', { name: open }).click();
    const sheet = pg.getByRole('dialog');
    const name = await sheet.locator('.pick-list .name').first().innerText();
    await sheet.locator('.pick-list button').first().click();
    await sheet.getByRole('button', { name: /^מחכה בצד$/ }).click();
    await pg.waitForSelector('.toast.show', { state: 'detached', timeout: 8000 }).catch(() => {});
    return name;
  };
  await pg.goto(base);
  await pg.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  await pg.getByRole('button', { name: 'ניקוי' }).click();
  for (let i = 0; i < 6; i++) await pg.locator('.attend label').nth(i).click();
  await pg.getByRole('radiogroup', { name: 'כמה בקבוצה' }).getByRole('radio', { name: '4' }).click();
  await pg.getByRole('button', { name: 'עושים כוחות' }).click();
  await pg.waitForSelector('.team');
  const first = await wait(/הגיע מאוחר/);
  assert(!(await pg.getByRole('button', { name: 'להוסיף לקבוצה…' }).count()), 'bench add: not offered until a sub is tapped');
  await pg.locator('.bench .member', { hasText: first }).click();
  await pg.getByRole('button', { name: 'להוסיף לקבוצה…' }).click();
  assert((await pg.getByRole('dialog').locator('h2').innerText()) === `להוסיף את ${first} לקבוצה`, 'bench add: team step');
  await pg.getByRole('dialog').getByRole('button', { name: 'קבוצה 1' }).click();
  assert(JSON.stringify(await sizes()) === '[4,3]', `bench add: 3×3 → 4×3, got ${await sizes()}`);
  assert((await pg.locator('.bench .member').count()) === 0, 'bench add: off the bench');
  assert((await pg.getByText('הנוכחות או גודל הקבוצה השתנו').count()) === 0, 'bench add: not flagged as changed');
  const s1 = await stored();
  const firstId = s1.players.find((p) => p.name === first).id;
  assert(s1.result.gkOrder[0].at(-1) === firstId, 'bench add: last in the keeper order');
  // A sub who leaves: removed, one toast, no suggestion.
  const sub = await wait(/הגיע מאוחר/);
  await pg.getByRole('button', { name: /עזב באמצע/ }).click();
  const sheet = pg.getByRole('dialog');
  await sheet.locator('.leave-team', { hasText: 'מחליפים' }).locator('.member', { hasText: sub }).click();
  assert((await sheet.locator('.leave-case').innerText()) === 'מחליף', 'leave: sub case line');
  await sheet.getByRole('button', { name: 'כן, הוא עזב' }).click();
  assert(!(await pg.getByRole('dialog').count()), 'leave: a sub leaving offers nothing');
  assert((await pg.locator('.bench .member').count()) === 0, 'leave: the sub is gone');
  assert(JSON.stringify(await sizes()) === '[4,3]', `leave: teams untouched by a sub leaving, got ${await sizes()}`);
  // Mid-match, someone on the pitch leaves with a sub waiting: the sub comes in now.
  const sub2 = await wait(/הגיע מאוחר/);
  await pg.getByRole('button', { name: /התחלת משחק/ }).click();
  await pg.getByRole('button', { name: 'התחלה' }).click();
  await pg.getByRole('button', { name: 'מישהו עזב?' }).click();
  const team2 = sheet.locator('.leave-team').filter({ hasText: 'קבוצה 2' });
  const gone = await team2.locator('.member').first().innerText();
  await team2.locator('.member').first().click();
  assert((await sheet.locator('.leave-case').innerText()) === 'באמצע משחק · יש מחליף', `leave: live case line ${await sheet.locator('.leave-case').innerText()}`);
  await sheet.getByRole('button', { name: 'כן, הוא עזב' }).click();
  assert((await sheet.locator('h2').innerText()) === 'להכניס מחליף?', 'leave live: sub offered');
  assert(await sheet.getByRole('button', { name: 'משחקים חסר' }).isVisible(), 'leave live: "משחקים חסר"');
  assert(!(await sheet.getByText('⇄').count()), 'leave live: no swaps');
  await sheet.getByRole('button', { name: `${sub2} נכנס` }).click();
  const s2 = await stored();
  const sub2Id = s2.players.find((p) => p.name === sub2).id;
  assert(s2.result.assignment[s2.result.playerIds.indexOf(sub2Id)] === 1 && s2.result.subIds.length === 0, 'leave live: the sub is in team 2 now');
  assert(!s2.result.playerIds.includes(s2.players.find((p) => p.name === gone).id), 'leave live: he is out');
  assert(s2.match.clock.running, 'leave live: the clock keeps running');
  await pg.context().close();
}

// 11. Groups (logged in): two groups can't share a name; a second group starts empty and is a cloud
// group from the start (v13); switching back keeps the first one's roster.
await page.goto(base + '#home');
await page.getByRole('button', { name: /החלפת קבוצה/ }).click();
await page.getByRole('button', { name: /קבוצה חדשה/ }).click();
assert(!(await page.getByRole('dialog', { name: 'התחברות' }).count()), 'logged in: a new group needs no login');
await page.getByLabel('שם הקבוצה').fill('הקבוצה שלי');
await page.getByRole('button', { name: 'יצירה' }).click();
assert(await page.getByText('כבר יש קבוצה בשם הזה').isVisible(), 'groups: a duplicate name is refused');
await page.getByLabel('שם הקבוצה').fill('כדורגל בבסיס');
await page.getByRole('button', { name: 'יצירה' }).click();
assert(await page.getByRole('button', { name: /קבוצה: כדורגל בבסיס/ }).isVisible(), 'new group is open');
assert(await page.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).isVisible(), 'new group starts empty');
await page.waitForFunction(() => JSON.parse(localStorage.getItem('kochot:groups')).groups.every((g) => g.synced), null, { timeout: 5000 }).catch(() => {});
assert(cloud.calls.some((c) => c.rpc === 'create_group' && c.body.p_name === 'כדורגל בבסיס'), 'logged in: the new group is created on the server');
assert(await page.evaluate(() => JSON.parse(localStorage.getItem('kochot:groups')).groups.every((g) => g.synced && !g.upload)), 'logged in: both groups are cloud groups');
await page.getByRole('button', { name: /החלפת קבוצה/ }).click();
await page.getByRole('button', { name: /הקבוצה שלי/ }).click();
await page.getByRole('button', { name: 'השחקנים' }).click();
assert((await page.locator('.roster li').count()) === 23, 'first group keeps its 23 players');
await back();

// 12. Upgrade from the single-key storage (before groups): the data becomes "הקבוצה שלי".
const old = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
old.on('pageerror', (e) => errors.push(e.message));
await old.goto(base);
await old.evaluate(() => {
  localStorage.clear();
  localStorage.setItem(
    'kochot:v1',
    JSON.stringify({ version: 2, players: [{ id: 'x1', name: 'ותיק', attrs: { overall: 7 }, canGK: false, cards: [] }, { id: 'x2', name: 'סלע', attrs: { overall: 6 }, canGK: false, cards: ['rock', 'captain'] }], presentIds: ['x1'], dayAt: Date.now(), teamSize: 5, settings: {}, constraints: { together: [], apart: [] }, result: null, match: null }),
  );
});
await old.reload();
assert(await old.getByRole('button', { name: /קבוצה: הקבוצה שלי/ }).isVisible(), 'migrated group name');
assert(await old.getByText('ותיק').isVisible(), 'migrated player shown');
// v7 cards: the old 🧱 card is dropped (it becomes 🛡️), 'captain' is now ⭐ כוכב.
assert((await old.locator('[aria-label="כוכב"]').count()) === 1, 'old card ids load with the new names');
assert(!(await old.evaluate(() => localStorage.getItem('kochot:v1'))), 'old key moved');
// No network to Supabase without an account.
const sbCalls = [];
old.on('request', (r) => /supabase|accounts\.google\.com/.test(r.url()) && sbCalls.push(r.url()));
await old.reload();
await old.waitForTimeout(300);
assert(sbCalls.length === 0, `no Supabase or Google calls when logged out: ${sbCalls}`);

// 13. Swipe to delete on a touch phone: a real touch drag reveals "מחיקה", which asks first.
{
const mob = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'he-IL' })).newPage();
mob.on('pageerror', (e) => errors.push(e.message));
await mob.goto(base);
await mob.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
await mob.getByRole('button', { name: 'השחקנים' }).click();
const cdp = await mob.context().newCDPSession(mob);
const touchDrag = async (x0, y0, x1, y1, steps = 12) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
    await mob.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mob.waitForTimeout(300);
};
const rowOf = (n) => mob.locator('.roster li').filter({ has: mob.locator('.name', { hasText: new RegExp(`^${n}$`) }) });
const rosterCount = () => mob.locator('.roster li').count();
const before = await rosterCount();
// A vertical scroll over the list doesn't open a row.
await rowOf('אבי').scrollIntoViewIfNeeded();
const vbox = await mob.locator('.roster').boundingBox();
const y0 = await mob.evaluate(() => scrollY);
await touchDrag(200, Math.min(700, vbox.y + vbox.height - 20), 214, 300);
assert((await mob.locator('.swipe-row.revealed').count()) === 0, 'vertical scroll opened a row');
assert((await mob.evaluate(() => scrollY)) !== y0, 'vertical drag scrolled the page');
// Swipe toward the right (RTL trailing edge on the left): the red action shows.
const avi = rowOf('אבי');
await avi.scrollIntoViewIfNeeded();
let box = await avi.boundingBox();
await touchDrag(box.x + 120, box.y + box.height / 2, box.x + 240, box.y + box.height / 2 + 4);
assert((await avi.locator('.swipe-action').isVisible()) && (await mob.locator('.swipe-row.revealed').count()) === 1, 'swipe reveals the delete action');
assert(!(await mob.locator('.sheet').count()), 'swiping does not open the edit sheet');
const actionBox = await avi.locator('.swipe-action').boundingBox();
assert(actionBox.x < box.x + 20, 'delete action is on the left (trailing edge in RTL)');
await mob.getByRole('button', { name: 'מחיקת אבי' }).tap();
assert(await mob.getByRole('dialog', { name: 'למחוק את אבי?' }).isVisible(), 'confirmation dialog');
await mob.locator('.sheet').getByRole('button', { name: 'מחיקה', exact: true }).tap();
assert((await rosterCount()) === before - 1 && !(await rowOf('אבי').count()), 'אבי deleted after confirming');
// A full swipe asks right away; cancelling keeps the player and closes the row.
const second = mob.locator('.roster li').nth(2);
const secondName = await second.locator('.name').textContent();
box = await second.boundingBox();
await touchDrag(box.x + 40, box.y + box.height / 2, box.x + 360, box.y + box.height / 2);
assert(await mob.getByRole('dialog', { name: `למחוק את ${secondName}?` }).isVisible(), 'full swipe asks to confirm');
await mob.getByRole('button', { name: 'ביטול' }).tap();
await mob.waitForTimeout(300);
assert((await rosterCount()) === before - 1 && (await mob.locator('.swipe-row.revealed').count()) === 0, 'cancel keeps the player and closes the row');
// Tapping a row still opens the edit sheet, and its delete asks too.
await second.locator('button.swipe-content, .swipe-content button').first().tap();
assert(await mob.getByRole('dialog', { name: secondName }).isVisible(), 'tap opens the edit sheet');
await mob.locator('.sheet').getByRole('button', { name: 'מחיקה', exact: true }).tap();
assert(await mob.getByRole('dialog', { name: `למחוק את ${secondName}?` }).isVisible(), 'edit sheet delete asks to confirm');
await mob.getByRole('button', { name: 'ביטול' }).tap();
assert((await rosterCount()) === before - 1, 'cancel from the edit sheet keeps the player');
// With teams made, the confirmation says the teams go too.
await mob.getByRole('button', { name: /^חזרה$/ }).tap();
await mob.getByRole('button', { name: 'עושים כוחות' }).tap();
await mob.waitForSelector('.team');
await mob.goto(base + '#players');
await mob.getByRole('button', { name: /^בני/ }).tap();
await mob.locator('.sheet').getByRole('button', { name: 'מחיקה', exact: true }).tap();
assert(await mob.getByText('הוא בכוחות של היום').isVisible(), 'confirmation mentions today\'s teams');
await mob.getByRole('button', { name: 'ביטול' }).tap();
}

// 14. Desktop mouse: the one-time swipe tip, a mouse-drag swipe that keeps the name readable, and multi-select delete.
{
  const pc = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  pc.on('pageerror', (e) => errors.push(e.message));
  await pc.goto(base);
  await pc.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  await pc.getByRole('button', { name: 'השחקנים' }).click();
  const tip = pc.locator('.swipe-tip');
  assert(await tip.isVisible(), 'swipe tip shown the first time');
  const rows = pc.locator('.roster li');
  const total = await rows.count();
  // Mouse drag toward the right reveals the action; the name stays where it was.
  const row = rows.nth(1);
  await row.scrollIntoViewIfNeeded();
  const rb = await row.boundingBox();
  const nameBefore = await row.locator('.name').boundingBox();
  await pc.mouse.move(rb.x + 60, rb.y + rb.height / 2);
  await pc.mouse.down();
  for (let i = 1; i <= 12; i++) await pc.mouse.move(rb.x + 60 + i * 10, rb.y + rb.height / 2 + 1);
  await pc.mouse.up();
  await pc.waitForTimeout(350);
  assert((await pc.locator('.swipe-row.revealed').count()) === 1, 'mouse drag reveals the delete action');
  assert(!(await pc.locator('.sheet').count()), 'mouse drag does not open the edit sheet');
  const nameAfter = await row.locator('.name').boundingBox();
  assert(Math.abs(nameAfter.x + nameAfter.width - (nameBefore.x + nameBefore.width)) < 2 && nameAfter.x + nameAfter.width <= rb.x + rb.width + 1, 'the name stays in place when the row opens');
  const act = await row.locator('.swipe-action').boundingBox();
  assert(act.x <= rb.x + 1 && act.width >= 80, 'the action shows on the left');
  // A click elsewhere closes it; dismissing the tip is remembered.
  await pc.locator('.section-title h2').click();
  await pc.waitForTimeout(300);
  assert((await pc.locator('.swipe-row.revealed').count()) === 0, 'a click outside closes the row');
  await tip.getByRole('button', { name: 'סגירת הטיפ' }).click();
  await pc.reload();
  assert((await pc.locator('.swipe-tip').count()) === 0, 'dismissed tip stays hidden after a reload');
  // Select mode: rows toggle, swiping is off, the bar counts, one confirmation deletes them all.
  await pc.getByRole('button', { name: 'בחירה', exact: true }).click();
  // A mouse drag doesn't open the row in select mode (letting go on it is a click, which selects it).
  const r0 = await rows.nth(0).boundingBox();
  await pc.mouse.move(r0.x + 60, r0.y + r0.height / 2);
  await pc.mouse.down();
  for (let i = 1; i <= 12; i++) await pc.mouse.move(r0.x + 60 + i * 10, r0.y + r0.height / 2);
  await pc.mouse.up();
  await pc.waitForTimeout(300);
  assert((await pc.locator('.swipe-row.revealed').count()) === 0, 'no swiping in select mode');
  if (!(await rows.nth(0).locator('button[aria-pressed="true"]').count())) await rows.nth(0).locator('.swipe-content > button').click();
  const names = [await rows.nth(0).locator('.name').textContent()];
  for (const i of [2, 4]) {
    names.push(await rows.nth(i).locator('.name').textContent());
    await rows.nth(i).locator('.swipe-content > button').click();
  }
  assert(!(await pc.locator('.sheet').count()), 'a tap in select mode selects instead of editing');
  assert((await pc.locator('.select-count').innerText()) === 'נבחרו 3', 'bar counts the selection');
  assert((await rows.nth(0).locator('button[aria-pressed="true"]').count()) === 1, 'selected row is pressed');
  await pc.locator('.select-bar').getByRole('button', { name: 'מחיקה' }).click();
  const dlg = pc.getByRole('dialog', { name: 'למחוק 3 שחקנים?' });
  assert(await dlg.isVisible(), 'multi-delete confirmation');
  const listed = await dlg.locator('.confirm-names').innerText();
  assert(names.every((n) => listed.includes(n)), `confirmation lists the names: ${listed}`);
  await dlg.getByRole('button', { name: 'מחיקת 3 שחקנים' }).click();
  assert((await rows.count()) === total - 3, 'three players deleted');
  assert((await pc.locator('.select-bar').count()) === 0, 'select mode ends after deleting');
  assert(await pc.getByText('3 שחקנים נמחקו').isVisible(), 'toast after multi-delete');
  // "בחירת הכול" then cancel leaves everyone.
  await pc.getByRole('button', { name: 'בחירה', exact: true }).click();
  await pc.getByRole('button', { name: 'בחירת הכול' }).click();
  assert((await pc.locator('.select-count').innerText()) === `נבחרו ${total - 3}`, 'select all');
  await pc.locator('.select-bar').getByRole('button', { name: 'ביטול' }).click();
  assert((await rows.count()) === total - 3 && (await pc.locator('.select-bar').count()) === 0, 'cancel keeps everyone');
  // Folds: the nested "דירוג מפורט מתקדם" chevron points down while "עוד על השחקן" is open.
  await pc.getByText('עוד על השחקן').click();
  await pc.waitForTimeout(300); // the chevron turns with a short transition
  const rot = (sel) => pc.locator(sel).evaluate((el) => getComputedStyle(el, '::after').transform);
  assert((await rot('form.add details.more > summary')) !== (await rot('form.add details.detailed > summary')), 'open and closed folds have different chevrons');
}

// 15. Match length (v5) on a touch phone, with the sound code broken on purpose: the first tap on
// "התחלה" still starts the clock (sounds can never block it); the length sheet changes this match
// and the default, ±1 only this match, it survives a reload, and "בלי טיימר" counts up.
{
  const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'he-IL' });
  await tctx.addInitScript(() => {
    AudioContext.prototype.createDynamicsCompressor = () => {
      throw new Error('no compressor');
    };
  });
  const tp = await tctx.newPage();
  tp.on('pageerror', (e) => errors.push(`match length: ${e.message}`));
  const stored = () => tp.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)));
  await tp.goto(base);
  await tp.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).tap();
  await tp.getByRole('button', { name: 'עושים כוחות' }).tap();
  await tp.getByRole('button', { name: /התחלת משחק/ }).tap();
  await tp.getByRole('button', { name: /^התחלה$/ }).tap();
  assert(await tp.getByRole('button', { name: /עצירה/ }).isVisible(), 'first tap on התחלה starts the clock even if sound fails');
  const chip = tp.getByRole('button', { name: /^אורך המשחק/ });
  assert((await chip.innerText()).includes('8 דק׳'), `length chip shows the default: ${await chip.innerText()}`);
  await tp.locator('.clock').tap(); // the clock opens the sheet too
  const sheet = tp.getByRole('dialog');
  await sheet.getByRole('radio', { name: '5' }).tap();
  assert((await stored()).settings.matchMinutes === 5, 'picked length saved as the default');
  await sheet.getByRole('button', { name: '+1 דק׳' }).tap();
  assert((await stored()).settings.matchMinutes === 5, '+1 changes this match only');
  await sheet.getByRole('button', { name: 'אישור' }).tap();
  assert(/^5:\d\d$/.test(await tp.locator('.clock').innerText()), `6-minute match shows 5:xx: ${await tp.locator('.clock').innerText()}`);
  await tp.reload();
  await tp.waitForSelector('.clock');
  assert(/6 דק׳\s*\+1/.test(await chip.innerText()), `added time survives a reload: ${await chip.innerText()}`);
  await chip.tap();
  await sheet.locator('label.toggle').tap();
  assert((await stored()).settings.matchNoLimit === true, '"no timer" saved as the default');
  await sheet.getByRole('button', { name: 'אישור' }).tap();
  assert((await chip.innerText()).includes('בלי הגבלת זמן'), 'no-timer chip');
  assert(/^0:\d\d$/.test(await tp.locator('.clock').innerText()), `no timer counts up: ${await tp.locator('.clock').innerText()}`);
  await tp.getByRole('button', { name: 'סיום משחק' }).tap();
  // A 0–0 now asks about penalties first (v5): pick a winner.
  if (await tp.locator('.pens-team').count()) await tp.locator('.pens-team').first().tap();
  else if (await sheet.isVisible()) await sheet.getByRole('button', { name: /יוצא(ים|ת)$/ }).first().tap();
  assert((await chip.innerText()).includes('בלי הגבלת זמן'), 'next match has no timer either');
  await chip.tap();
  await sheet.locator('label.toggle').tap();
  await sheet.getByRole('button', { name: 'אישור' }).tap();
  assert((await chip.innerText()).trim().endsWith('5 דק׳'), `timer back at the default: ${await chip.innerText()}`);
  await tctx.close();
}

// 16. Add to home screen (v6): never on the first use; from the second use (12+ hours later) a card
// on the main screen with Safari's steps on iPhone; "אחר כך" waits a week, "לא להציג שוב" is for good;
// never while a match clock runs; never when opened from the home screen; Chrome's prompt is one tap.
{
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const INSTA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0';
  const phone = (ua, init) => async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'he-IL', ...(ua ? { userAgent: ua } : {}) });
    if (init) await c.addInitScript(init);
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(`install: ${e.message}`));
    return [c, p];
  };
  const flags = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('kochot:install')));
  // Pretend the current use began 13 hours ago, so the next open is a new use.
  const nextUse = async (p, patch = {}) => {
    await p.evaluate((patch) => {
      const f = JSON.parse(localStorage.getItem('kochot:install'));
      localStorage.setItem('kochot:install', JSON.stringify({ ...f, useAt: Date.now() - 13 * 3600e3, ...patch }));
    }, patch);
    await p.reload();
    await p.waitForSelector('.hero');
  };
  const card = (p) => p.locator('.install-card');

  const [ic, ip] = await phone(IPHONE)();
  await ip.goto(base);
  await ip.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).tap();
  await ip.reload();
  await ip.waitForSelector('.hero');
  assert((await card(ip).count()) === 0, 'install: not shown on the first use');
  assert((await flags(ip)).uses === 1, `install: first use counted once (${(await flags(ip)).uses})`);
  await nextUse(ip);
  assert((await flags(ip)).uses === 2, 'install: second use counted');
  assert(await card(ip).isVisible(), 'install: shown on the second use');
  assert(await card(ip).getByText(/הוספה למסך הבית״ ואז/).isVisible(), 'install: iPhone shows the Safari steps');
  assert((await card(ip).getByRole('img', { name: 'שיתוף' }).count()) === 1, 'install: the share icon is drawn');
  assert((await card(ip).getByRole('button', { name: 'התקנה' }).count()) === 0, 'install: no install button on iOS');
  // The card sits in the page flow: it never covers the big button.
  const cardBox = await card(ip).boundingBox();
  const heroBtn = await ip.getByRole('button', { name: 'עושים כוחות' }).boundingBox();
  assert(cardBox.y + cardBox.height <= heroBtn.y, 'install: card above the main button, not over it');
  await card(ip).getByRole('button', { name: 'אחר כך' }).tap();
  assert((await card(ip).count()) === 0, 'install: "later" hides it');
  await nextUse(ip);
  assert((await card(ip).count()) === 0, 'install: "later" remembered on the next use');
  const later = await flags(ip);
  assert(later.snoozeUntil - Date.now() > 6.9 * 864e5, 'install: "later" waits about a week');
  await nextUse(ip, { snoozeUntil: Date.now() - 1 });
  assert(await card(ip).isVisible(), 'install: back after the week');
  // Never while a match clock runs (back on the main screen during the match).
  await ip.getByRole('button', { name: 'עושים כוחות' }).tap();
  await ip.getByRole('button', { name: /התחלת משחק/ }).tap();
  await ip.getByRole('button', { name: /^התחלה$/ }).tap();
  await ip.goto(base + '#home');
  await ip.waitForSelector('.hero');
  assert((await card(ip).count()) === 0, 'install: hidden while the match clock runs');
  await ip.getByRole('button', { name: /חזרה למשחק/ }).tap();
  await ip.getByRole('button', { name: /עצירה/ }).tap();
  await ip.goto(base + '#home');
  await ip.waitForSelector('.hero');
  assert(await card(ip).isVisible(), 'install: back once the clock is paused');
  await card(ip).getByRole('button', { name: 'לא להציג שוב' }).tap();
  await nextUse(ip, { snoozeUntil: 0 });
  assert((await card(ip).count()) === 0 && (await flags(ip)).never === true, 'install: "never" remembered');
  // The help screen keeps the steps ("איך מוסיפים למסך הבית?"); Settings no longer has them.
  await ip.goto(base + '#help/install');
  assert(await ip.locator('#help-install .install-settings').getByText(/הוספה למסך הבית״ ואז/).isVisible(), 'install: steps in the help screen');
  await ic.close();

  // An in-app browser on iOS: open in Safari first.
  const [nc, np] = await phone(INSTA)();
  await np.goto(base);
  await np.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).tap();
  await nextUse(np);
  assert(await card(np).getByText(/נפתח בתוך אינסטגרם/).isVisible(), 'install: Instagram on iOS says open in Safari');
  await nc.close();

  // Opened from the home screen: never.
  const [sc, sp] = await phone(IPHONE, () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  })();
  await sp.goto(base);
  await sp.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).tap();
  await nextUse(sp);
  assert((await flags(sp)).uses === 2 && (await card(sp).count()) === 0, 'install: never shown when already installed');
  await sp.goto(base + '#help/install');
  assert(await sp.getByText('כוחות פתוחה ממסך הבית').isVisible(), 'install: help says it is installed');
  await sc.close();

  // Android Chrome: the captured prompt is one tap.
  const [ac, ap] = await phone(null)();
  await ap.goto(base);
  await ap.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).tap();
  await nextUse(ap);
  assert((await card(ap).count()) === 0, 'install: no card on Android without an install prompt');
  await ap.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = async () => {
      window.__prompted = true;
    };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await card(ap).getByRole('button', { name: 'התקנה' }).tap();
  await ap.waitForFunction(() => window.__prompted);
  await ap.waitForFunction(() => JSON.parse(localStorage.getItem('kochot:install')).installed === true);
  assert((await card(ap).count()) === 0, 'install: card gone after installing');
  await ac.close();
}

// Help screen: "?" in the top bar, a question opens, and the icon legend lists every card and position
// (read from the add form's chips, so this doesn't need updating when the cards change).
{
  const hp = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' })).newPage();
  hp.on('pageerror', (e) => errors.push(`help: ${e.message}`));
  await hp.goto(base);
  await hp.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  await hp.getByRole('button', { name: 'השחקנים' }).click();
  await hp.getByText('עוד על השחקן').click();
  const chipNames = (sel) => hp.locator(sel).evaluateAll((bs) => bs.map((b) => [b.querySelector('.card-emoji')?.textContent ?? '', [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()]));
  const cards = await chipNames('form.add .card-group .card-chip');
  const positions = await chipNames('form.add .pos-picker .card-chip');
  assert(cards.length >= 6 && positions.length >= 4, `help: read ${cards.length} cards and ${positions.length} positions from the add form`);
  await hp.getByRole('button', { name: /^חזרה$/ }).click();
  await hp.getByRole('button', { name: 'שאלות ותשובות' }).click();
  assert(hp.url().endsWith('#help'), 'help: top bar "?" opens #help');
  // Answers that point to a setting open it: "מי עם מי" unfolds that section, the draw rule goes to משחק.
  await hp.locator('details.help-q summary', { hasText: 'מי עם מי' }).click();
  await hp.getByRole('button', { name: 'להגדרת מי עם מי' }).click();
  assert(hp.url().endsWith('#settings/rules') && (await hp.locator('#set-rules').getAttribute('open')) !== null, 'help: "מי עם מי" opens its settings section');
  await hp.goto(base + '#help');
  await hp.locator('details.help-q summary', { hasText: 'מה קורה בתיקו?' }).click();
  await hp.getByRole('button', { name: 'לשינוי' }).click();
  assert(hp.url().endsWith('#settings/game') && (await hp.locator('#set-game').isVisible()), 'help: the draw answer opens the game settings');
  await hp.goto(base + '#help');
  assert((await hp.locator('details.help-q[open]').count()) === 0, 'help: questions start folded');
  const q = hp.locator('details.help-q').filter({ hasText: 'מה קורה בתיקו?' });
  await q.locator('summary').click();
  assert(await q.getByText('2 דקות תוספת', { exact: false }).isVisible(), 'help: a question opens with its answer');
  await hp.locator('details.help-q summary', { hasText: /^חוזקות$/ }).click();
  await hp.locator('details.help-q summary', { hasText: /^חולשות$/ }).click();
  await hp.locator('details.help-q summary', { hasText: /^עמדות$/ }).click();
  const legend = await hp.locator('.legend li').evaluateAll((ls) => ls.map((l) => [l.querySelector('.legend-emoji')?.textContent ?? '', l.querySelector('strong')?.textContent ?? '']));
  const has = ([e, n]) => legend.some(([le, ln]) => le === e && ln === n);
  const missing = [...cards, ...positions].filter((c) => !has(c));
  assert(!missing.length, `help: legend is missing ${missing.map((m) => m.join(' ')).join(', ')}`);
  // Search narrows the list and opens the matches.
  await hp.getByLabel('חיפוש בשאלות').fill('פנדלים');
  assert((await hp.locator('details.help-q').count()) < 10 && (await hp.locator('details.help-q[open]').count()) > 0, 'help: search filters and opens matches');
  // Back returns home; Settings has a row; the teams screen's score "?" opens that question.
  await hp.getByRole('button', { name: /^חזרה$/ }).click();
  await hp.getByRole('button', { name: 'הגדרות' }).click();
  await hp.locator('.help-link').click();
  await hp.getByRole('button', { name: /^חזרה$/ }).click();
  assert(hp.url().endsWith('#settings'), 'help: back goes to Settings when opened from there');
  await hp.getByRole('button', { name: /^חזרה$/ }).click();
  await hp.getByRole('button', { name: 'עושים כוחות' }).click();
  await hp.waitForSelector('.team');
  await hp.getByRole('button', { name: 'מה זה מדד האיזון?' }).click();
  assert(await hp.locator('#help-score[open]').isVisible(), 'help: score "?" opens the score question');
  await hp.getByRole('button', { name: 'לקבוצות' }).click();
  assert(hp.url().endsWith('#teams'), 'help: back returns to the teams');
  await hp.context().close();
}

// QA pass (v8): a re-split from the teams screen's "changed" banner asks before ending a live evening;
// a phone that kept the app open overnight starts the new day when it comes back to the screen;
// one imported player is "שחקן אחד".
{
  const qc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'he-IL' });
  const qp = await qc.newPage();
  qp.on('pageerror', (e) => errors.push(`qa: ${e.message}`));
  await qp.clock.install();
  const stored = () => qp.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)));
  await qp.goto(base);
  await qp.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).tap();
  await qp.goto(base + '#players');
  await qp.getByRole('button', { name: /ייבוא רשימה/ }).tap();
  await qp.getByLabel('רשימת שחקנים').fill('יחיד 6');
  assert((await qp.locator('.sheet .preview p').first().innerText()) === 'שחקן אחד מוכן', 'qa: one player ready (singular)');
  await qp.getByRole('button', { name: 'הוספת שחקן אחד' }).tap();
  assert(await qp.getByText('נוסף שחקן אחד').isVisible(), 'qa: one player added (singular)');
  await qp.goto(base + '#home');
  await qp.getByRole('button', { name: /^כולם$/ }).tap();
  await qp.locator('.attend label', { hasText: 'יחיד' }).tap();
  await qp.getByRole('button', { name: 'עושים כוחות' }).tap();
  await qp.waitForSelector('.team');
  await qp.getByRole('button', { name: /התחלת משחק/ }).tap();
  await qp.getByRole('button', { name: '+ גול' }).first().tap();
  await qp.getByRole('button', { name: 'דילוג' }).tap();
  await qp.getByRole('button', { name: 'סיום משחק' }).tap();
  // Someone is unticked at home instead of "עזב באמצע": the teams screen offers a re-split, which asks first.
  // (Ticking someone new during an evening opens "in now or wait" instead — checked in step 17.)
  await qp.goto(base + '#home');
  await qp.locator('.attend li', { has: qp.locator('input:checked') }).first().locator('label').tap();
  await qp.goto(base + '#teams');
  await qp.locator('.notice').getByRole('button', { name: 'חלוקה מחדש' }).tap();
  const ask = qp.getByRole('dialog', { name: 'לחלק מחדש?' });
  assert(await ask.isVisible(), 'qa: re-split during an evening asks first');
  assert(/משחק אחד/.test(await ask.innerText()), 'qa: the question says what is saved');
  await ask.getByRole('button', { name: 'ביטול' }).tap();
  assert((await stored()).match?.history.length === 1, 'qa: cancelling keeps the evening');
  // The app stays open; 13 hours later the phone shows it again (no reload).
  await qp.clock.fastForward(13 * 3600e3);
  await qp.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await qp.waitForTimeout(100);
  const later = await stored();
  assert(later.presentIds.length === 0 && !later.match && !later.result && later.history.length === 1, `qa: new day on return: ${later.presentIds.length} present, history ${later.history.length}`);
  assert(await qp.getByRole('button', { name: /כמו בפעם הקודמת/ }).isVisible(), 'qa: main screen offers "same as last time" after the new day');
  await qc.close();
}

// 17. During an evening: ticking someone at home asks "in now or wait" (no reshuffle), and a re-roll asks
// first.
{
  const ev = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  ev.on('pageerror', (e) => errors.push(e.message));
  await ev.goto(base);
  await ev.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  const first = ev.locator('ul.attend li').first();
  const who = (await first.locator('.name').innerText()).trim();
  if (await first.locator('input').isChecked()) await first.locator('label').click(); // he isn't here yet
  await ev.getByRole('button', { name: 'עושים כוחות' }).click();
  await ev.waitForSelector('.team');
  await ev.getByRole('button', { name: /התחלת משחק/ }).click();
  await ev.getByRole('button', { name: 'סיום משחק' }).click();
  if (await ev.locator('.pens-team').count()) await ev.locator('.pens-team').first().click();
  await ev.goto(base + '#home');
  await ev.locator('ul.attend li').first().locator('label').click();
  assert(await ev.getByRole('dialog', { name: `${who} הגיע` }).isVisible(), 'evening: ticking someone at home opens "in now or wait"');
  await ev.getByRole('button', { name: 'מחכה בצד' }).click();
  await ev.goto(base + '#teams');
  assert((await ev.locator('.stale, .notice', { hasText: 'השתנ' }).count()) === 0, 'evening: no re-split banner after a late tick');
  assert(await ev.locator('.subs, .bench').getByText(who).first().isVisible(), 'evening: he waits on the bench');
  await ev.getByRole('button', { name: /הגרלה מחדש/ }).click();
  assert(await ev.getByRole('dialog', { name: 'להגריל מחדש?' }).isVisible(), 'evening: re-roll asks first');
  await ev.getByRole('dialog').getByRole('button', { name: 'ביטול' }).click();
  await ev.context().close();
}

// 18. Logged out (v13): the sample squad is free, 4 own players are free; the 5th asks to log in and
// is added after it, and the group goes to the cloud; "+ קבוצה חדשה" asks too and goes on to the
// new group; a late "מישהו חדש" past the limit asks and goes on; an old phone keeps its 6 players.
{
  const gctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gs = cloudServer();
  await cloudRoutes(gctx, gs);
  const gp = await gctx.newPage();
  gp.on('pageerror', (e) => errors.push(`gate: ${e.message}`));
  const login = () => gp.getByRole('dialog', { name: 'התחברות' });
  const roster = () => gp.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)).players);
  await gp.goto(base);
  await gp.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  await gp.goto(base + '#players');
  for (const n of ['אחד', 'שתיים', 'שלוש', 'ארבע']) {
    await gp.getByPlaceholder('איך קוראים לו?').fill(n);
    await gp.getByRole('button', { name: /^הוספה$/ }).click();
  }
  assert(!(await login().count()) && (await roster()).length === 18, 'gate: 14 sample + 4 own need no login');
  await gp.getByPlaceholder('איך קוראים לו?').fill('חמש');
  await gp.getByRole('button', { name: /^הוספה$/ }).click();
  assert(await login().getByText('כדי להוסיף עוד שחקנים צריך להתחבר. זה חינם ולוקח רגע.').isVisible(), 'gate: the 5th own player asks to log in');
  assert((await roster()).length === 18 && gs.logins === 0, 'gate: not added before logging in');
  await loginInSheet(gp);
  await gp.waitForFunction(() => document.body.textContent.includes('חמש נוסף'), null, { timeout: 5000 }).catch(() => {});
  assert((await roster()).some((p) => p.name === 'חמש'), 'gate: the 5th is added after logging in');
  assert((await gp.getByPlaceholder('איך קוראים לו?').inputValue()) === '', 'gate: the add form is cleared after it');
  await gp.waitForFunction(() => JSON.parse(localStorage.getItem('kochot:groups')).groups[0].synced, null, { timeout: 5000 }).catch(() => {});
  assert(gs.calls.filter((c) => c.rpc === 'create_group').length === 1, 'gate: the local group is uploaded after the login');
  await gctx.close();

  // "+ קבוצה חדשה" while logged out → login → on to the new group, created in the cloud.
  const nctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ns = cloudServer();
  await cloudRoutes(nctx, ns);
  const np = await nctx.newPage();
  np.on('pageerror', (e) => errors.push(`gate group: ${e.message}`));
  await np.goto(base);
  await np.getByRole('button', { name: /החלפת קבוצה/ }).click();
  await np.getByRole('button', { name: /קבוצה חדשה/ }).click();
  assert(await np.getByRole('dialog', { name: 'התחברות' }).getByText('כדי לפתוח עוד קבוצה צריך להתחבר').isVisible(), 'gate: a second group asks to log in');
  await loginInSheet(np);
  await np.getByLabel('שם הקבוצה').fill('בבסיס');
  await np.getByRole('button', { name: 'יצירה' }).click();
  assert(await np.getByRole('button', { name: /קבוצה: בבסיס/ }).isVisible(), 'gate: the new group opens after logging in');
  await np.waitForFunction(() => JSON.parse(localStorage.getItem('kochot:groups')).groups.some((g) => g.name === 'בבסיס' && g.synced), null, { timeout: 5000 }).catch(() => {});
  const made = ns.calls.filter((c) => c.rpc === 'create_group').map((c) => c.body.p_name);
  assert(JSON.stringify(made) === '["בבסיס"]', `gate: only the new group goes up (the empty default stays local): ${made}`);
  await nctx.close();

  // Late arrival "מישהו חדש" past the limit; an old phone with 6 own players keeps them.
  const lctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ls = cloudServer();
  await cloudRoutes(lctx, ls);
  const lp = await lctx.newPage();
  lp.on('pageerror', (e) => errors.push(`gate late: ${e.message}`));
  await lp.goto(base);
  await lp.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem('kochot:groups'));
    const players = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'].map((name, i) => ({ id: `old${i}`, name: `ותיק ${name}`, attrs: { overall: 5 + (i % 3) }, canGK: false, cards: [] }));
    localStorage.setItem(`kochot:group:${idx.currentId}`, JSON.stringify({ version: 2, players, presentIds: players.map((p) => p.id), dayAt: Date.now(), teamSize: 3, settings: {}, constraints: { together: [], apart: [] }, result: null, match: null }));
  });
  await lp.reload();
  await lp.getByRole('button', { name: 'עושים כוחות' }).click();
  await lp.waitForSelector('.team');
  const kept = await lp.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)).players.length);
  assert(kept === 6, `gate: an old phone keeps its ${kept} players`);
  await lp.getByRole('button', { name: /הגיע מאוחר/ }).click();
  await lp.getByPlaceholder('שם').fill('אורח');
  await lp.getByRole('button', { name: 'המשך' }).click();
  assert(await lp.getByRole('dialog', { name: 'התחברות' }).getByText('כדי להוסיף עוד שחקנים').isVisible(), 'gate: a new late arrival past the limit asks to log in');
  await loginInSheet(lp);
  assert(await lp.getByRole('dialog', { name: 'אורח הגיע' }).isVisible(), 'gate: after logging in, on to "in now or wait"');
  await lp.getByRole('button', { name: 'מחכה בצד' }).click();
  assert((await lp.locator('.bench .member', { hasText: 'אורח' }).count()) === 1, 'gate: the late arrival waits on the side');
  await lctx.close();
}

// 9. Organizer of a cloud group (v10), with a mocked session; every Supabase call is answered here
// (nothing reaches the real project): tonight is published to the live row, ended with null, and
// a permitted player's vote moves a level (pushed with the group).
{
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await octx.newPage();
  pg.on('pageerror', (e) => errors.push(`org: ${e.message}`));
  const ME = '00000000-0000-4000-8000-0000000000aa';
  const RATER = '00000000-0000-4000-8000-0000000000bb';
  const lives = [];
  const pushes = [];
  let votes = [];
  let roster = [];
  await pg.routeWebSocket(/supabase\.co/, () => {});
  await pg.route(/supabase\.co/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rest/v1/groups')) {
      if (req.method() === 'GET') return json({ id: u.searchParams.get('id').slice(3), name: 'ערב', version: 1 + pushes.length, data: { v: 1, players: roster, constraints: { together: [], apart: [] } } });
      pushes.push(req.postDataJSON());
      return json([{ version: 1 + pushes.length }]);
    }
    const rpc = u.pathname.split('/rpc/')[1];
    if (rpc === 'live_set') lives.push(req.postDataJSON().p_data);
    if (rpc === 'group_votes') return json(votes);
    if (rpc === 'live_get') return json([]);
    return json(null);
  });
  await pg.goto(base);
  await pg.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  await pg.waitForTimeout(200);
  roster = await pg.evaluate((me) => {
    const idx = JSON.parse(localStorage.getItem('kochot:groups'));
    idx.groups = idx.groups.map((g) => (g.id === idx.currentId ? { ...g, synced: true } : g));
    localStorage.setItem('kochot:groups', JSON.stringify(idx));
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const user = { id: me, aud: 'authenticated', role: 'authenticated', email: 'o@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-10-18T10:00:00Z' };
    const access_token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: me, exp, role: 'authenticated' })}.c2ln`;
    localStorage.setItem('sb-cieyeoyuwddobrxjcffw-auth-token', JSON.stringify({ access_token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user }));
    return JSON.parse(localStorage.getItem(`kochot:group:${idx.currentId}`)).players;
  }, ME);
  const target = roster.find((p) => p.attrs.overall !== 2);
  votes = [{ rater: RATER, player_id: target.id, level: 2, updated_at: '2026-10-21T18:00:00Z' }];
  await pg.reload();
  await pg.waitForFunction(
    (id) => {
      const idx = JSON.parse(localStorage.getItem('kochot:groups'));
      return JSON.parse(localStorage.getItem(`kochot:group:${idx.currentId}`)).players.find((p) => p.id === id).attrs.overall === 2;
    },
    target.id,
    { timeout: 10000 },
  ).catch(() => errors.push("org: a player's vote didn't set the level"));
  await pg.waitForTimeout(2500);
  assert(pushes.some((d) => d.data.players.find((p) => p.id === target.id)?.attrs.overall === 2), 'org: the voted level is pushed');
  assert(!pushes.some((d) => JSON.stringify(d).includes(RATER)), "org: players' votes stay out of the doc");
  const pushesAfterVote = pushes.length;
  assert(lives.length === 0, `org: nothing to publish before teams (${lives.length})`);

  await pg.goto(base + '#home');
  await pg.getByRole('button', { name: 'עושים כוחות' }).click();
  await pg.waitForSelector('.team');
  await pg.waitForTimeout(1600);
  assert(lives.length === 1 && lives[0]?.v === 1 && lives[0].teams.length >= 2 && lives[0].match === null, `org: teams published once (${lives.length})`);
  assert(!/attrs|levelVotes|overall|cards/.test(JSON.stringify(lives)), 'org: no ratings in the live data');
  await pg.getByRole('button', { name: /התחלת משחק/ }).click();
  await pg.getByRole('button', { name: /התחלה/ }).click();
  await pg.getByRole('button', { name: '+ גול' }).first().click();
  await pg.getByRole('button', { name: 'דילוג' }).click();
  await pg.waitForTimeout(1600);
  const last = lives.at(-1);
  assert(last?.match?.clock.running === true && last.match.score[0] + last.match.score[1] === 1, `org: running match with the goal published: ${JSON.stringify(last?.match?.score)}`);
  const n = lives.length;
  await pg.waitForTimeout(1500);
  assert(lives.length === n, 'org: a ticking clock is not republished');
  await pg.getByRole('button', { name: 'סיום משחק' }).click();
  await pg.getByRole('button', { name: 'סיום הערב' }).click();
  await pg.locator('.sheet').getByRole('button', { name: 'סיום הערב' }).click();
  await pg.waitForTimeout(1600);
  assert(lives.at(-1) === null, `org: the end of the evening publishes null (${JSON.stringify(lives.at(-1))?.slice(0, 40)})`);
  const ended = lives.length;
  await pg.reload();
  await pg.waitForTimeout(2000);
  assert(lives.length === ended, 'org: an ended evening is not republished on open');
  assert(pushes.length - pushesAfterVote <= 2, `org: no push loop (${pushes.length - pushesAfterVote} pushes after the vote)`);
  console.log(`organizer: ${lives.length} live writes (${lives.map((l) => (l ? (l.match ? 'match' : 'teams') : 'ended')).join(', ')}), ${pushes.length} group pushes`);
  await octx.close();
}

// 9b. Runner handoff, organizer side (v12), on a mocked server with the v12 rules: a player takes
// control → this phone's next write is refused → read-only with whose phone runs it → take it back
// (imports the player's goal, publishes with the rev) → he takes it again → "סיום הערב" takes
// control first and ends it → a second organizer phone opens read-only and writes nothing.
{
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await octx.newPage();
  pg.on('pageerror', (e) => errors.push(`handoff: ${e.message}`));
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
  await pg.waitForTimeout(1600);
  await pg.getByRole('button', { name: /התחלת משחק/ }).click();
  await pg.getByRole('button', { name: /התחלה/ }).click();
  await pg.waitForTimeout(1600);
  assert(srv.runner === ORG_ME && srv.data?.match, `handoff: the organizer runs it first (${srv.runner})`);
  const sets = () => srv.calls.filter((c) => c.rpc === 'live_set');
  assert(sets()[0]?.body.p_rev === undefined && sets().at(-1)?.body.p_rev === srv.rev - 1, `handoff: first publish without rev, then with it (${sets().map((c) => c.body.p_rev)})`);

  playOnElsewhere(srv); // a player took control and scored
  await pg.getByRole('button', { name: '+ גול' }).last().click();
  await pg.getByRole('button', { name: 'דילוג' }).click();
  await pg.getByText('מנוהל מהטלפון של דני').waitFor({ timeout: 5000 }).catch(() => errors.push('handoff: no viewer line after a refused write'));
  assert((await pg.getByRole('button', { name: '+ גול' }).count()) === 0, 'handoff: no match controls while someone else runs it');
  assert(srv.runner !== ORG_ME, 'handoff: the refused write took nothing');
  const n = sets().length;

  await pg.getByRole('button', { name: 'לקחת את הניהול בחזרה' }).click();
  await pg.getByRole('button', { name: '+ גול' }).first().waitFor();
  await pg.waitForTimeout(600);
  const scores = await pg.locator('.pitch .goals').allInnerTexts();
  assert(scores.join() === '1,0', `handoff: the player's goal imported, ours dropped (${scores})`);
  const take = srv.calls.findLastIndex((c) => c.rpc === 'take_control');
  assert(take >= 0 && sets().length === n + 1 && sets().at(-1).body.p_rev === srv.rev - 1, `handoff: taken back and published with the rev (${sets().at(-1)?.body.p_rev}/${srv.rev})`);
  assert(srv.runner === ORG_ME && srv.data.match.score.join() === '1,0', 'handoff: the row is ours again');
  const st = await groupState(pg);
  assert(st.app.match.goals.length === 1 && st.app.presentIds.length === st.app.result.playerIds.length + st.app.result.subIds.length, 'handoff: imported match and attendance');

  playOnElsewhere(srv, '00000000-0000-4000-8000-0000000000cc', 'דני');
  await pg.reload();
  await pg.getByText('מנוהל מהטלפון של דני').waitFor({ timeout: 5000 }).catch(() => errors.push('handoff: reopening while someone else runs it is not read-only'));
  const before = sets().length;
  await pg.getByRole('button', { name: 'סיום הערב' }).click();
  await pg.locator('.sheet').getByRole('button', { name: 'סיום הערב' }).click();
  await pg.waitForURL(/#evening\//, { timeout: 5000 }).catch(() => errors.push('handoff: ending did not open the evening summary'));
  await pg.waitForTimeout(1600);
  assert(srv.calls.filter((c) => c.rpc === 'take_control').length === 2, 'handoff: ending took control first');
  assert(sets().length > before && sets().at(-1).body.p_data === null && typeof sets().at(-1).body.p_rev === 'number', `handoff: ended with null and the rev (${JSON.stringify(sets().at(-1)?.body).slice(0, 60)})`);
  const ended = await groupState(pg);
  assert(ended.app.history.length === 1 && ended.app.history[0].matches.length === 1, `handoff: the evening is in the history with the player's goal (${ended.app.history[0]?.matches.length})`);

  // A second organizer phone (same roster, no teams) while another organizer runs tonight.
  srv.data = null;
  srv.runner = null;
  const phone1 = ended;
  await pg.goto(base + '#home');
  await pg.getByRole('button', { name: 'עושים כוחות' }).click();
  await pg.waitForSelector('.team');
  await pg.getByRole('button', { name: /התחלת משחק/ }).click();
  await pg.waitForTimeout(1600);
  srv.runner = '00000000-0000-4000-8000-0000000000dd';
  srv.runnerName = 'משה';
  const p2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pg2 = await p2.newPage();
  pg2.on('pageerror', (e) => errors.push(`second phone: ${e.message}`));
  await organizerRoutes(pg2, srv);
  await pg2.goto(base);
  await pg2.evaluate((st) => {
    localStorage.setItem('kochot:groups', JSON.stringify(st.index));
    localStorage.setItem(`kochot:group:${st.gid}`, JSON.stringify({ ...st.app, result: null, match: null, presentIds: [], history: [] }));
  }, phone1);
  await signInOrganizer(pg2);
  const setsBefore = sets().length;
  await pg2.reload();
  await pg2.getByText('מנוהל מהטלפון של משה').waitFor({ timeout: 5000 }).catch(() => errors.push('second phone: no viewer line on home'));
  await pg2.getByRole('button', { name: /^לערב/ }).click();
  await pg2.getByRole('button', { name: 'לקחת את הניהול בחזרה' }).waitFor();
  await pg2.waitForTimeout(1500);
  assert(sets().length === setsBefore, 'second phone: nothing written while someone else runs it');
  await p2.close();
  await octx.close();
}

// 14. "המשך עם Google" on our own page (v11): Google's script loads only when the login sheet opens;
// its credential and the raw nonce go to Supabase's id_token grant (the nonce Google got is its
// SHA-256); an invite opened before logging in is then joined. GIS and Supabase are stubbed here.
{
  const gctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await gctx.newPage();
  pg.on('pageerror', (e) => errors.push(`gis: ${e.message}`));
  const gisLoads = [];
  let tokenBody = null;
  let joined = null;
  await pg.route('https://accounts.google.com/**', (route) => {
    gisLoads.push(route.request().url());
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `window.__gis = { inits: [], opts: null };
        window.google = { accounts: { id: {
          initialize(c) { window.__gis.inits.push({ client_id: c.client_id, nonce: c.nonce }); window.__gis.cb = c.callback; },
          renderButton(el, o) { window.__gis.opts = o; el.textContent = ''; const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Google (stub)'; b.onclick = () => window.__gis.cb({ credential: 'stub.id.token' }); el.appendChild(b); },
        } } };`,
    });
  });
  await pg.routeWebSocket(/supabase\.co/, () => {});
  await pg.route(/supabase\.co/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/auth/v1/settings')) return json({ external: { google: true, email: true } });
    if (u.pathname.endsWith('/auth/v1/token') && u.searchParams.get('grant_type') === 'id_token') {
      tokenBody = req.postDataJSON();
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const id = '00000000-0000-4000-8000-0000000000cc';
      return json({
        access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, exp, role: 'authenticated' })}.c2ln`,
        refresh_token: 'r',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: exp,
        user: { id, aud: 'authenticated', role: 'authenticated', email: 'g@example.com', app_metadata: { provider: 'google' }, user_metadata: {}, created_at: '2026-10-21T10:00:00Z' },
      });
    }
    const GID = '22222222-3333-4444-8555-666666666666';
    if (u.pathname.endsWith('/rpc/join_group')) {
      joined = req.postDataJSON();
      return json([{ group_id: GID, name: 'מוזמנים', role: 'organizer' }]);
    }
    if (u.pathname.endsWith('/rest/v1/groups')) {
      if (req.method() === 'GET') return json({ id: GID, name: 'מוזמנים', version: 1, data: { v: 1, players: [], constraints: { together: [], apart: [] } } });
      return json([{ version: 2 }]);
    }
    return json(null);
  });
  await pg.goto(base);
  await pg.waitForTimeout(400);
  assert(gisLoads.length === 0, `gis: Google's script isn't loaded before the login sheet (${gisLoads})`);
  await pg.goto(base + '#join=TOKEN123');
  await pg.reload();
  await pg.getByRole('button', { name: 'Google (stub)' }).click({ timeout: 10000 });
  await pg.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 10000 }).catch(() => errors.push('gis: the login sheet stays open after Google'));
  const gis = await pg.evaluate(() => window.__gis);
  const init = gis.inits.at(-1);
  assert(gisLoads.length === 1 && gisLoads[0].startsWith('https://accounts.google.com/gsi/client'), `gis: script loaded once (${gisLoads})`);
  assert(/^826193645474-.*\.apps\.googleusercontent\.com$/.test(init?.client_id ?? ''), `gis: client id ${init?.client_id}`);
  assert(gis.opts?.text === 'continue_with' && gis.opts?.locale === 'he' && gis.opts?.theme === 'outline', `gis: button options ${JSON.stringify(gis.opts)}`);
  assert(tokenBody?.provider === 'google' && tokenBody?.id_token === 'stub.id.token', `gis: id_token grant ${JSON.stringify(tokenBody)}`);
  assert(!!tokenBody?.nonce && tokenBody.nonce !== init?.nonce && createHash('sha256').update(tokenBody.nonce).digest('hex') === init?.nonce, 'gis: raw nonce to Supabase, its SHA-256 to Google');
  await pg.waitForFunction(() => document.body.textContent.includes('הצטרפתם לקבוצה'), null, { timeout: 10000 }).catch(() => {});
  assert(joined?.p_token === 'TOKEN123', `gis: the invite is joined after logging in (${JSON.stringify(joined)})`);
  console.log(`google: id_token + nonce ok, invite ${joined?.p_token} joined`);
  await gctx.close();

  // Google's script can't load: the old button (through Supabase) with a short note.
  const fctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const fp = await fctx.newPage();
  fp.on('pageerror', (e) => errors.push(`gis fallback: ${e.message}`));
  await fp.route('https://accounts.google.com/**', (r) => r.abort());
  await fp.route(/supabase\.co/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"external":{"google":true,"email":true}}' }));
  await fp.goto(base + '#settings');
  await fp.getByRole('button', { name: 'התחברות', exact: true }).click();
  await fp.getByText('Google לא נטען כאן').waitFor({ timeout: 10000 }).catch(() => errors.push('gis fallback: no note when Google fails to load'));
  assert(await fp.getByRole('button', { name: 'המשך עם Google' }).isEnabled(), 'gis fallback: the redirect button works');
  await fctx.close();
}

// 14b. Login fixes from a real iPhone (v16), on a mocked Supabase and Google.
// Email link: asked for in one browser, opened in another (implicit flow: the session is in the
// link) → logged in there, the address cleaned, the invite that rode along joined. An expired link
// says so. iPhone Safari: Google's button redirects to our /api/gsi (the real handler, api/gsi.ts),
// which hands the token back as #gsi= → id_token grant with the raw nonce. A refused token or a
// failed CSRF check says so in Hebrew, never a blank page.
{
  const { handleGsi } = await import('./gsi-route.mjs');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = () => Math.floor(Date.now() / 1000) + 3600;
  const UID = '00000000-0000-4000-8000-0000000000ee';
  const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'link@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-21T10:00:00Z' };
  const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp: exp(), role: 'authenticated', aud: 'authenticated' })}.c2ln`;
  const GID = '33333333-4444-4555-8666-777777777777';
  const sbMock = async (target, s) => {
    await target.routeWebSocket(/supabase\.co/, () => {});
    await target.route(/supabase\.co/, async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname.endsWith('/auth/v1/settings')) return json({ external: { google: true, email: true } });
      if (u.pathname.endsWith('/auth/v1/otp')) {
        s.otp = { body: req.postDataJSON(), redirectTo: u.searchParams.get('redirect_to') };
        return json({});
      }
      if (u.pathname.endsWith('/auth/v1/user')) return json(user);
      if (u.pathname.endsWith('/auth/v1/token') && u.searchParams.get('grant_type') === 'id_token') {
        s.idToken = req.postDataJSON();
        if (s.refuse) return json({ code: 400, error_code: 'bad_jwt', msg: 'Passed nonce and nonce in id_token should either both exist or not.' }, 400);
        return json({ access_token: jwt(), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp(), user: { ...user, app_metadata: { provider: 'google' } } });
      }
      if (u.pathname.endsWith('/rpc/join_group')) {
        s.joined = req.postDataJSON();
        return json([{ group_id: GID, name: 'מהמייל', role: 'organizer' }]);
      }
      if (u.pathname.endsWith('/rest/v1/groups')) {
        if (req.method() === 'GET') return json({ id: GID, name: 'מהמייל', version: 1, data: { v: 1, players: [], constraints: { together: [], apart: [] } } });
        return json([{ version: 2 }]);
      }
      return json(null);
    });
  };
  const sessionStored = (pg) => pg.evaluate(() => Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)));

  // Safari asks for the link (an invite is waiting)…
  const s = {};
  const actx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await actx.route('https://accounts.google.com/**', (r) => r.abort());
  await sbMock(actx, s);
  const ap = await actx.newPage();
  ap.on('pageerror', (e) => errors.push(`email link: ${e.message}`));
  await ap.goto(base + '#join=MAILTOK');
  const sheet = ap.getByRole('dialog', { name: 'התחברות' });
  await sheet.getByLabel('מייל', { exact: true }).fill('link@example.test');
  await sheet.getByRole('button', { name: 'שליחת קישור למייל' }).click();
  await sheet.getByText('שלחנו מייל. פותחים אותו ולוחצים על הקישור').waitFor({ timeout: 5000 }).catch(() => errors.push('email link: no "sent" line'));
  assert(await sheet.getByText('אם הקישור נפתח בדפדפן אחר — ההתחברות תהיה שם.').isVisible(), 'email link: the other-browser line');
  assert(!(await sheet.getByLabel('הקוד מהמייל').count()), 'email link: no code field without VITE_EMAIL_CODE');
  assert(s.otp && !s.otp.body.code_challenge, `email link: implicit flow, no PKCE challenge (${JSON.stringify(s.otp?.body)})`);
  assert(s.otp?.redirectTo === `${base}?join=MAILTOK`, `email link: the invite rides along (${s.otp?.redirectTo})`);
  await actx.close();

  // …the mail app opens it in another browser (fresh storage).
  const bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await bctx.route('https://accounts.google.com/**', (r) => r.abort());
  await sbMock(bctx, s);
  const bp = await bctx.newPage();
  bp.on('pageerror', (e) => errors.push(`email link (other browser): ${e.message}`));
  await bp.goto(`${s.otp?.redirectTo ?? base}#access_token=${jwt()}&expires_at=${exp()}&expires_in=3600&refresh_token=r&token_type=bearer&type=magiclink`);
  const firstUrl = await bp.evaluate(() => location.href);
  assert(!/access_token|refresh_token/.test(firstUrl), `email link: the tokens leave the address at once (${firstUrl})`);
  await bp.getByText('הצטרפתם לקבוצה ״מהמייל״').waitFor({ timeout: 10000 }).catch(() => errors.push('email link: the invite is not joined in the other browser'));
  assert(s.joined?.p_token === 'MAILTOK', `email link: joined ${JSON.stringify(s.joined)}`);
  assert(await sessionStored(bp), 'email link: logged in in the other browser');
  assert(!(await bp.getByRole('dialog', { name: 'התחברות' }).count()), 'email link: no login sheet after the link');
  assert(!/access_token|join=/.test(await bp.evaluate(() => location.href)), 'email link: address clean');
  await bctx.close();

  // An expired / already used link.
  const ectx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await sbMock(ectx, {});
  const ep = await ectx.newPage();
  ep.on('pageerror', (e) => errors.push(`expired link: ${e.message}`));
  await ep.goto(`${base}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
  await ep.getByText('הקישור פג תוקף או שכבר השתמשו בו. שלחו קישור חדש').waitFor({ timeout: 8000 }).catch(() => errors.push('expired link: no message'));
  assert(!/error/.test(await ep.evaluate(() => location.href)), 'expired link: address clean');
  await ectx.close();

  // iPhone Safari: Google's button in redirect mode → POST /api/gsi → #gsi= → id_token grant.
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const gisStub = `window.__gis = { inits: [] };
    window.google = { accounts: { id: {
      initialize(c) { window.__gis.inits.push({ client_id: c.client_id, nonce: c.nonce, ux_mode: c.ux_mode, login_uri: c.login_uri, callback: typeof c.callback }); localStorage.setItem('__gisInit', JSON.stringify(window.__gis.inits.at(-1))); },
      renderButton(el) { el.textContent = ''; const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Google (stub)';
        b.onclick = () => { const c = window.__gis.inits.at(-1); document.cookie = 'g_csrf_token=' + (window.__csrfCookie ?? 'csrf1') + '; path=/';
          const f = document.createElement('form'); f.method = 'POST'; f.action = c.login_uri;
          for (const [k, v] of [['credential', 'stub.ios.token'], ['g_csrf_token', 'csrf1']]) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); }
          document.body.appendChild(f); f.submit(); };
        el.appendChild(b); },
    } } };`;
  const iosRun = async (label, opts) => {
    const st = { refuse: !!opts.refuse };
    const ictx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ictx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: gisStub }));
    await ictx.route('**/api/gsi', (r) => handleGsi(r, st));
    await sbMock(ictx, st);
    const ip = await ictx.newPage();
    ip.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    if (opts.badCookie) await ip.addInitScript(() => (window.__csrfCookie = 'other'));
    await ip.goto(base + '#settings');
    await ip.getByRole('button', { name: 'התחברות', exact: true }).click();
    await ip.getByRole('button', { name: 'Google (stub)' }).click({ timeout: 10000 });
    await ip.waitForURL((u) => !u.pathname.startsWith('/api/'), { timeout: 10000 }).catch(() => errors.push(`${label}: stuck on /api/gsi`));
    await ip.waitForTimeout(300);
    const r = { ip, ictx, st, init: await ip.evaluate(() => JSON.parse(localStorage.getItem('__gisInit') ?? 'null')), url: await ip.evaluate(() => location.href) };
    assert(r.init?.ux_mode === 'redirect' && r.init?.login_uri === new URL('/api/gsi', base).href && r.init?.callback === 'undefined', `${label}: GIS redirect mode ${JSON.stringify(r.init)}`);
    assert(!/gsi/.test(r.url) && r.url.endsWith('#settings'), `${label}: back on the same screen, address clean (${r.url})`);
    assert(st.gsi?.status === 303 && st.gsi?.cacheControl === 'no-store', `${label}: /api/gsi answered ${JSON.stringify(st.gsi)}`);
    return r;
  };
  {
    const { ip, ictx, st, init } = await iosRun('ios google', {});
    await ip.waitForFunction(() => Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)), null, { timeout: 10000 }).catch(() => errors.push('ios google: not logged in'));
    assert(st.idToken?.provider === 'google' && st.idToken?.id_token === 'stub.ios.token', `ios google: id_token grant ${JSON.stringify(st.idToken)}`);
    assert(!!st.idToken?.nonce && createHash('sha256').update(st.idToken.nonce).digest('hex') === init?.nonce, 'ios google: raw nonce (kept across the redirect) to Supabase, its SHA-256 to Google');
    await ip.getByText('יציאה מהחשבון').first().waitFor({ timeout: 5000 }).catch(() => errors.push('ios google: settings do not show the account'));
    await ictx.close();
    console.log('ios google: redirect → /api/gsi → id_token + nonce ok');
  }
  {
    const { ip, ictx } = await iosRun('ios google refused', { refuse: true });
    await ip.getByText('ההתחברות עם Google לא הצליחה. נסו שוב, או התחברו עם מייל').waitFor({ timeout: 8000 }).catch(() => errors.push('ios google refused: no Hebrew message'));
    assert((await ip.locator('#root > *').count()) > 0 && !(await sessionStored(ip)), 'ios google refused: the app is on screen, not logged in');
    await ictx.close();
  }
  {
    const { ip, ictx, st } = await iosRun('ios google csrf', { badCookie: true });
    await ip.getByText('ההתחברות עם Google לא הצליחה. נסו שוב, או התחברו עם מייל').waitFor({ timeout: 8000 }).catch(() => errors.push('ios google csrf: no Hebrew message'));
    assert(!st.idToken, 'ios google csrf: no token sent to Supabase');
    await ictx.close();
  }
}

// 14. A player runs the match from his phone (v12), on a mocked Supabase: take control (asks first,
// since the organizer runs it) → match controls → a goal is published with the rev → reload resumes →
// "stop" → viewer; again, then the organizer takes it back → the next write conflicts → viewer + toast.
if (SB_URL) {
  const { ctx: rctx, page: rp, db } = await playerContext(browser, { me: 'p3', canRate: false });
  rp.on('pageerror', (e) => errors.push(`runner: ${e.message}`));
  const runnerKey = `kochot:runner:${GID}`;
  const stored = () => rp.evaluate((k) => localStorage.getItem(k), runnerKey);
  const waitFor = async (fn, what) => {
    for (let i = 0; i < 40 && !fn(); i++) await rp.waitForTimeout(100);
    assert(fn(), `runner: ${what}`);
  };
  await rp.goto(base);
  await rp.waitForSelector('.live');
  assert(await rp.getByText('מנוהל מהטלפון של אלי').count(), 'runner: "run by" line missing');
  assert(!(await rp.locator('.clock-ctrl').count()), 'runner: controls before taking control');
  await rp.getByRole('button', { name: 'לנהל מהטלפון שלי' }).click();
  await rp.getByRole('dialog').getByText('מי שמנהל עכשיו יעבור לצפייה').waitFor();
  await rp.getByRole('dialog').getByRole('button', { name: 'לנהל מהטלפון שלי' }).click();
  await rp.locator('.clock-ctrl').waitFor({ timeout: 5000 }).catch(() => errors.push('runner: no controls after taking control'));
  assert(db.runner === ME && db.rev === 5, `runner: take_control ${db.runner} ${db.rev}`);
  assert(!(await rp.getByRole('button', { name: 'סיום הערב' }).count()), 'runner: "סיום הערב" shown to a player');
  for (const link of ['מישהו הגיע?', 'מישהו עזב?']) assert(await rp.getByRole('button', { name: link }).count(), `runner: "${link}" missing (v15)`);
  await rp.locator('.btn-goal').first().click();
  await rp.getByRole('dialog').getByRole('button', { name: 'גיל' }).click();
  await waitFor(() => db.sets.length === 1, `goal not published (${db.sets.length})`);
  assert(db.sets[0]?.rev === 5, `runner: live_set rev ${db.sets[0]?.rev}`);
  assert(JSON.stringify(db.data.match?.score) === '[3,1]', `runner: published score ${JSON.stringify(db.data.match?.score)}`);
  assert(db.data.match?.goals.at(-1)?.by === 'p3', 'runner: scorer not published');
  assert(!/attrs|levelVotes|cards/.test(JSON.stringify(db.data)), 'runner: ratings in the snapshot');
  const groupState = await rp.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), `kochot:group:${GID}`);
  assert(!groupState.result && !groupState.match, 'runner: the evening leaked into the group state');
  assert(JSON.parse((await stored()) ?? 'null')?.rev === 6, 'runner: rev not kept');
  // Reload: still the controls, from this phone.
  await rp.reload();
  await rp.locator('.clock-ctrl').waitFor({ timeout: 5000 }).catch(() => errors.push('runner: no controls after reload'));
  assert((await rp.locator('.match .goals').first().textContent()) === '3', 'runner: score lost on reload');
  // Stop running → viewer, nobody runs it.
  await rp.getByRole('button', { name: 'להפסיק לנהל' }).click();
  await rp.waitForSelector('.live');
  await waitFor(() => db.runner === null, 'release_control not called');
  assert((await stored()) === null, 'runner: local evening kept after release');
  assert(!(await rp.getByText('מנוהל מהטלפון של').count()), 'runner: "run by" shown with nobody running');
  // Nobody runs it: one tap, no question. Then the organizer takes it back.
  await rp.getByRole('button', { name: 'לנהל מהטלפון שלי' }).click();
  await rp.locator('.clock-ctrl').waitFor({ timeout: 5000 }).catch(() => errors.push('runner: no controls on the second take'));
  db.runner = ORG;
  db.runnerName = 'אלי';
  db.rev++;
  const sets = db.sets.length;
  await rp.locator('.btn-goal').first().click();
  await rp.getByRole('dialog').getByRole('button', { name: 'דילוג' }).click();
  await rp.waitForSelector('.live', { timeout: 5000 }).catch(() => errors.push('runner: still the controls after losing control'));
  await rp.getByText('הניהול עבר לאלי').waitFor({ timeout: 3000 }).catch(() => errors.push('runner: no "control moved" toast'));
  assert(db.sets.length === sets, 'runner: wrote after losing control');
  assert((await stored()) === null, 'runner: local evening kept after losing control');
  console.log(`runner: ${db.sets.length} live writes, revs ${db.sets.map((x) => x.rev).join(',')}`);
  await rctx.close();
}

// 14b. A player runner marks arrivals and leaves (v15): roster only (no new players), the smallest
// team, no rating-based suggestions; everything goes out in the live snapshot.
if (SB_URL) {
  const { ctx: lctx, page: lp, db } = await playerContext(browser, { me: 'p3', canRate: false });
  lp.on('pageerror', (e) => errors.push(`runner late: ${e.message}`));
  // ליאור (p12) isn't here tonight: yellow plays one short.
  db.data.teams[2].ids = db.data.teams[2].ids.filter((id) => id !== 'p12');
  db.data.players = db.data.players.filter((p) => p.id !== 'p12');
  const waitFor = async (fn, what) => {
    for (let i = 0; i < 40 && !fn(); i++) await lp.waitForTimeout(100);
    assert(fn(), `runner late: ${what}`);
  };
  await lp.goto(base);
  await lp.waitForSelector('.live');
  await lp.getByRole('button', { name: 'לנהל מהטלפון שלי' }).click();
  await lp.getByRole('dialog').getByRole('button', { name: 'לנהל מהטלפון שלי' }).click();
  await lp.locator('.clock-ctrl').waitFor({ timeout: 5000 });
  await lp.getByRole('button', { name: 'מישהו הגיע?' }).click();
  const sheet = lp.getByRole('dialog');
  await sheet.getByText('שחקן חדש? המארגן מוסיף אותו').waitFor({ timeout: 3000 }).catch(() => errors.push('runner late: no "new player" line'));
  assert(!(await sheet.locator('input').count()), 'runner late: a new-player form for a player');
  assert(await sheet.getByRole('button', { name: 'מתן' }).count(), 'runner late: the bench not offered');
  await sheet.getByRole('button', { name: 'ליאור' }).click();
  await sheet.getByRole('button', { name: /^נכנס עכשיו/ }).click();
  await waitFor(() => db.data.teams[2].ids.includes('p12'), `arrival not published (${JSON.stringify(db.data.teams[2].ids)})`);
  assert(db.data.players.some((p) => p.id === 'p12'), 'runner late: arrival missing from players');
  await lp.getByRole('button', { name: 'מישהו עזב?' }).click();
  await sheet.getByRole('button', { name: 'יוסי' }).click();
  await sheet.getByRole('button', { name: 'כן, הוא עזב' }).click();
  await sheet.getByText('להכניס מחליף?').waitFor({ timeout: 3000 }).catch(() => errors.push('runner late: no sub pick after a leave'));
  assert(!(await sheet.getByText('הכי מתאים').count()) && !(await sheet.getByText('האיזון').count()), 'runner late: a rating-based suggestion');
  await sheet.getByRole('button', { name: 'להשאיר ככה' }).click();
  await waitFor(() => !db.data.teams[2].ids.includes('p10'), 'leave not published');
  assert(db.data.gone?.some((p) => p.id === 'p10'), `runner late: who left not in the snapshot (${JSON.stringify(db.data.gone)})`);
  assert(db.data.subs.join() === 'p13', `runner late: bench ${db.data.subs}`);
  assert(!/"(attrs|levelVotes|cards|overall|weaknesses)":/.test(JSON.stringify(db.data)), 'runner late: ratings in the snapshot');
  console.log(`runner late/left: ${db.sets.length} live writes`);
  await lctx.close();
}

// 19. WhatsApp import (v14), logged out on a mocked Supabase: the iPhone .zip export → the names
// checklist (most messages first, one already in the roster greyed, numbers unchecked) → past the
// 4 free players the login sheet → the quick rating (rate two, skip one, finish). Then the Android
// share target: a chat POSTed to ./share-target through the service worker opens the checklist.
// The phone's contacts (stubbed picker). No phone number is stored anywhere.
{
  const wctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await wctx.addInitScript(() => {
    navigator.contacts = { select: async () => [{ name: ['רונן'] }, { name: ['‪+972 52-999-4567‬'] }, { name: [] }] };
  });
  const ws = cloudServer();
  await cloudRoutes(wctx, ws);
  const wp = await wctx.newPage();
  wp.on('pageerror', (e) => errors.push(`wa: ${e.message}`));
  const roster = () => wp.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)).players);
  const sheet = wp.getByRole('dialog', { name: 'ייבוא רשימה' });
  const rating = wp.getByRole('dialog', { name: 'דירוג מהיר' });
  const fixture = (f) => new URL(`./fixtures/${f}`, import.meta.url).pathname;
  await wp.goto(base + '#players');
  await wp.getByPlaceholder('איך קוראים לו?').fill('אבי');
  await wp.getByRole('button', { name: /^הוספה$/ }).click();
  await wp.getByRole('button', { name: /ייבוא רשימה/ }).click();
  assert(await sheet.getByRole('button', { name: "מצ'אט בוואטסאפ" }).isVisible(), 'wa: the WhatsApp button');
  assert(!(await sheet.locator('details.wa-help').evaluate((d) => d.open)), 'wa: the export hint starts folded');
  await sheet.getByLabel('קובץ לייבוא').setInputFiles(fixture('wa-chat-ios.zip'));
  await sheet.locator('.wa-picks').waitFor({ timeout: 5000 }).catch(() => errors.push('wa: no checklist from the zip'));
  const chips = await sheet.locator('.wa-picks .card-chip').evaluateAll((bs) => bs.map((b) => [b.textContent, b.getAttribute('aria-pressed'), b.disabled]));
  assert(
    JSON.stringify(chips.map((c) => c[0])) === JSON.stringify(['אלי', 'דני', 'Ben', 'יוסי כהן', 'אביכבר ברשימה', 'נועם', 'ליאור', 'עומר', '2 מספרים בלי שם']),
    `wa: checklist ${JSON.stringify(chips)}`,
  );
  assert(chips[4][2] === true && chips[8][1] === 'false' && chips[0][1] === 'true', `wa: greyed / unchecked ${JSON.stringify(chips)}`);
  for (const n of ['נועם', 'ליאור', 'עומר']) await sheet.getByRole('button', { name: n, exact: true }).click();
  await sheet.getByRole('button', { name: 'הוספת 4 שחקנים' }).click();
  assert(await wp.getByRole('dialog', { name: 'התחברות' }).getByText('כדי להוסיף עוד שחקנים צריך להתחבר').isVisible(), 'wa: 1 + 4 asks to log in');
  assert((await roster()).length === 1, 'wa: nothing added before the login');
  await loginInSheet(wp);
  await rating.waitFor({ timeout: 5000 }).catch(() => errors.push('wa: no quick rating after the login'));
  assert((await rating.locator('.rate-progress').textContent()) === '1/4' && (await rating.locator('.rate-name').textContent()) === 'אלי', 'wa: rating starts at 1/4 אלי');
  await rating.getByRole('button', { name: 'התקפה', exact: true }).click();
  await rating.getByRole('radio', { name: '8', exact: true }).click();
  assert((await rating.locator('.rate-progress').textContent()) === '2/4', 'wa: on to 2/4');
  await rating.getByRole('radio', { name: '3', exact: true }).click();
  assert((await rating.locator('.rate-name').textContent()) === 'Ben', 'wa: 3/4 is Ben');
  await rating.getByRole('button', { name: 'דילוג' }).click();
  assert((await rating.locator('.rate-progress').textContent()) === '4/4', 'wa: skip goes on');
  await rating.getByRole('button', { name: 'סיום' }).click();
  assert(!(await rating.count()), 'wa: "סיום" closes the rating');
  const after = await roster();
  const by = (n) => after.find((p) => p.name === n);
  assert(after.length === 5 && !by('נועם') && !after.some((p) => p.name.startsWith('בלי שם')), `wa: roster ${after.map((p) => p.name)}`);
  assert(by('אלי')?.attrs.overall === 8 && JSON.stringify(by('אלי')?.positions) === '["att"]', `wa: אלי ${JSON.stringify(by('אלי'))}`);
  assert(by('דני')?.attrs.overall === 3, `wa: דני ${by('דני')?.attrs.overall}`);
  assert(by('Ben')?.attrs.overall === 5 && !by('Ben')?.positions && !by('Ben')?.canGK && !by('Ben')?.levelVotes, 'wa: skipped Ben stays 5, nothing marked');
  assert(by('יוסי כהן')?.attrs.overall === 5, 'wa: closed before יוסי כהן: 5');

  // Android share target, through the real service worker.
  await wp.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => errors.push('wa: no service worker'));
  const chat = readFileSync(fixture('wa-chat-android.txt'), 'utf8');
  await wp.evaluate((text) => {
    const f = Object.assign(document.createElement('form'), { method: 'POST', action: './share-target', enctype: 'multipart/form-data' });
    const input = Object.assign(document.createElement('input'), { type: 'file', name: 'file' });
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'WhatsApp Chat with כדורגל.txt', { type: 'text/plain' }));
    input.files = dt.files;
    f.append(input);
    document.body.append(f);
    f.submit();
  }, chat);
  await sheet.locator('.wa-picks').waitFor({ timeout: 8000 }).catch(() => errors.push('wa: the share target did not open the checklist'));
  const shared = await sheet.locator('.wa-picks .card-chip').evaluateAll((bs) => bs.map((b) => b.textContent));
  assert(JSON.stringify(shared) === JSON.stringify(['שחר', 'אליכבר ברשימה', 'תומר', 'רז', 'מספר בלי שם']), `wa: shared checklist ${JSON.stringify(shared)}`);
  assert((await wp.evaluate(() => location.hash)) === '#players', 'wa: the share hash is cleaned');
  assert(!(await wp.evaluate(() => caches.keys())).includes('kochot-share'), 'wa: the shared chat is deleted once read');
  await sheet.getByRole('button', { name: 'הוספת 3 שחקנים' }).click();
  await rating.getByRole('button', { name: 'סיום' }).click();
  assert((await roster()).length === 8, 'wa: 3 more from the share');

  // Contacts (Android Chrome's picker, stubbed): names only.
  await wp.getByRole('button', { name: /ייבוא רשימה/ }).click();
  await sheet.getByRole('button', { name: 'מאנשי הקשר' }).click();
  assert(JSON.stringify(await sheet.locator('.wa-picks .card-chip').evaluateAll((bs) => bs.map((b) => b.textContent))) === '["רונן"]', 'wa: contacts checklist');
  await sheet.getByRole('button', { name: 'הוספת שחקן אחד' }).click();
  await rating.getByRole('radio', { name: '6', exact: true }).click();
  assert(!(await rating.count()) && (await roster()).find((p) => p.name === 'רונן')?.attrs.overall === 6, 'wa: contact added and rated, round over');

  // Nothing with a phone number, anywhere this phone keeps data.
  const kept = await wp.evaluate(async () => JSON.stringify(localStorage) + JSON.stringify(await caches.keys()));
  assert(!/4567|4321|0134/.test(kept), 'wa: a phone number was stored');
  assert(!/4567|4321/.test(JSON.stringify(ws.calls)), 'wa: a phone number was sent to the server');
  console.log(`whatsapp: ${(await roster()).length} players (zip, share target, contacts)`);
  await wctx.close();
}

// 20. First visit: "פעם ראשונה בכוחות?" once, then never again; not when arriving through an invite.
{
  const wc = await browser.newContext({ viewport: { width: 390, height: 844 }, welcome: true });
  const wp = await wc.newPage();
  wp.on('pageerror', (e) => errors.push(e.message));
  await wp.goto(base);
  const sheet = wp.getByRole('dialog', { name: /פעם ראשונה בכוחות/ });
  assert(await sheet.isVisible(), 'welcome: shown on the first visit');
  assert((await sheet.locator('.welcome-steps li').count()) === 3, 'welcome: three steps');
  await sheet.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  assert((await wp.locator('ul.attend li').count()) > 0, 'welcome: the sample squad loads from the sheet');
  await wp.evaluate(() => {
    const k = Object.keys(localStorage).filter((x) => x.startsWith('kochot:group'));
    k.forEach((x) => localStorage.removeItem(x));
    localStorage.removeItem('kochot:groups');
  });
  await wp.reload();
  assert((await wp.getByRole('dialog', { name: /פעם ראשונה בכוחות/ }).count()) === 0, 'welcome: never again on this phone');
  await wc.close();
  const jc = await browser.newContext({ viewport: { width: 390, height: 844 }, welcome: true });
  const jp = await jc.newPage();
  await jp.goto(base + '#join=SOMETOKEN');
  await jp.waitForTimeout(500);
  assert((await jp.getByRole('dialog', { name: /פעם ראשונה בכוחות/ }).count()) === 0, 'welcome: not shown when arriving through an invite');
  await jc.close();
}

console.log(`split 22 players in ${dt}ms`);
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
