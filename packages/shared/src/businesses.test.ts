// Run: npx tsx packages/shared/src/businesses.test.ts
import { defaultBusinesses, userBusinesses, businessesField, BUSINESSES } from './businesses';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
ok('three businesses with their menu groups', BUSINESSES.length === 3 && BUSINESSES[0].groups.includes('ops') && BUSINESSES[1].groups.includes('finops'));
ok('defaults by role', defaultBusinesses('admin').length === 3 && defaultBusinesses('office').join() === 'framework' && defaultBusinesses('warehouse').join() === 'acemark_pl' && defaultBusinesses('acemark_finance').join() === 'acemark_pl');
ok('a stored list wins for non-admins; admin always all', userBusinesses('office', ['scaffolding', 'framework']).join() === 'framework,scaffolding' && userBusinesses('admin', ['framework']).length === 3 && userBusinesses('office', null).join() === 'framework');
ok('unknown keys are dropped from a stored list', userBusinesses('office', ['framework', 'xyz']).join() === 'framework');
ok('an empty list means no business', userBusinesses('office', []).length === 0);
ok('input: ordered, unknown refused, null = default', (() => { const a = businessesField(['scaffolding', 'framework']); return a.ok && a.value!.join() === 'framework,scaffolding'; })() && !businessesField(['nope']).ok && (() => { const n = businessesField(null); return n.ok && n.value === null; })());
if (fail) { console.error(fail + ' check(s) failed'); process.exit(1); }
console.log('businesses: all checks passed');
