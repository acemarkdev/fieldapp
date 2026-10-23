// Run: npx tsx apps/api/src/cortizoSymbol.test.ts
import { symbolCandidates, matchSymbol, refKeys } from './cortizo';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

const c = symbolCandidates('COR-3787 RAL 9005 CM');
ok('candidates: the symbol cut at each separator', c.includes('COR-3787 RAL 9005 CM') && c.includes('COR-3787 RAL') && c.includes('COR-3787'), c);
ok('candidates: COR-<n> also as the bare number', c.includes('3787'), c);
ok('candidates: a bare PVC number also as COR-<n>', symbolCandidates('15919 RAL 7016 CM 4000 mm').includes('COR-15919') && symbolCandidates('15919 RAL 7016 CM 4000 mm').includes('15919'));
ok('candidates: COR without a dash', symbolCandidates('COR3808').includes('COR-3808'), symbolCandidates('COR3808'));
// the fetched references then go through the same matching as Cortizo profiles
ok('fetched rows match the symbol', matchSymbol('COR-3787 RAL 9005 CM', refKeys(['COR-3787', 'COR-37'])) === 'COR-3787');

if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log('cortizoSymbol ok');
