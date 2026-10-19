// Vite plugin used by vite.config.ts (plain JS so the app's tsconfig needs no Node types).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Stamps dist/sw.js with a build id and the list of files the app needs offline.
 * - The build id is a hash of everything in dist/, so every deploy that changes anything gives a
 *   new sw.js: the browser installs it and drops the previous version's cache. A rebuild with no
 *   changes keeps the same id (nothing is re-downloaded).
 * - The precache list is the entry chunk, its static imports, the CSS and the balancing worker.
 *   Lazy chunks (the Supabase library) are left out: logged-out users never download them.
 * @returns {import('vite').Plugin}
 */
export function swManifest() {
  let outDir = 'dist';
  let precache = [];
  return {
    name: 'kochot-sw-manifest',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir.startsWith('/') ? c.build.outDir : `${c.root}/${c.build.outDir}`;
    },
    generateBundle(_opts, bundle) {
      const files = new Set();
      const visit = (name) => {
        const item = bundle[name];
        if (!item || files.has(name)) return;
        files.add(name);
        if (item.type === 'chunk') {
          item.imports.forEach(visit);
          item.viteMetadata?.importedCss.forEach((f) => files.add(f));
        }
      };
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === 'chunk' && item.isEntry) visit(name);
        if (item.type === 'asset' && item.fileName !== 'index.html') files.add(name);
      }
      precache = [...files].sort();
    },
    closeBundle() {
      const swPath = `${outDir}/sw.js`;
      if (!existsSync(swPath)) return;
      const hash = createHash('sha256');
      const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const p = `${dir}/${e.name}`;
          if (e.isDirectory()) walk(p);
          else if (p !== swPath) hash.update(p.slice(outDir.length + 1)).update(readFileSync(p));
        }
      };
      walk(outDir);
      const sw = readFileSync(swPath, 'utf8');
      const id = hash.update(sw).digest('hex').slice(0, 12);
      const out = sw
        .replace("'__BUILD_ID__'", JSON.stringify(id))
        .replace('[/*__PRECACHE__*/]', JSON.stringify(precache.map((f) => `./${f}`)));
      if (out.includes('__BUILD_ID__') || out.includes('__PRECACHE__')) throw new Error('sw.js placeholders not found');
      writeFileSync(swPath, out);
    },
  };
}
