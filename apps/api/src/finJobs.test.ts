// Fin&Ops job-cost rules. Run: npx tsx apps/api/src/finJobs.test.ts
import { parseMoney, parseMonth, referenceKey, itemAmount, summarizeJob, importRowToJob } from './finJobs';

let fail = 0;
const ok = (label: string, cond: boolean, extra: any = '') => { if (!cond) { fail++; console.error('✗ ' + label, extra); } else console.log('✓ ' + label); };

ok('money "16 839,40"', parseMoney('16 839,40') === 16839.4);
ok('money "3,434.36"', parseMoney('3,434.36') === 3434.36);
ok('money "1.234,50 zł"', parseMoney('1.234,50 zł') === 1234.5);
ok('money 920 / "920"', parseMoney(920) === 920 && parseMoney('920') === 920);
ok('money "" / "-" / text → null', parseMoney('') === null && parseMoney('-') === null && parseMoney('abc') === null);
ok('money negative', parseMoney('-4 670,91') === -4670.91);
ok('month "Wrzesień " → 9', parseMonth('Wrzesień ') === 9);
ok('month "Październik" → 10, "Grudzień " → 12, "Luty" → 2', parseMonth('Październik') === 10 && parseMonth('Grudzień ') === 12 && parseMonth('Luty') === 2);
ok('month "September" / 9 / "" ', parseMonth('September') === 9 && parseMonth(9) === 9 && parseMonth('') === null);
ok('reference key: "Z.102 panele" ≠ "Z.102"', referenceKey('Z.102 panele') === 'Z.102PANELE' && referenceKey(' z.102 ') === 'Z.102');
ok('labour = hours × rate', itemAmount('labour', 0, 73.5, 46.73) === 3434.66);
ok('labour without hours keeps the amount', itemAmount('labour', 500, null, null) === 500);
ok('other kinds ignore hours/rate', itemAmount('transport', '920', 5, 100) === 920);

// The sheet's own example: Z.373 (May 2026)
const z373 = summarizeJob(27664.72, [{ kind: 'material', amount: 16839.4 }, { kind: 'transport', amount: 920 }, { kind: 'labour', amount: 3434.36, hours: 73.5 }]);
ok('Z.373 total cost = 21,193.76', z373.totalCost === 21193.76, z373.totalCost);
ok('Z.373 profit = 6,470.96', z373.profit === 6470.96, z373.profit);
ok('Z.373 profitability = 23.39%', z373.margin === 0.2339, z373.margin);
ok('Z.373 hours and per-kind sums', z373.hours === 73.5 && z373.sums.material === 16839.4 && z373.sums.glass === 0);
ok('several lines of one kind add up (two invoices)', summarizeJob(1000, [{ kind: 'material', amount: 300 }, { kind: 'material', amount: 200.5 }]).sums.material === 500.5);
const noSales = summarizeJob(null, [{ kind: 'material', amount: 100 }]);
ok('no sales yet → profit and % are blank, not an error', noSales.profit === null && noSales.margin === null && noSales.totalCost === 100);
ok('sales 0 → loss shown, % blank (no divide by zero)', summarizeJob(0, [{ kind: 'material', amount: 100 }]).profit === -100 && summarizeJob(0, [{ kind: 'material', amount: 100 }]).margin === null);

const imp = importRowToJob({ reference: 'Z.373', month: 'Maj', year: 2026, customer: 'PCW', sales: 27664.72, hours: 73.5, costs: { material: 16839.4, panels: 0, transport: 920, labour: 3434.36 } })!;
ok('import: job fields', imp.job.reference_key === 'Z.373' && imp.job.period_month === 5 && imp.job.period_year === 2026 && imp.job.customer === 'PCW' && imp.job.sales === 27664.72);
ok('import: one line per non-zero column', imp.items.length === 3 && imp.items.map((i) => i.kind).join() === 'material,transport,labour');
ok('import: labour keeps the sheet cost with rate = cost ÷ hours', imp.items[2].amount === 3434.36 && imp.items[2].hours === 73.5 && imp.items[2].rate === 46.73);
ok('import: labour cost without hours', importRowToJob({ reference: 'Z.1', costs: { labour: 500 } })!.items[0].hours === null);
ok('import: empty job row still creates the job', importRowToJob({ reference: 'Z.530', month: '', costs: {} })!.items.length === 0);
ok('import: blank reference skipped', importRowToJob({ reference: '  ' }) === null);

// Every row of the real "Koszty" sheet, if the extract is present (not in CI).
try {
  const { readFileSync } = await import('node:fs');
  const rows = JSON.parse(readFileSync((process.env.TMPDIR ?? '') + '/fin/koszty-rows.json', 'utf8'));
  let cmp = 0, bad: any[] = [];
  for (const r of rows) {
    const x = importRowToJob(r)!; const s = summarizeJob(x.job.sales, x.items as any);
    const st = Number(r.sheet.total) || 0, sp = Number(r.sheet.profit) || 0;
    cmp++;
    // "Z.290 pop" has sales but its total/profit formulas are missing in the sheet (shows no profit); the app's 2,100 is right.
    if (r.reference === 'Z.290 pop') { if (s.profit !== 2100) bad.push([r.reference, s.profit]); continue; }
    if (Math.abs(s.totalCost - st) > 0.011 || Math.abs((s.profit ?? 0) - sp) > 0.011) bad.push([r.reference, s.totalCost, st, s.profit, sp]);
  }
  ok(`real sheet: ${cmp} jobs — total cost and profit equal the sheet's`, bad.length === 0, bad.slice(0, 5));
  ok('real sheet: references are unique jobs', new Set(rows.map((r: any) => importRowToJob(r)!.job.reference_key)).size === rows.length);
} catch { console.log('· real-sheet comparison skipped (no extract)'); }

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('\nAll job-cost rule tests passed.');
