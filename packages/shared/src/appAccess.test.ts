// Run: npx tsx packages/shared/src/appAccess.test.ts
import { appLevel, appLevels, hasApp, setOverride, defaultAppLevel } from './appAccess';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

ok('defaults follow the capabilities', appLevel('acemark_finance', 'fin.jobs') === 'edit' && appLevel('production_manager', 'fin.jobs') === 'off' && appLevel('acemark_finance', 'fin.stock') === 'view');
ok('admin always edit, customer never', appLevel('admin', 'fin.payroll', { admin: { 'fin.payroll': 'off' } }) === 'edit' && appLevel('customer', 'fin.jobs', { customer: { 'fin.jobs': 'edit' } }) === 'off');
const o = { production_manager: { 'fin.jobs': 'view' as const }, acemark_finance: { 'fin.payroll': 'off' as const } };
ok('override grants and removes', appLevel('production_manager', 'fin.jobs', o) === 'view' && appLevel('acemark_finance', 'fin.payroll', o) === 'off' && appLevel('acemark_finance', 'fin.jobs', o) === 'edit');
ok('hasApp: any of the apps', hasApp('production_manager', ['fin.jobs', 'fin.performance'], 'view', o) && !hasApp('production_manager', ['fin.jobs'], 'edit', o) && !hasApp('production_manager', ['fin.costs'], 'view', o));
ok('all levels for a role', appLevels('production_manager', o)['fin.jobs'] === 'view' && appLevels('production_manager', o)['fin.costs'] === 'off');
let s = setOverride({}, 'production_manager', 'fin.jobs', 'edit');
ok('set an override', s.ok && s.overrides.production_manager?.['fin.jobs'] === 'edit', s);
s = setOverride(s.ok ? s.overrides : {}, 'production_manager', 'fin.jobs', 'off');
ok('back to the default → nothing stored', s.ok && !s.overrides.production_manager, s);
ok('refused: admin, customer, unknown app/level, editing stock', !setOverride({}, 'admin', 'fin.jobs', 'off').ok && !setOverride({}, 'customer', 'fin.jobs', 'view').ok && !setOverride({}, 'office', 'fin.x', 'view').ok && !setOverride({}, 'office', 'fin.jobs', 'all').ok && !setOverride({}, 'office', 'fin.stock', 'edit').ok);
ok('stock is never edit', appLevel('office', 'fin.stock', { office: { 'fin.stock': 'edit' } }) === 'view' && defaultAppLevel('admin', 'fin.stock') === 'edit');

ok('warehouse issues: finance edits by default, others off, admin edit', appLevel('acemark_finance', 'wh.issues') === 'edit' && appLevel('warehouse', 'wh.issues') === 'off' && appLevel('production_manager', 'wh.issues') === 'off' && appLevel('admin', 'wh.issues') === 'edit');

if (fail) { console.error(fail + ' check(s) failed'); process.exit(1); }
console.log('appAccess: all checks passed');
