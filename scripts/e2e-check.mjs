// Functional smoke test of the main flows against `vite preview` (see README).
import { chromium } from '@playwright/test';

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
const back = () => page.getByRole('button', { name: /^חזרה$/ }).click();
const teamSizes = () => page.locator('.team').evaluateAll((cs) => cs.map((c) => c.querySelectorAll('.member').length));
const teamOf = (name) =>
  page.locator('.team').evaluateAll((cs, n) => cs.findIndex((c) => [...c.querySelectorAll('.name')].some((x) => x.textContent === n)), name);

await page.goto(base);

// 1. Quick add with level + positions + card (cards and sliders are folded under "עוד על השחקן"), duplicate rejected.
await page.getByRole('button', { name: 'הוספת שחקנים' }).click();
const more = page.locator('form.add details.more');
assert(!(await more.evaluate((d) => d.open)), '"more about the player" starts folded');
for (const [n, lvl, positions, cards] of [['אלון', '7', ['התקפה'], ['החיה']], ['Ben', '4', ['שוער', 'הגנה', 'קישור'], ['איטי', 'מפחד מהכדור']], ['גיא', '9', [], ['הקוסם']]]) {
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
assert((await page.locator('.roster li', { hasText: 'Ben' }).locator('.pos-badges').getAttribute('aria-label')) === 'שוער, הגנה, קישור', 'position emojis in the roster');
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
assert(await page.getByText('19 שחקנים מוכנים, 1 דולגו').isVisible(), 'import preview counts');
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
await page.getByRole('button', { name: 'הצטרף' }).click();
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
assert(pitch[0] !== 'אדומים' || pitch[1] !== 'כחולים', `after a loss the pitch should change: ${pitch}`);
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
  await sheet.getByRole('button', { name: `ה${first}` }).click();
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
assert(/לקחו את הערב/.test(summary), 'summary names the evening winner');
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
await page.getByLabel('שחקן ראשון').selectOption({ label: 'אלון' });
await page.getByLabel('שחקן שני').selectOption({ label: 'גיא' });
await page.getByRole('button', { name: 'הוספת זוג' }).click();
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

// 10. Backup link → import on another device.
await page.getByRole('button', { name: 'הגדרות' }).click();
// Capture what the app copies (headless clipboard reads are unreliable).
// Desktop Chrome on macOS has navigator.share, so stub that path too.
await page.evaluate(() => {
  // Newer Chrome builds expose the Web Share API, whose sheet never resolves headless.
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  navigator.clipboard.writeText = async (t) => {
    window.__copied = t;
  };
  if (navigator.share) navigator.share = async (d) => {
    window.__copied = d.url ?? d.text;
  };
});
await page.getByRole('button', { name: /שליחת קישור/ }).click();
await page.waitForFunction(() => window.__copied);
const link = await page.evaluate(() => window.__copied);
assert(link.includes('#import='), 'backup link copied');
const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await other.goto(link);
await other.getByRole('button', { name: /^ייבוא$/ }).click();
await other.getByRole('button', { name: 'השחקנים' }).click();
const imported = await other.locator('.roster li').count();
assert(imported === 23, `imported ${imported} players`);
assert((await other.getByRole('button', { name: 'ערבים קודמים' }).count()) === 0, 'the link leaves the history out');

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
  assert(/משלימים את ה.+ מה.+/.test(title), `borrow title: ${title}`);
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
  assert(await pg.getByText(new RegExp(`${otherName} משחק עם ה`)).isVisible(), 'borrow recorded');
  // The borrower can score for the short team (second side = the team that came on).
  await pg.getByRole('button', { name: '+ גול' }).nth(1).click();
  assert(await pg.locator('.sheet .pick-list').getByText(otherName, { exact: true }).isVisible(), 'borrower listed as a scorer');
  await pg.getByRole('button', { name: 'דילוג' }).click();
  // Survives a reload.
  await pg.reload();
  assert(await pg.getByText(new RegExp(`${otherName} משחק עם ה`)).isVisible(), 'borrow survives reload');
  // The short team wins and stays: the borrower goes back and it borrows again from the new loser.
  await pg.getByRole('button', { name: 'סיום משחק' }).click();
  assert(await pg.locator('.borrow').isVisible(), 'short team that stays borrows again');
  const donors = await pg.locator('.borrow-picks .name').allInnerTexts();
  assert(!donors.includes(otherName), 'borrows from the new loser, not the previous one');
  await pg.locator('.borrow').getByRole('button', { name: 'דילוג' }).click();
  assert((await pg.locator('.borrow').count()) === 0, 'skip hides the step');
  console.log(`borrow: suggested ${suggested}, picked ${otherName}`);
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
    JSON.stringify({ version: 2, players: [{ id: 'x1', name: 'ותיק', attrs: { overall: 7 }, canGK: false, cards: [] }], presentIds: ['x1'], dayAt: Date.now(), teamSize: 5, settings: {}, constraints: { together: [], apart: [] }, result: null, match: null }),
  );
});
await old.reload();
assert(await old.getByRole('button', { name: /קבוצה: הקבוצה שלי/ }).isVisible(), 'migrated group name');
assert(await old.getByText('ותיק').isVisible(), 'migrated player shown');
assert(!(await old.evaluate(() => localStorage.getItem('kochot:v1'))), 'old key moved');
// No network to Supabase without an account.
const sbCalls = [];
old.on('request', (r) => /supabase/.test(r.url()) && sbCalls.push(r.url()));
await old.reload();
await old.waitForTimeout(300);
assert(sbCalls.length === 0, `no Supabase calls when logged out: ${sbCalls}`);

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
  else if (await sheet.isVisible()) await sheet.getByRole('button', { name: /יוצאים/ }).first().tap();
  assert((await chip.innerText()).includes('בלי הגבלת זמן'), 'next match has no timer either');
  await chip.tap();
  await sheet.locator('label.toggle').tap();
  await sheet.getByRole('button', { name: 'אישור' }).tap();
  assert((await chip.innerText()).trim().endsWith('5 דק׳'), `timer back at the default: ${await chip.innerText()}`);
  await tctx.close();
}

console.log(`split 22 players in ${dt}ms`);
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
