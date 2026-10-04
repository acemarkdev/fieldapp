// Fin&Ops sales rules. Run: npx tsx apps/api/src/finSales.test.ts
import { parseDate, saleFields, saleKey, saleChannel } from './finSales';
import { effectiveSales } from './finJobs';

let fail = 0;
const ok = (label: string, cond: boolean, extra: any = '') => { if (!cond) { fail++; console.error('✗ ' + label, JSON.stringify(extra)); } else console.log('✓ ' + label); };
const F = (b: any) => { const r = saleFields(b); return r.ok ? r.fields : null; };

ok('date ISO / with time', parseDate('2025-01-03') === '2025-01-03' && parseDate('2025-01-03 00:00:00') === '2025-01-03');
ok('date 03.01.2025 and 3/1/2025 are day-first', parseDate('03.01.2025') === '2025-01-03' && parseDate('3/1/2025') === '2025-01-03');
ok('bad dates → null', parseDate('') === null && parseDate('soon') === null && parseDate('2025-13-01') === null);
ok('channel: Acemark PL = production', saleChannel('Acemark PL') === 'production');
ok('channel: Eko-okna / no producer / anything else = trade', saleChannel('Eko-okna') === 'trade' && saleChannel(null) === 'trade' && saleChannel('Profal') === 'trade');

const a = F({ date: '2025-01-07', invoice_no: 'FS 2/ACE/01/2025', job: 'Z.164', month: 'Styczeń', year: 2025, producer: 'Acemark PL', buyer: 'ARGlass', net: 51950, gross: 51950, country: 'uk', seller: 'Acemark PL' })!;
ok('sheet row → fields', a.invoice_no === 'FS 2/ACE/01/2025' && a.invoice_date === '2025-01-07' && a.job_key === 'Z.164' && a.period_month === 1 && a.period_year === 2025 && a.net === 51950 && a.country === 'UK' && a.kind === 'final', a);
ok('job key matches Job costs ("Z.419 " with a stray space)', F({ job: 'Z.419 ', net: 1 })!.job_key === 'Z.419');
ok('note "Zaliczka 50% w sierpniu" → prepayment', F({ net: 100, note: 'Zaliczka 50% w sierpniu' })!.kind === 'prepaid');
ok('explicit type wins over the note', F({ net: 100, note: 'zaliczka', kind: 'final' })!.kind === 'final');
ok('month/year default to the invoice date', (() => { const x = F({ net: 5, invoice_date: '14.03.2026' })!; return x.period_year === 2026 && x.period_month === 3; })());
ok('given month wins over the date (invoice dated in another month)', F({ net: 5, invoice_date: '2026-10-01', month: 'Wrzesień', year: 2026 })!.period_month === 9);
ok('no job → not tied to a job', F({ net: 5 })!.job_key === null);
ok('label instead of a job is kept as its own group', F({ net: 5, job: 'Akcesoria' })!.job_key === 'AKCESORIA');
ok('net required', saleFields({ net: '' }).ok === false && saleFields({ net: 'abc' }).ok === false);
ok('net "161 041,86"', F({ net: '161 041,86' })!.net === 161041.86);
ok('credit note (negative) allowed', F({ net: -500 })!.net === -500);
ok('same number + job + net = same line (pasting again)', saleKey(F({ net: 51950, job: 'Z.164', invoice_no: 'FS 2/ACE/01/2025' }) as any) === saleKey(F({ net: '51 950,00', job: 'z.164 ', invoice_no: 'fs 2/ace/01/2025 ' }) as any));
ok('same number on another job or amount = a different line (kept)', saleKey(F({ net: 6260, job: 'złom', invoice_no: 'FS 4/ACE/02/2026' }) as any) !== saleKey(F({ net: 485, job: 'akcesoria', invoice_no: 'FS 4/ACE/02/2026' }) as any));
ok('planned line without a number: job + month + net', saleKey(F({ net: 70000, job: 'Z.421', month: 9, year: 2026 }) as any) === saleKey(F({ net: '70000', job: 'z.421', month: 'Wrzesień', year: 2026 }) as any) && saleKey(F({ net: 70000, job: 'Z.421', month: 9, year: 2026 }) as any) !== saleKey(F({ net: 70001, job: 'Z.421', month: 9, year: 2026 }) as any));

// which sales figure a job uses
ok('no invoices → typed value', JSON.stringify(effectiveSales({ sales: 100, locked: false }, undefined)) === JSON.stringify({ sales: 100, salesSource: 'typed', salesTyped: 100, salesInvoiced: null, salesInvoices: 0 }));
ok('has invoices → their sum', effectiveSales({ sales: 114400, locked: false }, { net: 73900, count: 4 }).sales === 73900 && effectiveSales({ sales: 114400, locked: false }, { net: 73900, count: 4 }).salesSource === 'invoices');
ok('locked → stored value stands even if invoices changed', effectiveSales({ sales: 73900, locked: true }, { net: 80000, count: 5 }).sales === 73900 && effectiveSales({ sales: 73900, locked: true }, { net: 80000, count: 5 }).salesSource === 'locked');

// Every row of the real "Sprzedaż" sheet, if the extract is present (not in CI).
try {
  const { readFileSync } = await import('node:fs');
  const rows = JSON.parse(readFileSync((process.env.TMPDIR ?? '') + '/fin/sprzedaz-rows.json', 'utf8'));
  const all = rows.map((r: any) => F(r)), fs = all.filter(Boolean);
  const sum = (a: any[]) => Math.round(a.reduce((s, x) => s + x.net, 0) * 100) / 100;
  // The sheet has one divider row ("PLAN", no amounts) between real and planned invoices — rightly not an invoice.
  ok(`real sheet: ${fs.length} of ${rows.length} rows are invoices; the only other row is the "PLAN" divider`, rows.length - fs.length === 1 && rows[all.indexOf(null)].job === 'PLAN');
  ok('real sheet: total net = 7,639,228.85', sum(fs) === 7639228.85, sum(fs));
  const m = (y: number, mo: number) => fs.filter((x: any) => x.period_year === y && x.period_month === mo);
  const ch = (a: any[], c: string) => sum(a.filter((x: any) => saleChannel(x.producer) === c));
  ok('real sheet: Jan 2026 = 219,532.45 → Orpiszew 202,884.62 + Trade 16,647.83 (as the Performance Sheet)', sum(m(2026, 1)) === 219532.45 && ch(m(2026, 1), 'production') === 202884.62 && ch(m(2026, 1), 'trade') === 16647.83, [sum(m(2026, 1)), ch(m(2026, 1), 'production'), ch(m(2026, 1), 'trade')]);
  ok('real sheet: Feb 2026 → 347,280.79 + 117,337.54', ch(m(2026, 2), 'production') === 347280.79 && ch(m(2026, 2), 'trade') === 117337.54);
  ok('real sheet: May 2026 → 281,800.22 + 184,808.28', ch(m(2026, 5), 'production') === 281800.22 && ch(m(2026, 5), 'trade') === 184808.28);
  const keys = new Set(fs.map((x: any) => saleKey(x)));
  console.log(`· real sheet: ${new Set(fs.map((x: any) => x.job_key).filter(Boolean)).size} jobs/labels, ${fs.filter((x: any) => !x.job_key).length} lines without a job, ${fs.filter((x: any) => x.kind === 'prepaid').length} prepayments, ${fs.length - keys.size} line(s) that look like repeats, ${fs.filter((x: any) => !x.invoice_no).length} planned (no invoice number yet)`);
} catch (e: any) { console.log('· real-sheet comparison skipped (no extract)'); }

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('\nAll sales rule tests passed.');
