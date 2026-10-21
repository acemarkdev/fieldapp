// Run: npx tsx apps/api/src/warehouse.test.ts
import { rwSheets, sheetName, issueFields, jobKey, usage } from './warehouse';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

const R = (job: string, symbol: string, qty: number, name: string | null = null, unit: string | null = 'szt') => ({ job_ref: job, job_key: jobKey(job), symbol, name, unit, qty });
const sh = rwSheets([R('Z.437', 'COR-1', 2, 'Profil'), R('Z.10', 'B-2', 1.5), R('Z.437', 'cor-1', 3), R('Z.437', 'A-9', 1), R('Z 437', 'A-9', 0.25)]);
ok('one sheet per Z, Z.10 before Z.437 (numeric), all issues', sh.length === 2 && sh[0].job_ref === 'Z.10' && sh[1].job_ref === 'Z.437' && sh.every((x) => x.kind === 'issue'), sh.map((s) => s.job_ref));
ok('same symbol added up (case-insensitive), "Z 437" is the same Z', sh[1].lines.length === 2 && sh[1].lines.find((l) => l.symbol === 'COR-1')!.qty === 5 && sh[1].lines.find((l) => l.symbol === 'A-9')!.qty === 1.25, sh[1]);
ok('lines A–Z, name kept', sh[1].lines[0].symbol === 'A-9' && sh[1].lines[1].name === 'Profil');
const used = new Set<string>();
ok('sheet names: forbidden characters replaced, unique, max 31', sheetName('Z.1/2', used) === 'Z.1_2' && sheetName('Z.1/2', used) === 'Z.1_2 2' && sheetName('x'.repeat(40), used).length <= 31, [...used]);
ok('office correction: symbol upper-cased, qty with a comma', (() => { const f = issueFields({ job_ref: ' Z.437 ', symbol: 'cor-1', qty: '2,5', location: 'A1' }); return f.ok && f.fields.symbol === 'COR-1' && f.fields.qty === 2.5 && f.fields.job_key === 'Z.437' && f.fields.location === 'A1'; })());
ok('office correction refused without Z, symbol or a positive quantity', !issueFields({ symbol: 'A', qty: 1 }).ok && !issueFields({ job_ref: 'Z.1', qty: 1 }).ok && !issueFields({ job_ref: 'Z.1', symbol: 'A', qty: 0 }).ok);

// returns: their own sheets (PW), after the issues (RW); usage = issued − returned
const mix = [{ ...R('Z.437', 'COR-1', 5, 'Profil'), kind: 'issue' as const }, { ...R('Z.437', 'COR-1', 1.5), kind: 'return' as const }, { ...R('Z.10', 'B-2', 2), kind: 'return' as const }];
const ms = rwSheets(mix);
ok('issues first, then returns, each per Z', ms.map((x) => x.kind + ' ' + x.job_ref).join(',') === 'issue Z.437,return Z.10,return Z.437', ms.map((x) => x.kind + ' ' + x.job_ref));
const us = usage(mix);
ok('usage per Z and symbol', us.length === 2 && us.find((u) => u.symbol === 'COR-1')!.used === 3.5 && us.find((u) => u.symbol === 'COR-1')!.returned === 1.5 && us.find((u) => u.symbol === 'B-2')!.used === -2, us);

if (fail) { console.error(fail + ' check(s) failed'); process.exit(1); }
console.log('warehouse: all checks passed');
