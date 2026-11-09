// Vite plugin: writes sw.js next to the built app, listing every file the app needs so the
// service worker (build/sw-template.js) can store them all for offline use.
// It runs inside `quasar build`, so no extra build command or Vercel setting is needed.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function offlinePlugin({ publicDir, template }) {
  return {
    name: 'qr-attendee-offline-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const urls = new Set(['/']); // "/" is index.html

      for (const name of Object.keys(bundle).sort()) {
        if (name.endsWith('.map') || name === 'sw.js') continue;
        const item = bundle[name];
        hash.update(name);
        hash.update(item.type === 'chunk' ? item.code : item.source);
        if (name !== 'index.html') urls.add(`/${name}`);
      }

      // Files copied as they are from public/ (icons, manifest, favicon). They are not in the bundle.
      for (const file of listFiles(publicDir).sort()) {
        const rel = relative(publicDir, file).split(sep).join('/');
        if (rel === 'sw.js' || rel.endsWith('.map')) continue;
        hash.update(rel);
        hash.update(readFileSync(file));
        urls.add(`/${rel}`);
      }

      const source = readFileSync(template, 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__BUILT_AT__', String(Date.now()))
        .replace(/\/\*\s*__PRECACHE__\s*\*\/\s*\[\]/, () =>
          JSON.stringify([...urls].sort(), null, 2),
        );

      // Never ship a worker whose placeholders were not filled in (it would cache nothing).
      if (/__(VERSION|BUILT_AT|PRECACHE)__/.test(source.replace(/\/\*[\s\S]*?\*\//, ''))) {
        this.error('build/sw-template.js: a placeholder was not replaced');
      }

      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
