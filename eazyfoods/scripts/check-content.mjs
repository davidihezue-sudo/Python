// Fails when the project contains an em dash or one of the banned fonts. Run: npm run lint:content
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'coverage', '.storage', '.storage-test', 'test-results']);
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.css', '.svg', '.sql', '.yml', '.yaml', '.html', '.txt', '.example', '.webmanifest', '']);
const EM_DASH = String.fromCharCode(0x2014);
const BANNED = ['Inter', 'Roboto', 'Arial', 'Open Sans', 'Poppins', 'Montserrat', 'Lato', 'Nunito', 'DM Sans', 'Space Grotesk'];
const fontRe = new RegExp(`(font-family[^;}\\n]*|fontFamily[^;}\\n]*|@fontsource[^\\s'"]*/|fonts\\.googleapis[^\\s'"]*)\\b(${BANNED.map((b) => b.replace(' ', '[ +-]?')).join('|')})\\b`, 'i');

let problems = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (SKIP_FILES.has(name) || !TEXT.has(extname(name)) || st.size > 3_000_000) continue;
    const text = readFileSync(p, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (line.includes(EM_DASH)) { console.log(`${p}:${i + 1}: em dash`); problems++; }
      const m = line.match(fontRe);
      if (m) { console.log(`${p}:${i + 1}: banned font ${m[2]}`); problems++; }
    });
  }
}
walk(process.cwd());
const fonts = readFileSync(join(process.cwd(), 'apps/web/src/app/globals.css'), 'utf8').match(/@import '@fontsource-variable\/[a-z0-9-]+'/g) ?? [];
if (fonts.length > 2) { console.log(`More than two font families imported: ${fonts.join(', ')}`); problems++; }
console.log(problems ? `${problems} problem(s) found` : 'Content check passed: no em dashes, no banned fonts, at most two font families.');
process.exit(problems ? 1 : 0);
