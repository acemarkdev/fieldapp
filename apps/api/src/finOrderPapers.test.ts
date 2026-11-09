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

ok('cost: other reps fees count in the cost and margin', quoteCost(q(1, 'sent', 10000), 500) === 7000 && quoteMargin(q(1, 'sent', 10000), 500) === 0.3);

// What the order gets
const a = orderFromQuotes([q(1, 'rework', 10000), q(2, 'approved', 9000, { cost_purchase: 4000 }), q(3, 'sent', 9900)]);
ok('approved → accepted, its amount and budget', !!a && a.status === 'accepted' && a.net === 9000 && a.cost_purchase === 4000 && a.cost_install === 1000, a);
const two = orderFromQuotes([q(1, 'approved', 10000, { cost_purchase: 4000, cost_install: 1000, cost_delivery: 500, scope: 'install' }), q(2, 'approved', 6000, { cost_purchase: 2000, cost_install: 800, cost_delivery: 300, scope: 'delivery' }), q(3, 'sent', 9000)]);
ok('several approved quotes add up: net, purchase, installation (install scope only), delivery', !!two && two.status === 'accepted' && two.net === 16000 && two.cost_purchase === 6000 && two.cost_install === 1000 && two.cost_delivery === 800, two);
ok('a sent or rejected quote next to approved ones does not count', orderFromQuotes([q(1, 'approved', 5000), q(2, 'approved', 2500), q(3, 'rejected', 99999)])?.net === 7500);
ok('newest rejected (none approved) → lost', orderFromQuotes([q(1, 'rework', 10000), q(2, 'rejected', 9000)])?.status === 'lost');
ok('an older rejection does not lose the order', orderFromQuotes([q(1, 'rejected', 10000), q(2, 'sent', 9000)])?.status === 'offer');
ok('delivery only → no installation cost on the order', orderFromQuotes([q(1, 'sent', 8000, { scope: 'delivery' })])?.cost_install === 0);
ok('self pickup: neither installation nor delivery counts', quoteCost(q(1, 'sent', 10000, { scope: 'pickup' })) === 5000 && JSON.stringify(orderFromQuotes([q(1, 'sent', 8000, { scope: 'pickup' })])) === JSON.stringify({ net: 8000, cost_purchase: 5000, cost_install: 0, cost_delivery: 0, status: 'offer' }));
ok('self pickup is kept from the form', (quoteFields({ amount: '100', scope: 'pickup', status: 'sent' }, true) as any).fields.scope === 'pickup' && (quoteFields({ amount: '100', scope: 'xyz', status: 'sent' }, true) as any).fields.scope === 'install');

// The form
const c = quoteFields({ amount: '12 500,50', scope: 'delivery', cost_purchase: '7000', status: 'sent' }, true);
ok('new version: amount, scope, status', c.ok && c.fields.amount === 12500.5 && c.fields.scope === 'delivery' && c.fields.status === 'sent' && c.fields.cost_purchase === 7000, c);
ok('new version needs an amount; status checked', !quoteFields({ amount: '' }, true).ok && !quoteFields({ amount: 1, status: 'maybe' }, true).ok && quoteFields({ amount: 1 }, true).ok);
const u = quoteFields({ amount: 1, scope: 'delivery', status: 'approved' }, false);
ok('an edit may change the amount and scope too', u.ok && u.fields.amount === 1 && u.fields.scope === 'delivery' && u.fields.status === 'approved', u);
const st = quoteFields({ status: 'approved' }, false);
ok('a status change alone leaves the amount and scope', st.ok && !('amount' in st.fields) && !('scope' in st.fields), st);
const parts = quoteFields({ amount_goods: '10 000', price_install: '2 000', price_delivery: '500', scope: 'install' }, true);
ok('price in parts: products + installation + transport = the amount', parts.ok && parts.fields.amount === 12500 && parts.fields.price_install === 2000 && parts.fields.price_delivery === 500, parts);
const dlv = quoteFields({ amount_goods: '10000', price_install: '2000', price_delivery: '500', scope: 'delivery' }, true);
ok('delivery only: the installation price does not count', dlv.ok && dlv.fields.amount === 10500 && dlv.fields.price_install === null, dlv);
const pick = quoteFields({ amount_goods: '10000', price_install: '2000', price_delivery: '500', scope: 'pickup' }, true);
ok('self pickup: neither installation nor transport counts', pick.ok && pick.fields.amount === 10000 && pick.fields.price_delivery === null, pick);
const ed = quoteFields({ amount_goods: '8000', price_install: '1000', price_delivery: '300' }, false, { scope: 'delivery' });
ok('an edit without a scope uses the saved scope', ed.ok && ed.fields.amount === 8300 && !('scope' in ed.fields), ed);
ok('a negative part is refused', !quoteFields({ amount_goods: '1000', price_delivery: '-5', scope: 'install' }, true).ok);
ok('negative cost refused', !quoteFields({ cost_delivery: '-5' }, false).ok);

// Files
const f = fileFrom({ name: 'Oferta v2.pdf', dataUrl: 'data:application/pdf;base64,' + Buffer.from('hello').toString('base64') });
ok('file: a data URL becomes bytes', f.ok && f.name === 'Oferta v2.pdf' && f.contentType === 'application/pdf' && f.bytes.toString() === 'hello', f.ok ? f.name : f);
ok('file: missing or not a data URL', !fileFrom(null).ok && !fileFrom({ dataUrl: 'hello' }).ok);

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('All order papers tests passed.');
