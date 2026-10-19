// Checks when the match sounds play, by spying on Web Audio in the built app (see README):
// kick-off whistle once (not on resume), horn on a goal (no speech at all), one full-time
// whistle per match (time-up or the end tap, never both), and nothing when muted.
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:4173/';
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' });
await ctx.addInitScript(() => {
  // Every started oscillator, with its type, start and stop time on the audio clock.
  const log = (window.__osc = []);
  window.__speech = 0;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when = 0) {
    this.__rec = { type: this.type, when, stop: null, state: this.context.state };
    log.push(this.__rec);
    return start.call(this, when);
  };
  const stop = OscillatorNode.prototype.stop;
  OscillatorNode.prototype.stop = function (when = 0) {
    if (this.__rec) this.__rec.stop = when;
    return stop.call(this, when);
  };
  if (window.speechSynthesis) {
    const speak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (u) => {
      window.__speech++;
      return speak(u);
    };
  }
});
const page = await ctx.newPage();
await page.clock.install();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const assert = (c, m) => {
  if (!c) errors.push(m);
};

/** Sounds so far, grouped by start time: horn (sawtooth reeds) or whistle start/end (by length). */
const sounds = () =>
  page.evaluate(() => {
    const groups = new Map();
    for (const r of window.__osc) {
      const k = r.when.toFixed(4);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    return [...groups.values()].map((g) => {
      if (g.some((r) => r.type === 'sawtooth')) return 'horn';
      if (g.some((r) => r.type === 'triangle')) return g[0].stop - g[0].when > 1.5 ? 'whistle-end' : 'whistle-start';
      return 'other';
    });
  });
/** Sounds may wait for the AudioContext's resume() (Safari), so give them a moment to start. */
const settle = async (n) => {
  for (let i = 0; i < 20 && (await sounds()).length < n; i++) await page.waitForTimeout(50);
};
const expectSounds = async (want, step) => {
  await settle(want.length);
  const got = await sounds();
  assert(JSON.stringify(got) === JSON.stringify(want), `${step}: sounds ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
};

await page.goto(base);
await page.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
await page.getByRole('button', { name: 'עושים כוחות' }).click();
await page.waitForSelector('.team');
await page.getByRole('button', { name: /התחלת משחק/ }).click();
await page.waitForSelector('.clock');
await expectSounds([], 'match screen opened');

// Match 1: kick-off whistle; pause/resume is silent; goal → horn; end tap → full-time whistle.
await page.getByRole('button', { name: /^התחלה$/ }).click();
// The very first tap on the match screen starts the clock (nothing swallows it).
assert(await page.getByRole('button', { name: /עצירה/ }).isVisible(), 'first tap on התחלה starts the clock');
await expectSounds(['whistle-start'], 'start');
await page.clock.runFor(20_000);
await page.getByRole('button', { name: /עצירה/ }).click();
await page.getByRole('button', { name: /המשך/ }).click();
await expectSounds(['whistle-start'], 'pause/resume');
await page.getByRole('button', { name: '+ גול' }).first().click();
await page.getByRole('dialog').getByRole('button', { name: 'דילוג' }).click();
await expectSounds(['whistle-start', 'horn'], 'goal');
await page.getByRole('button', { name: 'סיום משחק' }).click();
await expectSounds(['whistle-start', 'horn', 'whistle-end'], 'end tap');
assert((await page.locator('.match-no').innerText()) === 'משחק 2', 'match 2 on the pitch');

// Match 2: time runs out → the whistle blows by itself; the end tap then doesn't whistle again.
await page.getByRole('button', { name: /^התחלה$/ }).click();
await page.getByRole('button', { name: '+ גול' }).nth(1).click();
await page.getByRole('dialog').getByRole('button', { name: 'דילוג' }).click();
await page.clock.runFor(8 * 60_000 + 2_000);
await page.waitForTimeout(300);
const after2 = ['whistle-start', 'horn', 'whistle-end', 'whistle-start', 'horn', 'whistle-end'];
await expectSounds(after2, 'time up');
assert(await page.locator('.clock.over').isVisible(), 'clock in overtime');
await page.getByRole('button', { name: 'סיום משחק' }).click();
await expectSounds(after2, 'end tap after time-up');
const whenTimeUp = await page.evaluate(() => window.__osc.filter((r) => r.type === 'triangle').map((r) => r.state));
assert(whenTimeUp.every((s) => s === 'running'), `audio running for every whistle: ${whenTimeUp}`);

// Match 3, muted from the match screen: no whistle, no horn, no full-time whistle.
await page.getByRole('button', { name: 'השתקת הצלילים' }).click();
await page.getByRole('button', { name: /^התחלה$/ }).click();
await page.getByRole('button', { name: '+ גול' }).first().click();
await page.getByRole('dialog').getByRole('button', { name: 'דילוג' }).click();
await page.clock.runFor(8 * 60_000 + 2_000);
await page.getByRole('button', { name: 'סיום משחק' }).click();
await expectSounds(after2, 'muted');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(`kochot:group:${JSON.parse(localStorage.getItem('kochot:groups')).currentId}`)).settings.goalSound);
assert(saved === 'off', `mute saved as ${saved}`);

// Unmute; after a reload (no tap yet) a time-up can't sound, so the end tap whistles instead.
await page.getByRole('button', { name: 'הפעלת הצלילים' }).click();
await page.getByRole('button', { name: /^התחלה$/ }).click();
await page.reload();
await page.waitForSelector('.clock');
await page.clock.runFor(8 * 60_000 + 2_000);
await page.waitForTimeout(300);
await expectSounds([], 'time up after reload without a tap');
await page.getByRole('button', { name: 'סיום משחק' }).click();
const last = await sounds();
assert(last[last.length - 1] === 'whistle-end', `end tap after reload: ${JSON.stringify(last)}`);

// Match length (v5). `expectNew` checks only the sounds after `from`.
const expectNew = async (from, want, step) => {
  await settle(from + want.length);
  const got = (await sounds()).slice(from);
  assert(JSON.stringify(got) === JSON.stringify(want), `${step}: new sounds ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
};
const lengthSheet = async () => {
  await page.getByRole('button', { name: /^אורך המשחק/ }).click();
  return page.getByRole('dialog');
};
const finishDraw = async () => {
  if (await page.getByRole('dialog').isVisible()) await page.getByRole('dialog').getByRole('button', { name: /יוצאים/ }).first().click();
};
await finishDraw(); // the match above ended 0:0
// Shortened mid-match to 5 minutes: the time-up whistle comes at 5:00, not 8:00.
let from = (await sounds()).length;
await page.getByRole('button', { name: /^התחלה$/ }).click();
await page.clock.runFor(3 * 60_000);
let sheet = await lengthSheet();
await sheet.getByRole('radio', { name: '5' }).click();
await sheet.getByRole('button', { name: 'אישור' }).click();
await expectNew(from, ['whistle-start'], 'shortened: nothing yet');
await page.clock.runFor(2 * 60_000 + 2_000);
await page.waitForTimeout(300);
await expectNew(from, ['whistle-start', 'whistle-end'], 'time up at the new length');
// Extended past the clock (+1): time left again, and the new finish whistles again.
sheet = await lengthSheet();
await sheet.getByRole('button', { name: '+1 דק׳' }).click();
await sheet.getByRole('button', { name: 'אישור' }).click();
assert(!(await page.locator('.clock.over').isVisible()), 'extended: back to time left');
await page.clock.runFor(60_000);
await page.waitForTimeout(300);
await expectNew(from, ['whistle-start', 'whistle-end', 'whistle-end'], 'time up again after +1');
// Taking a minute off in overtime doesn't whistle again, nor does the end tap.
sheet = await lengthSheet();
await sheet.getByRole('button', { name: '−1 דק׳' }).click();
await sheet.getByRole('button', { name: 'אישור' }).click();
await page.clock.runFor(2_000);
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'סיום משחק' }).click();
await finishDraw();
await expectNew(from, ['whistle-start', 'whistle-end', 'whistle-end'], 'minus in overtime + end tap');
// No timer: the clock counts up, no time-up whistle ever; the end tap still whistles.
from = (await sounds()).length;
sheet = await lengthSheet();
await sheet.locator('label.toggle').click();
await sheet.getByRole('button', { name: 'אישור' }).click();
await page.getByRole('button', { name: /^התחלה$/ }).click();
await page.clock.runFor(20 * 60_000);
await page.waitForTimeout(300);
await expectNew(from, ['whistle-start'], 'no timer: no time-up whistle');
assert(/^20:0\d$/.test(await page.locator('.clock').innerText()), `no timer counts up: ${await page.locator('.clock').innerText()}`);
await page.getByRole('button', { name: 'סיום משחק' }).click();
await finishDraw();
await expectNew(from, ['whistle-start', 'whistle-end'], 'no timer: end tap whistles');

assert((await page.evaluate(() => window.__speech)) === 0, 'speechSynthesis was used');

// Safari-like: the AudioContext starts 'suspended' and resume() resolves later. The kick-off
// whistle must still play, scheduled once resume() has resolved (not on the frozen clock).
{
  const sctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' });
  await sctx.addInitScript(() => {
    window.__resumedAt = null;
    window.__starts = [];
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (when = 0) {
      window.__starts.push(performance.now());
      return start.call(this, when);
    };
    const C = window.AudioContext;
    window.AudioContext = class extends C {
      constructor(...a) {
        super(...a);
        let suspended = true;
        Object.defineProperty(this, 'state', { get: () => (suspended ? 'suspended' : 'running') });
        this.resume = () =>
          new Promise((r) =>
            setTimeout(() => {
              suspended = false;
              window.__resumedAt = performance.now();
              r();
            }, 250),
          );
      }
    };
  });
  const sp = await sctx.newPage();
  sp.on('pageerror', (e) => errors.push(`safari-like: ${e.message}`));
  await sp.goto(base);
  await sp.getByRole('button', { name: 'לנסות עם סגל לדוגמה' }).click();
  await sp.getByRole('button', { name: 'עושים כוחות' }).click();
  await sp.getByRole('button', { name: /התחלת משחק/ }).click();
  await sp.getByRole('button', { name: /^התחלה$/ }).click();
  assert(await sp.getByRole('button', { name: /עצירה/ }).isVisible(), 'safari-like: first tap starts the clock');
  await sp.waitForTimeout(700);
  const r = await sp.evaluate(() => ({ resumedAt: window.__resumedAt, starts: window.__starts }));
  assert(r.resumedAt !== null && r.starts.length >= 5, `safari-like: whistle after resume (${r.starts.length} oscillators)`);
  assert(r.starts.every((t) => t >= r.resumedAt), 'safari-like: nothing scheduled before resume() resolved');
  await sctx.close();
}
await browser.close();
if (errors.length) {
  console.error('FAIL\n' + errors.join('\n'));
  process.exit(1);
}
console.log('sounds check passed');
