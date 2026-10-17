// Functional smoke test of key flows against `vite preview` (see README).
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:4173/';
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const assert = (c, m) => { if (!c) { errors.push(m); } };

await page.goto(base);
// Quick add 3 players.
for (const [n, r] of [['אלון', '7'], ['Ben', '4'], ['גיא', '9']]) {
  await page.getByPlaceholder('שם השחקן').fill(n);
  await page.getByRole('radio', { name: r, exact: true }).click();
  await page.getByRole('button', { name: /הוספה$/ }).click();
}
assert((await page.locator('.player-row').count()) === 3, 'quick add should create 3 players');
// Duplicate name rejected.
await page.getByPlaceholder('שם השחקן').fill('גיא');
await page.getByRole('button', { name: /הוספה$/ }).click();
assert(await page.getByText('כבר יש שחקן בשם הזה').isVisible(), 'duplicate name error');
// Not enough players for 2 teams.
await page.getByRole('navigation').getByRole('button', { name: /המשחק/ }).click();
assert(await page.getByRole('button', { name: /חלוקה לקבוצות/ }).isDisabled(), 'generate disabled with 3 players');
assert(await page.getByText(/חסרים 1/).isVisible(), 'missing-players hint');
// Persistence across reload.
await page.reload();
assert((await page.locator('.attend-row').count()) === 3, 'players persisted');
// 22 players, 3 teams: should be quick.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('kochot:v1'));
  for (let i = 0; i < 19; i++) {
    const id = 'x' + i;
    s.players.push({ id, name: 'שחקן ' + i, attrs: { overall: 1 + (i % 10), stamina: 5, coordination: 5, teamwork: 5, leadership: i % 5 === 0 ? 8 : 4, shooting: 5, dribbling: 5, goalkeeping: 5 }, canGK: i % 6 === 0 });
    s.presentIds.push(id);
  }
  localStorage.setItem('kochot:v1', JSON.stringify(s));
});
await page.reload();
await page.getByRole('button', { name: 'הוסף', exact: true }).click();
const t0 = Date.now();
await page.getByRole('button', { name: /חלוקה לקבוצות/ }).click();
await page.waitForSelector('.teams-3');
const dt = Date.now() - t0;
assert(dt < 1500, `22 players/3 teams took ${dt}ms`);
const sizes = await page.locator('.team-card').evaluateAll((cards) => cards.map((c) => c.querySelectorAll('.member').length));
assert(JSON.stringify(sizes.sort()) === JSON.stringify([7, 7, 8]), `sizes ${sizes}`);
// Re-roll changes the split.
const snap = () => page.locator('.team-card').evaluateAll((cs) => cs.map((c) => [...c.querySelectorAll('.player-name')].map((n) => n.textContent).sort().join(',')).sort().join('|'));
const before = await snap();
await page.getByRole('button', { name: /הגרלה מחדש/ }).click();
assert((await snap()) !== before, 're-roll should change teams');
// Constraint: keep אלון and גיא apart, then re-split and verify.
await page.getByRole('navigation').getByRole('button', { name: /הגדרות/ }).click();
await page.getByRole('radio', { name: /בנפרד/ }).click();
await page.getByLabel('שחקן ראשון').selectOption({ label: 'אלון' });
await page.getByLabel('שחקן שני').selectOption({ label: 'גיא' });
await page.getByRole('button', { name: 'הוספת אילוץ' }).click();
await page.getByRole('navigation').getByRole('button', { name: /המשחק/ }).click();
await page.getByRole('button', { name: /חלוקה לקבוצות/ }).click();
await page.waitForSelector('.teams-3');
const teamOf = (name) => page.locator('.team-card').evaluateAll((cs, n) => cs.findIndex((c) => [...c.querySelectorAll('.player-name')].some((x) => x.textContent === n)), name);
assert((await teamOf('אלון')) !== (await teamOf('גיא')), 'keep-apart respected in UI');
assert((await page.locator('.warnings').count()) === 0, 'no warnings expected');
console.log(`22 players / 3 teams in ${dt}ms, sizes ${sizes}`);
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('ok');
