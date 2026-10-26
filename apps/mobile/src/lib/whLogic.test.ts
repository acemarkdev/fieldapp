// Run: npx tsx apps/mobile/src/lib/whLogic.test.ts
import { zRef, parseQty, formProblem, scanned, jobChoices, qtyLabel, forJob, type WhIssue } from './whLogic';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

ok('Z numbers tidied', zRef('z437') === 'Z.437' && zRef(' Z 437 ') === 'Z.437' && zRef('Z_0437 panele') === 'Z.437 panele' && zRef('Z.437') === 'Z.437' && zRef('OK PL203') === 'OK PL203');
ok('quantity: comma or dot, positive', parseQty('2,5') === 2.5 && parseQty(' 3 ') === 3 && parseQty('0') === null && parseQty('-1') === null && parseQty('abc') === null && parseQty('1.2345') === 1.235);
const F = { job: 'Z.437', symbol: 'COR-1', qty: '2', location: '', box: '', note: '' };
ok('a complete form has no problem', formProblem(F) === null);
ok('missing Z, symbol, quantity are named', /zlecenie/.test(formProblem({ ...F, job: ' ' })!) && /symbol/.test(formProblem({ ...F, symbol: '' })!) && /ilość/i.test(formProblem({ ...F, qty: '0' })!));
ok('scanned codes', scanned(' cor-1 ', 'symbol') === 'COR-1' && scanned(' A-01 ', 'location') === 'A-01');
const I = (job: string): WhIssue => ({ id: job, job_ref: job, symbol: 'X', name: null, unit: null, qty: 1, location: null, box: null, note: null, created_at: '' });
ok('job chips: own recent first, no duplicates, filtered by typing', JSON.stringify(jobChoices([I('Z.440'), I('Z.437'), I('Z.440')], ['Z.437', 'Z.450', 'Z.10'], '')) === JSON.stringify(['Z.440', 'Z.437', 'Z.450', 'Z.10']) && JSON.stringify(jobChoices([], ['Z.437', 'Z.450', 'Z.43'], '43')) === JSON.stringify(['Z.437', 'Z.43']));
ok('quantity label', qtyLabel(2.5, 'm') === '2,5 m' && qtyLabel(4, null) === '4');
const fj = forJob([I('Z.440'), I('Z.437'), I('Z.4370'), I('Z.437')], 'z 0437');
ok('list for the typed Z only (not Z.4370); nothing typed or not a Z = all', fj.job === 'Z.437' && fj.rows.length === 2 && forJob([I('Z.440'), I('Z.437')], '').rows.length === 2 && forJob([I('Z.440')], 'abc').job === null);

if (fail) { console.error(fail + ' check(s) failed'); process.exit(1); }
console.log('whLogic: all checks passed');
