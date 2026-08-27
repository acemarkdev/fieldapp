// Access-control tests — especially the finance walls. Run: npx tsx packages/shared/src/permissions.test.ts
import { can, ROLES } from './permissions';

let fail = 0;
const ok = (label: string, cond: boolean) => { if (!cond) { fail++; console.error('✗ ' + label); } else console.log('✓ ' + label); };

// --- finance capabilities: ONLY admin + invoice_manager ---
const financeRoles = ['admin', 'invoice_manager'];
for (const r of ROLES) {
  const shouldHave = financeRoles.includes(r);
  ok(`${r} finance.view === ${shouldHave}`, can(r, 'finance.view') === shouldHave);
  ok(`${r} finance.manage === ${shouldHave}`, can(r, 'finance.manage') === shouldHave);
}

// --- invoice_manager must have NO operational capabilities ---
for (const cap of ['jobs.manage', 'items.create', 'items.edit', 'items.fit', 'snags.raise', 'photos.add', 'teams.manage', 'monday.sync', 'users.manage', 'dashboard.view'] as const) {
  ok(`invoice_manager lacks ${cap}`, can('invoice_manager', cap) === false);
}

// --- office is a manager but NOT finance ---
ok('office has jobs.manage', can('office', 'jobs.manage') === true);
ok('office lacks finance.view', can('office', 'finance.view') === false);
ok('office lacks finance.manage', can('office', 'finance.manage') === false);

// --- field roles have no finance ---
for (const r of ['surveyor', 'scanner', 'fitter'] as const) {
  ok(`${r} lacks finance.view`, can(r, 'finance.view') === false);
}

// --- unknown / null role gets nothing ---
ok('null role lacks finance.view', can(null, 'finance.view') === false);
ok('unknown role lacks finance.view', can('someone', 'finance.view' as any) === false);

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('\nAll access-control tests passed.');
