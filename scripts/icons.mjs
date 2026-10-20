// Renders public/icon-192.png, icon-512.png and apple-touch-icon.png (180, iOS home screen) from public/favicon.svg.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
for (const [size, file] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Full-bleed square for maskable icons: drop the rounded corners.
  const square = svg.replace('rx="14"', 'rx="0"');
  await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${square}`);
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname });
  await page.close();
}
await browser.close();
console.log('icons written');
