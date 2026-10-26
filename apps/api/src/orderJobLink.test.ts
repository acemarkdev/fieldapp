// Run: npx tsx apps/api/src/orderJobLink.test.ts
import { jobKeyOf, orderCostsFromBudget, orderJobView, tradeFromOrder, mondayItemUrl } from './orderJobLink';
import type { Budget } from './jobBudget';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

ok('order Z → Job costs key', jobKeyOf('Z.453') === 'Z.453' && jobKeyOf('z 0453') === 'Z.453' && jobKeyOf('Z.453 faza 1') === 'Z.453' && jobKeyOf('') === null && jobKeyOf('OK PL1') === null);

const B = (o: Partial<Budget> = {}): Budget => ({ offer_net: 48000, produce: { material: 14200, glass: 6000, panels: 2000, painting: 1300, transport: 1500, customs: 900 }, labour_hours: 110, labour_rate: 45,
  trade_supplier: 'Eko-okna', trade_purchase: 31500, trade_transport: 2600, trade_other: 500, note: null, decision: 'undecided', ...o });

ok('undecided / rejected: nothing goes to the order', orderCostsFromBudget(B()) === null && orderCostsFromBudget(B({ decision: 'rejected' })) === null);
const pr = orderCostsFromBudget(B({ decision: 'produce' }));
// produce: 14200+6000+2000+1300+1500+900 + 110×45 = 30850; transport 1500 is the delivery
ok('produce: Acemark PL, cost without transport, transport as delivery', pr?.supplier === 'Acemark PL' && pr?.cost_purchase === 29350 && pr?.cost_delivery === 1500, pr);
const tr = orderCostsFromBudget(B({ decision: 'trade' }));
ok('trade: the vendor, purchase + other, transport as delivery', tr?.supplier === 'Eko-okna' && tr?.cost_purchase === 32000 && tr?.cost_delivery === 2600, tr);
ok('trade without a vendor name keeps the order\'s supplier (null)', orderCostsFromBudget(B({ decision: 'trade', trade_supplier: null }))?.supplier === null);

const v = orderJobView({ id: 'j', reference: 'Z.453', locked: false }, B({ decision: 'produce' }));
ok('job view: decision, both scenarios and the better one', v.decision === 'produce' && v.produce?.costs === 30850 && v.trade?.costs === 34600 && v.better === 'produce' && v.advantage === 3750, v);
ok('job view without a budget', orderJobView({ id: 'j', reference: 'Z.1', locked: true }, undefined).decision === 'none');

// order → job: the rep's vendor quote becomes the trade scenario
ok('a vendor quote on the order → trade side', JSON.stringify(tradeFromOrder({ supplier: 'Eko-okna', cost_purchase: 31500, cost_delivery: 2600 })) === JSON.stringify({ trade_supplier: 'Eko-okna', trade_purchase: 31500, trade_transport: 2600 }));
ok('no vendor, Acemark PL (produced) or no price → nothing', tradeFromOrder({ supplier: null, cost_purchase: 100, cost_delivery: null }) === null && tradeFromOrder({ supplier: 'Acemark PL', cost_purchase: 100, cost_delivery: null }) === null && tradeFromOrder({ supplier: 'Eko-okna', cost_purchase: 0, cost_delivery: null }) === null);
ok('no delivery cost → transport left empty', tradeFromOrder({ supplier: 'Profal', cost_purchase: 900, cost_delivery: 0 })?.trade_transport === null);
ok('monday item link; none without an id', mondayItemUrl('3576361679', '12345') === 'https://ace189144.monday.com/boards/3576361679/pulses/12345' && mondayItemUrl('3576361679', null) === null && mondayItemUrl('3576361679', 'x1') === null);

if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log('orderJobLink ok');
