// Run: npx tsx apps/api/src/finCustomers.test.ts
import { splitOrderRef, buildOrderRef, floorFrom, countryCode, customerFields, deliveryFields, customerLabel } from './finCustomers';
import { orderCode } from './finOrders';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// The order number
ok('split: country, number and the text', JSON.stringify(splitOrderRef('OK DE203065 -Mülheim an der Ruhr- Agnieszka')) === JSON.stringify({ cc: 'DE', n: 203065, text: 'Mülheim an der Ruhr- Agnieszka' }), splitOrderRef('OK DE203065 -Mülheim an der Ruhr- Agnieszka'));
ok('split: no text, odd spacing', splitOrderRef('ok_pl 203173')?.n === 203173 && splitOrderRef('OK PL203173')?.text === '');
ok('split: other formats are not numbers of this kind', splitOrderRef('OK DEUK20250819- 66 Nordfield') === null && splitOrderRef('OK 1240 V1') === null && splitOrderRef('Z.330') === null && splitOrderRef('OK DE2030651') === null);
ok('build: matches the invoice code', buildOrderRef('DE', 203066, ' Mülheim  - Krüger ') === 'OK DE203066 - Mülheim - Krüger' && orderCode(buildOrderRef('DE', 203066, 'x')) === 'OK DE203066' && buildOrderRef('UK', 203067, '') === 'OK UK203067');
ok('floor: one above the highest six-digit number', floorFrom(['OK DE203065 - a', 'OK PL203186', 'OK DEUK20250819', 'Z.330', null]) === 203187 && floorFrom([]) === 1);

// Countries
ok('country: GB is written UK, names work, junk is refused', countryCode('gb') === 'UK' && countryCode('Germany') === 'DE' && countryCode('pl') === 'PL' && countryCode('Deutschland') === null && countryCode('') === null);

// Customer form
const c = customerFields({ name1: ' Krüger  GmbH ', name2: 'Bau', city: 'Mülheim', postal_code: '45468', country: 'DE', email: 'a@b.de', phone: '+49 1' });
ok('customer: cleaned fields', c.ok && c.fields.name1 === 'Krüger GmbH' && c.fields.country === 'DE' && c.fields.street === null && customerLabel(c.fields) === 'Krüger GmbH Bau', c);
ok('customer: name needed, e-mail and country checked', !customerFields({ name1: ' ' }).ok && !customerFields({ name1: 'A', email: 'nope' }).ok && !customerFields({ name1: 'A', country: 'Germanyy' }).ok);

// Delivery address
ok('delivery: same as the customer → null', (() => { const d = deliveryFields({ same: true }); return d.ok && d.address === null; })() && (() => { const d = deliveryFields(undefined); return d.ok && d.address === null; })());
ok('delivery: its own address', (() => { const d = deliveryFields({ same: false, street: 'Hauptstr. 1', city: 'Essen', country: 'de' }); return d.ok && d.address?.city === 'Essen' && d.address?.country === 'DE'; })());
ok('delivery: unticked but empty is refused', !deliveryFields({ same: false, name: 'X' }).ok);

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('All customer / order-number tests passed.');
