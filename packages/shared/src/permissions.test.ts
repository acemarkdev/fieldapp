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
for (const cap of ['jobs.manage', 'items.create', 'items.edit', 'items.fit', 'snags.raise', 'qa.signoff', 'photos.add', 'teams.manage', 'monday.sync', 'users.manage', 'customers.manage', 'purchasing.manage', 'purchasing.request', 'dashboard.view'] as const) {
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

// --- logistics: the Logistics menu (labels + confirmations) and the Cortizo profiles stock, nothing else ---
{
  const { CAPABILITIES } = await import('./permissions');
  const LOGI = ['labels.print', 'confirmations.manage', 'stock.view'];
  for (const c of CAPABILITIES) ok(`logistics ${c.key} === ${LOGI.includes(c.key)}`, can('logistics', c.key) === LOGI.includes(c.key));
  ok('office lacks confirmations.manage', can('office', 'confirmations.manage') === false);
  ok('admin has labels.print', can('admin', 'labels.print') === true);
  ok('office lacks labels.print', can('office', 'labels.print') === false);
}

// --- acemark_finance: Fin&Ops (view) + sales orders, and nothing else ---
{
  const { CAPABILITIES } = await import('./permissions');
  const fin = new Set(['finops.view', 'sales.orders']);
  for (const c of CAPABILITIES) ok(`acemark_finance ${c.key} === ${fin.has(c.key)}`, can('acemark_finance', c.key) === fin.has(c.key));
  for (const r of ['office', 'surveyor', 'scanner', 'fitter', 'invoice_manager', 'customer', 'logistics', 'sales_rep'] as const) ok(`${r} lacks finops.view`, can(r, 'finops.view') === false);
  // --- sales_rep: the sales orders register and nothing else ---
  for (const c of CAPABILITIES) ok(`sales_rep ${c.key} === ${c.key === 'sales.orders'}`, can('sales_rep', c.key) === (c.key === 'sales.orders'));
  for (const c of CAPABILITIES) ok(`production ${c.key}`, can('production', c.key) === (c.key === 'time.log'));
  for (const c of CAPABILITIES) ok(`production_manager ${c.key}`, can('production_manager', c.key) === (c.key === 'time.manage' || c.key === 'time.rates' || c.key === 'stock.view' || c.key === 'time.log'));
  for (const c of CAPABILITIES) ok(`production_lead ${c.key}`, can('production_lead', c.key) === (c.key === 'time.manage' || c.key === 'time.log'));
  for (const c of CAPABILITIES) ok(`warehouse ${c.key}`, can('warehouse', c.key) === (c.key === 'time.log'));
  for (const c of CAPABILITIES) ok(`scaffolding ${c.key}`, can('scaffolding', c.key) === false);
  // --- acemark_fitter: the cost reports form and nothing else ---
  for (const c of CAPABILITIES) ok(`acemark_fitter ${c.key} === ${c.key === 'expenses.report'}`, can('acemark_fitter', c.key) === (c.key === 'expenses.report'));
  for (const r of ['office', 'surveyor', 'scanner', 'fitter', 'invoice_manager', 'customer', 'logistics'] as const) ok(`${r} lacks sales.orders`, can(r, 'sales.orders') === false);
  ok('admin has sales.orders', can('admin', 'sales.orders') === true);
  ok('admin has finops.manage', can('admin', 'finops.manage') === true);
}

// --- unknown / null role gets nothing ---
ok('null role lacks finance.view', can(null, 'finance.view') === false);
ok('unknown role lacks finance.view', can('someone', 'finance.view' as any) === false);

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('\nAll access-control tests passed.');
