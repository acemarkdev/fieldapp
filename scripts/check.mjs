// One command before every push:  npm run check
//   1. type check — server (apps/api + packages/shared, strict) and mobile app
//   2. office page check — the inline scripts of the office web page must parse
//   3. every *.test.ts in apps/api/src and packages/shared/src
// Exits non-zero on the first kind of failure it finds, after running everything.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const bin = (n) => join('node_modules', '.bin', n);
const steps = [
  ['types: server', bin('tsc'), ['-p', 'apps/api']],
  ['types: mobile', join('apps', 'mobile', 'node_modules', '.bin', 'tsc'), ['--noEmit', '-p', 'apps/mobile']],
  ['office page', process.execPath, ['scripts/check-office-page.mjs']],
];
for (const dir of ['apps/api/src', 'packages/shared/src'])
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.test.ts')).sort())
    steps.push([`test: ${f}`, bin('tsx'), [join(dir, f)]]);

const failed = [];
for (const [name, cmd, args] of steps) {
  const t = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  const ok = r.status === 0;
  console.log(`${ok ? '✓' : '✗'} ${name}  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  if (!ok) { failed.push(name); console.log(((r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : '')).trim().split('\n').slice(0, 40).map((l) => '    ' + l).join('\n')); }
}
console.log(failed.length ? `\n${failed.length} check(s) FAILED: ${failed.join(', ')}` : `\nAll ${steps.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
