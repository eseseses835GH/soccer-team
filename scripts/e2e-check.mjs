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

// 1. Quick add with level + card, duplicate rejected.
await page.getByRole('button', { name: 'הוספת שחקנים' }).click();
for (const [n, lvl, cards] of [['אלון', '7', ['החיה']], ['Ben', '4', ['איטי', 'מפחד מהכדור']], ['גיא', '9', ['הקוסם']]]) {
  await page.getByPlaceholder('איך קוראים לו?').fill(n);
  await page.getByRole('radio', { name: lvl, exact: true }).click();
  for (const card of cards) await page.getByRole('button', { name: card, exact: true }).click();
  if (n === 'Ben') {
    // Optional detailed rating in quick add: shooting slider 4-2 → 6.
    await page.getByText('דירוג מפורט').click();
    await page.getByLabel('בעיטה').fill('6');
    await page.getByText('דירוג מפורט').click();
  }
  await page.getByRole('button', { name: /^הוספה$/ }).click();
}
assert((await page.locator('.roster li').count()) === 3, 'quick add should create 3 players');
const ben = await page.evaluate(() => JSON.parse(localStorage.getItem('kochot:v1')).players.find((p) => p.name === 'Ben'));
assert(JSON.stringify(ben.cards) === '["slow","scared"]', `Ben's cards ${JSON.stringify(ben.cards)}`);
assert(ben.attrs.shooting === 6 && ben.attrs.stamina === 2 && ben.attrs.overall === 4, `Ben's ratings ${JSON.stringify(ben.attrs)}`);
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
const list = Array.from({ length: 19 }, (_, i) => `שחקן ${i + 1}, ${1 + (i % 10)}${i === 3 ? ', שוער' : ''}${i === 5 ? ', הסלע' : ''}`).join('\n');
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
await page.getByRole('button', { name: 'סיום הערב' }).click();
await page.locator('.sheet').getByRole('button', { name: 'סיום הערב' }).click();
await page.waitForSelector('.evening');
const summary = await page.locator('.evening').innerText();
assert(/לקחו את הערב/.test(summary), 'summary names the evening winner');
assert(summary.includes('מלך השערים'), 'summary shows the top scorer');
await page.waitForTimeout(1200); // the totals count up
const totals = await page.locator('.ev-stats dd').allInnerTexts();
assert(totals[0] === '2' && totals[1] === '3', `summary totals: ${totals}`);
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
  const s = JSON.parse(localStorage.getItem('kochot:v1'));
  s.dayAt = Date.now() - 13 * 3600 * 1000;
  localStorage.setItem('kochot:v1', JSON.stringify(s));
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

console.log(`split 22 players in ${dt}ms`);
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
