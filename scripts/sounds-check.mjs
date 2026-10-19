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
const expectSounds = async (want, step) => {
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

assert((await page.evaluate(() => window.__speech)) === 0, 'speechSynthesis was used');
await browser.close();
if (errors.length) {
  console.error('FAIL\n' + errors.join('\n'));
  process.exit(1);
}
console.log('sounds check passed');
