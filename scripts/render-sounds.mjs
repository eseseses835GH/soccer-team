// Renders the synthesized match sounds offline in Chromium and saves WAVs + level stats.
// Usage: node scripts/render-sounds.mjs [outDir]
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'sounds';
mkdirSync(out, { recursive: true });
const { outputFiles } = await build({ entryPoints: ['src/ui/sounds.ts'], bundle: true, format: 'iife', globalName: 'Sounds', write: false });
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
await page.setContent('<!doctype html><title>render</title>');
await page.addScriptTag({ content: outputFiles[0].text });

let failed = false;
for (const [name, which] of [['horn', 'horn'], ['whistle-start', 'start'], ['whistle-end', 'end']]) {
  const r = await page.evaluate(async (which) => {
    const b = await window.Sounds.renderOffline(which, 48000);
    const d = b.getChannelData(0);
    let peak = 0, sum = 0;
    for (const x of d) { peak = Math.max(peak, Math.abs(x)); sum += x * x; }
    // 50 ms RMS envelope (dB), to eyeball the blasts.
    const win = 2400, env = [];
    for (let i = 0; i < d.length; i += win) {
      let s = 0; for (let j = i; j < Math.min(d.length, i + win); j++) s += d[j] * d[j];
      env.push(Math.round(10 * Math.log10(s / win + 1e-12)));
    }
    // 16-bit PCM WAV.
    const n = d.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 48000, true);
    v.setUint32(28, 96000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
    let bin = ''; const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return { peakDb: 20 * Math.log10(peak), rmsDb: 10 * Math.log10(sum / n), seconds: n / 48000, env, wav: btoa(bin) };
  }, which);
  writeFileSync(`${out}/${name}.wav`, Buffer.from(r.wav, 'base64'));
  console.log(`${name}: peak ${r.peakDb.toFixed(2)} dBFS, rms ${r.rmsDb.toFixed(1)} dBFS, ${r.seconds.toFixed(2)} s`);
  console.log('  50ms RMS dB:', r.env.join(' '));
  if (r.peakDb > -1 || r.peakDb < -12) failed = true;
}
await browser.close();
if (failed) {
  console.error('peak level out of range (-12 … -1 dBFS)');
  process.exit(1);
}
