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
for (const [n, lvl, card] of [['אלון', '7', 'החיה'], ['Ben', '4', null], ['גיא', '9', 'הקוסם']]) {
  await page.getByPlaceholder('איך קוראים לו?').fill(n);
  await page.getByRole('radio', { name: lvl, exact: true }).click();
  if (card) await page.getByRole('button', { name: new RegExp(card) }).click();
  await page.getByRole('button', { name: /^הוספה$/ }).click();
}
assert((await page.locator('.roster li').count()) === 3, 'quick add should create 3 players');
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

// 8. Keep-apart pair is respected on a fresh split.
await back();
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

// 10. Backup link → import on another device.
await page.getByRole('button', { name: 'הגדרות' }).click();
// Capture what the app copies (headless clipboard reads are unreliable).
await page.evaluate(() => {
  // Newer Chrome builds expose the Web Share API, whose sheet never resolves headless.
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  navigator.clipboard.writeText = async (t) => {
    window.__copied = t;
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

console.log(`split 22 players in ${dt}ms`);
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
