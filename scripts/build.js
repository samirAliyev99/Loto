import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds the browser-only demo for GitHub Pages into dist/: the website plus the
// shared modules it runs locally. The static marker makes public/api.js skip fetch.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const BROWSER_MODULES = ['api.js', 'demo.js', 'game.js', 'local-api.js', 'sima.js'];
const MARKER = '<meta name="loto-static" content="1">';

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, 'src'));
for (const file of BROWSER_MODULES) fs.copyFileSync(path.join(ROOT, 'src', file), path.join(DIST, 'src', file));

for (const file of fs.readdirSync(DIST).filter((f) => f.endsWith('.html'))) {
  const full = path.join(DIST, file);
  const html = fs.readFileSync(full, 'utf8');
  if (!html.includes('<meta charset="utf-8">')) throw new Error(`${file}: no charset meta to anchor the static marker`);
  fs.writeFileSync(full, html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${MARKER}`));
}
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
console.log(`Built ${DIST}`);
