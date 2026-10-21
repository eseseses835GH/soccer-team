// Functional smoke test of the main flows against `vite preview` (see README).
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { GID, ME, ORG, playerContext, SB_URL } from './player-mock.mjs';

const base = process.env.BASE_URL ?? 'http://localhost:4173/';
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
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

// 3. Import a pasted list (19 more players → 22).
await page.getByRole('button', { name: 'השחקנים' }).click();
await page.getByRole('button', { name: /ייבוא רשימה/ }).click();
const list = Array.from({ length: 19 }, (_, i) => `שחקן ${i + 1}, ${1 + (i % 10)}${i === 3 ? ', שוער' : ''}${i === 5 ? ', הסלע' : ''}${i % 4 === 1 ? ', הגנה' : ''}${i % 4 === 2 ? ', חלוץ קשר' : ''}`).join('\n');
await page.getByLabel('רשימת שחקנים').fill(list + '\nאלון 5');
assert(await page.getByText('19 שחקנים מוכנים, אחד דולג').isVisible(), 'import preview counts');
await page.getByRole('button', { name: /הוספת 19 שחקנים/ }).click();
assert((await page.locator('.roster li').count()) === 22, 'import adds 19');
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
  const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  other.on('pageerror', (e) => errors.push(e.message));
  await other.goto(base + '#players');
  await other.getByRole('button', { name: /ייבוא רשימה/ }).click();
  await other.locator('input[type=file]').setInputFiles({ name: 'kochot-backup.json', mimeType: 'application/json', buffer: (await import('node:fs')).readFileSync(backupFile) });
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
  await pg.getByRole('button', { name: 'כן, הוא עזב' }).click();
  if (await pg.getByRole('dialog').isVisible()) {
    assert((await pg.getByRole('dialog').locator('h2').innerText()) === 'לאזן מחדש?', 'swap suggestion without subs');
    await pg.getByRole('button', { name: 'להחליף' }).click();
  }
  const end2 = await stored();
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

// 11. Groups: a second group starts empty, switching back keeps the first one's roster.
await page.goto(base + '#home');
await page.getByRole('button', { name: /החלפת קבוצה/ }).click();
await page.getByRole('button', { name: /קבוצה חדשה/ }).click();
await page.getByLabel('שם הקבוצה').fill('כדורגל בבסיס');
await page.getByRole('button', { name: 'יצירה' }).click();
assert(await page.getByRole('button', { name: /קבוצה: כדורגל בבסיס/ }).isVisible(), 'new group is open');
assert(await page.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).isVisible(), 'new group starts empty');
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

// 17. During an evening: ticking someone at home asks "in now or wait" (no reshuffle), a re-roll asks
// first, and two groups can't share a name.
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
  await ev.goto(base + '#home');
  await ev.getByRole('button', { name: /החלפת קבוצה/ }).click();
  await ev.getByRole('button', { name: /קבוצה חדשה/ }).click();
  await ev.getByLabel('שם הקבוצה').fill('הקבוצה שלי');
  await ev.getByRole('button', { name: 'יצירה' }).click();
  assert(await ev.getByText('כבר יש קבוצה בשם הזה').isVisible(), 'groups: a duplicate name is refused');
  await ev.context().close();
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
  for (const gone of ['סיום הערב', 'מישהו הגיע?', 'מישהו עזב?']) assert(!(await rp.getByRole('button', { name: gone }).count()), `runner: "${gone}" shown to a player`);
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

console.log(`split 22 players in ${dt}ms`);
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
