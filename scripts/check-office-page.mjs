// Renders the office PAGE template (apps/api/src/office.ts) and parses its inline scripts.
// Catches escaping slips inside the template that would break the page — and with it, login.
// Run: node scripts/check-office-page.mjs
import fs from 'node:fs';

export function renderPage(file) {
  const src = fs.readFileSync(file, 'utf8'); const start = src.indexOf('const PAGE = `');
  if (start < 0) throw new Error('PAGE template not found in ' + file);
  let i = start + 14, d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '\\') { i++; continue; } if (!d && c === '`') break; if (c === '$' && src[i + 1] === '{') { d++; i++; continue; } if (d && c === '}') d--; }
  return new Function('return ' + src.slice(start + 13, i + 1).replace(/\$\{[^}]*\}/g, '[]'))();
}

if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('check-office-page.mjs')) {
  const html = renderPage(process.argv[2] ?? 'apps/api/src/office.ts');
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!scripts.length) throw new Error('no inline scripts found — the page did not render');
  for (const s of scripts) new Function(s);
  console.log(`office page OK: ${scripts.length} inline script(s), ${scripts.reduce((a, s) => a + s.length, 0)} chars`);
}
