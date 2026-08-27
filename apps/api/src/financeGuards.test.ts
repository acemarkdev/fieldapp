// Guard audit: every finance HTTP route in office.ts must be immediately protected by a
// finance capability check, so a refactor can't silently expose costs/prices. Also asserts
// the mobile app never queries a finance table.
// Run: npx tsx apps/api/src/financeGuards.test.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const office = readFileSync(join(dir, 'office.ts'), 'utf8').split('\n');
let fail = 0;
const ok = (label: string, cond: boolean) => { if (!cond) { fail++; console.error('✗ ' + label); } else console.log('✓ ' + label); };

// A finance route line: declares an HTTP route (has req.method) AND touches finance paths.
const isRouteDecl = (l: string) => /req\.method\s*===/.test(l) && /if \(p\b/.test(l);
const touchesFinance = (l: string) => /pricing-rules|\/pricing'|price\.pdf/.test(l);
const isGenericItemRoute = (l: string) => /!p\.endsWith\('\/pricing'\)/.test(l); // explicitly NOT finance

let financeRoutes = 0;
for (let i = 0; i < office.length; i++) {
  const l = office[i];
  if (!isRouteDecl(l) || !touchesFinance(l) || isGenericItemRoute(l)) continue;
  financeRoutes++;
  const near = office.slice(i + 1, i + 3).join(' ');
  ok(`guarded: ${l.trim().slice(0, 66)}`, /allow\('finance\.(view|manage)'\)/.test(near));
}
ok(`found >= 8 finance routes (got ${financeRoutes})`, financeRoutes >= 8);
ok('>= 8 finance guards present', (office.join('\n').match(/allow\('finance\.(view|manage)'\)/g) || []).length >= 8);

// Mobile must never query a finance table.
let mobileHits = 0;
const walk = (p: string) => {
  let entries: string[] = [];
  try { entries = readdirSync(p); } catch { return; }
  for (const f of entries) {
    const fp = join(p, f);
    if (statSync(fp).isDirectory()) walk(fp);
    else if (/\.(ts|tsx)$/.test(f)) {
      const t = readFileSync(fp, 'utf8');
      if (/\.from\(['"](pricing_rules|job_pricing|item_pricing)['"]\)/.test(t)) { mobileHits++; console.error('  finance table used in', fp); }
    }
  }
};
walk(join(dir, '../../mobile'));
ok('mobile app never queries a finance table', mobileHits === 0);

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('\nAll finance-guard audits passed.');
