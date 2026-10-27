// Run: npx tsx apps/api/src/finOrderPapers.test.ts
import { quoteInForce, quoteCost, quoteMargin, orderFromQuotes, quoteFields, fileFrom, type QuoteRow } from './finOrderPapers';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

const q = (version: number, status: QuoteRow['status'], amount: number, over: Partial<QuoteRow> = {}): QuoteRow => ({
  id: 'q' + version, order_id: 'o1', version, amount, scope: 'install', cost_purchase: 5000, cost_install: 1000, cost_delivery: 500,
  status, comment: null, file_name: 'q.pdf', storage_path: 'p', content_type: 'application/pdf', size_bytes: 1, status_at: '', status_by: null, created_by: null, created_at: '', ...over });

// Which version counts
ok('no quotes → nothing set on the order', quoteInForce([]) === null && orderFromQuotes([]) === null);
ok('the newest counts while none is approved', quoteInForce([q(1, 'rework', 10000), q(2, 'sent', 9500)])?.version === 2);
ok('an approved version wins over a newer one', quoteInForce([q(1, 'approved', 10000), q(2, 'sent', 9500)])?.version === 1);

// Cost and margin; delivery only leaves out installation
ok('cost: install counts when we install', quoteCost(q(1, 'sent', 10000)) === 6500 && quoteMargin(q(1, 'sent', 10000)) === 0.35);
ok('cost: delivery only drops installation', quoteCost(q(1, 'sent', 10000, { scope: 'delivery' })) === 5500 && quoteMargin(q(1, 'sent', 0)) === null);

// What the order gets
const a = orderFromQuotes([q(1, 'rework', 10000), q(2, 'approved', 9000, { cost_purchase: 4000 }), q(3, 'sent', 9900)]);
ok('approved → accepted, its amount and budget', !!a && a.status === 'accepted' && a.net === 9000 && a.cost_purchase === 4000 && a.cost_install === 1000, a);
ok('newest rejected (none approved) → lost', orderFromQuotes([q(1, 'rework', 10000), q(2, 'rejected', 9000)])?.status === 'lost');
ok('an older rejection does not lose the order', orderFromQuotes([q(1, 'rejected', 10000), q(2, 'sent', 9000)])?.status === 'offer');
ok('delivery only → no installation cost on the order', orderFromQuotes([q(1, 'sent', 8000, { scope: 'delivery' })])?.cost_install === 0);

// The form
const c = quoteFields({ amount: '12 500,50', scope: 'delivery', cost_purchase: '7000', status: 'sent' }, true);
ok('new version: amount, scope, status', c.ok && c.fields.amount === 12500.5 && c.fields.scope === 'delivery' && c.fields.status === 'sent' && c.fields.cost_purchase === 7000, c);
ok('new version needs an amount; status checked', !quoteFields({ amount: '' }, true).ok && !quoteFields({ amount: 1, status: 'maybe' }, true).ok && quoteFields({ amount: 1 }, true).ok);
const u = quoteFields({ amount: 1, scope: 'delivery', status: 'approved' }, false);
ok('a saved version: amount and scope stay, status changes', u.ok && !('amount' in u.fields) && !('scope' in u.fields) && u.fields.status === 'approved', u);
ok('negative cost refused', !quoteFields({ cost_delivery: '-5' }, false).ok);

// Files
const f = fileFrom({ name: 'Oferta v2.pdf', dataUrl: 'data:application/pdf;base64,' + Buffer.from('hello').toString('base64') });
ok('file: a data URL becomes bytes', f.ok && f.name === 'Oferta v2.pdf' && f.contentType === 'application/pdf' && f.bytes.toString() === 'hello', f.ok ? f.name : f);
ok('file: missing or not a data URL', !fileFrom(null).ok && !fileFrom({ dataUrl: 'hello' }).ok);

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('All order papers tests passed.');
