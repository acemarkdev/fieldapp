// Run: npx tsx apps/api/src/jobBudget.test.ts
import { budgetFields, budgetCalc, vsActual, decisionStep, type Budget } from './jobBudget';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const B = (o: Partial<Budget> = {}): Budget => ({ offer_net: 30000, produce: { material: 12000, glass: 2500, transport: 1200 }, labour_hours: 40, labour_rate: 50, trade_supplier: 'Eko-Okna', trade_purchase: 19000, trade_transport: 800, trade_other: null, note: null, decision: 'undecided', ...o });

// input
const f = budgetFields({ offer_net: '30 000,00', produce: { material: '12000', glass: '', panels: null }, labour_hours: '40', labour_rate: '50', trade_purchase: '19 000', trade_supplier: '  Eko-Okna ' });
ok('form → budget: Polish amounts, empty lines left out', f.ok && f.fields.offer_net === 30000 && f.fields.produce.material === 12000 && !('glass' in f.fields.produce) && f.fields.labour_hours === 40 && f.fields.trade_purchase === 19000 && f.fields.trade_supplier === 'Eko-Okna', f);
ok('bad input is refused', !budgetFields({ offer_net: 'abc' }).ok && !budgetFields({ produce: { material: -5 } }).ok && !budgetFields({ labour_hours: 500000 }).ok);

// the two options
const c = budgetCalc(B());
ok('produce: lines + labour (40 h × 50 zł = 2000)', c.produce.labour === 2000 && c.produce.costs === 17700 && c.produce.profit === 12300 && c.produce.margin === 0.41, c.produce);
ok('trade: purchase + transport', c.trade.costs === 19800 && c.trade.profit === 10200 && c.trade.margin === 0.34 && c.trade.estimated, c.trade);
ok('produce is better by 2100', c.better === 'produce' && c.advantage === 2100, c);
ok('trade can be better', budgetCalc(B({ trade_purchase: 14000 })).better === 'trade');
ok('no comparison until both sides and the price are there', budgetCalc(B({ trade_purchase: null })).better === null && budgetCalc(B({ offer_net: null })).better === null && budgetCalc(B({ offer_net: null })).produce.profit === null);

// budget vs actual
const actual = { sums: { material: 13500, glass: 2500, transport: 900, labour: 2600 }, totalCost: 19500, sales: 30000 };
const v = vsActual(B({ decision: 'produce' }), actual);
ok('produce: line by line', v.basis === 'produce' && v.rows.find((r) => r.kind === 'material')!.diff === 1500 && v.rows.find((r) => r.kind === 'labour')!.diff === 600 && v.rows.find((r) => r.kind === 'transport')!.diff === -300, v.rows);
ok('produce: totals and over 10 % flagged', v.budgetCost === 17700 && v.actualCost === 19500 && v.diff === 1800 && v.overrun && v.budgetProfit === 12300 && v.actualProfit === 10500, v);
ok('within 10 % is not flagged', !vsActual(B(), { ...actual, totalCost: 19400 }).overrun);
const t = vsActual(B({ decision: 'trade' }), { sums: {}, totalCost: 20100, sales: null });
ok('trade: one total, no sales yet', t.basis === 'trade' && t.rows.length === 1 && t.diff === 300 && !t.overrun && t.actualProfit === null, t);

// decisions
ok('only an admin decides', !decisionStep('undecided', 'produce', false).ok && decisionStep('undecided', 'produce', true).ok);
ok('reopen and change', decisionStep('produce', 'undecided', true).ok && decisionStep('trade', 'rejected', true).ok && !decisionStep('produce', 'produce', true).ok && !decisionStep('produce', 'maybe', true).ok);

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('jobBudget: all passed');
