// Guard: no name may be imported twice in a server file. The runtime (tsx/esbuild) does not complain —
// the later import silently wins — so a Fin&Ops `listJobs` once replaced the office `listJobs` and the
// Operations job list showed job-cost rows. Run: npx tsx apps/api/src/importGuards.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
let fail = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  const seen = new Map<string, number>();
  for (const m of src.matchAll(/^import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s/gms)) {
    const names = [m[1], ...(m[2] ?? '').split(',').map((x) => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop())].filter(Boolean) as string[];
    for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  const dup = [...seen].filter(([, c]) => c > 1).map(([n]) => n);
  if (dup.length) { fail++; console.error(`✗ ${f}: imported more than once: ${dup.join(', ')}`); }
}
if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('All import guard tests passed.');
