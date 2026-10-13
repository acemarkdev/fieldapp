// Run: npx tsx apps/api/src/subiekt.test.ts   (the examples are real subtitles from the Subiekt database)
import { zNumbers, okCode, classifyDoc, toPln, saleRow, planSales, planMaterial, docsToCheck, docFromAgent, countryCode, type SubDoc } from './subiekt';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
let seq = 100;
const doc = (symbol: string, subtitle: string | null, notes: string | null, net: number, o: Partial<SubDoc> = {}): SubDoc => ({ doc_id: ++seq, symbol, number: `${symbol} ${seq}/ACE/10/2026`, issued: '2026-10-05', sold: null, net, gross: net, currency: 'złoty polski', rate: null, units: null, subtitle, notes, flag: null, corrects: null, customer: 'PCW', country: 'Wielka Brytania', ...o });

// Reading numbers
ok('Z numbers', zNumbers('Z.414').join() === 'Z.414' && zNumbers('Z.413, Z.415, Z.414').join() === 'Z.413,Z.415,Z.414' && zNumbers('Z.339/Z.375').join() === 'Z.339,Z.375' && zNumbers('z 414 ').join() === 'Z.414' && zNumbers('Z.428 ').join() === 'Z.428');
ok('not Z numbers', !zNumbers('ZMAL/26/0021497 02/06/2026').length && !zNumbers('BN1 3RJ - 12.05.26').length && !zNumbers('WEB/26/0934496').length && !zNumbers('PO-AG26-0466').length && !zNumbers('J.Sz.').length);
ok('OK order numbers anywhere in the text', okCode('OK DE203065 -Mülheim an der Ruhr- Agnieszka und Tiago Update 1') === 'OK DE203065' && okCode('Pedro - OK PL203055 - Miss Tsveta Damyanova No 1') === 'OK PL203055' && okCode('Ok DE202885-BV Bollendonk Fenster') === 'OK DE202885' && okCode('OK DEPL202857 -Hasselbach') === 'OK DEPL202857' && okCode('OK DE202844- Idris Nawid,') === 'OK DE202844');
ok('no OK number', okCode('Prowizja - wrzesień 2026 J.Sz.') === null && okCode('EQ - L2025 12462 - 3Sphere - 80 Buckingham Road') === null && okCode('Kasaja pojazdu Seat Ibiza') === null && okCode('Tokyo 12345') === null);

// Which job
const c = (d: SubDoc, by?: Map<number, SubDoc>) => { const r = classifyDoc(d, by); return (r.job_ref ?? '-') + '|' + (r.check ?? 'ok') + '|' + (r.from ?? '-'); };
ok('subtitle is the job', c(doc('FL', 'Z.414 ', 'Z.414 - OK DEUK202972-PCW-J034815P Corvision', 9482.99)) === 'Z.414|ok|subtitle');
ok('a subtitle with extra words is a record of its own', c(doc('FS', 'Z.282 poprawka', null, 13000)) === 'Z.282 poprawka|ok|subtitle' && c(doc('FS', 'Z.290 - poprawka', null, 2100)) === 'Z.290 poprawka|ok|subtitle' && c(doc('RW', 'Z.288 Reklamacja', null, 938.88)) === 'Z.288 Reklamacja|ok|subtitle');
ok('several jobs on one document are not guessed', c(doc('PW', 'Z.413, Z.415, Z.414', 'Zwrot odpadów', 1828.85, { symbol: 'RW' })) === '-|several_jobs|-' && c(doc('RW', 'Z.339/Z.375', null, 708.86)) === '-|several_jobs|-');
ok('the notes are the fallback', c(doc('FS', null, 'Z.414', 100)) === 'Z.414|ok|notes' && c(doc('FL', 'EQ - L2025 12462', 'Z.409 - EQ - L2025 12462 -3Sphere', 39375.7)) === 'Z.409|ok|notes');
ok('a trade invoice goes to its OK order', c(doc('FL', 'OK DE203065 -Mülheim an der Ruhr- Agnieszka und Tiago', 'OK DE203065 … Update 1', 6410.45)) === 'OK DE203065|ok|order' && c(doc('FL', 'Pedro - OK PL203055 - Miss Tsveta Damyanova No 1 akt. 23092026', null, 5674.01)) === 'OK PL203055|ok|order');
ok('a Z number wins over an OK number', c(doc('FL', 'Z.442', 'Z.442 - OK PL203119 -PCW- J034979P', 10595.11)) === 'Z.442|ok|subtitle');
ok('an OK number does not attach a material issue', c(doc('RW', 'OK DE203065', null, 50)) === '-|no_number|-');
ok('no number → to check', c(doc('FS', 'J.Sz. ', 'Prowizja - wrzesień 2026 J.Sz. ', 13560)) === '-|no_number|-' && c(doc('FS', ' EQ - L2025 12462 - 3Sphere - 80 Buckingham Road, Brighton, BN1 3RJ ', null, 152006.26)) === '-|no_number|-' && c(doc('FL', 'WEB/26/0934496 20/07/2026', 'WEB/26/0934496 20/07/2026', 7501.71)) === '-|no_number|-' && c(doc('RW', null, null, 37.44)) === '-|no_number|-');
const orig = doc('FL', 'Z.381', null, 68640), corr = doc('KFL', null, 'korekta', -68640, { corrects: orig.doc_id });
ok('a correction without a number takes the job of its invoice', c(corr, new Map([[orig.doc_id, orig]])) === 'Z.381|ok|corrected' && c(corr) === '-|no_number|-');

// Money
const eur = { currency: 'euro', rate: 4.2650, units: 1 };
ok('PLN stays, EUR × the document rate, no rate → unknown', toPln(9482.99, { currency: 'złoty polski', rate: null, units: null }) === 9482.99 && toPln(6410.45, eur) === 27340.57 && toPln(100, { currency: 'euro', rate: null, units: null }) === null && toPln(1000, { currency: 'jen', rate: 2.6, units: 100 }) === 26, toPln(6410.45, eur));
ok('country codes', countryCode('Wielka Brytania') === 'UK' && countryCode('Niemcy') === 'DE' && countryCode('DE') === 'DE' && countryCode('GB') === 'UK' && countryCode('Atlantyda') === null && countryCode(null) === null);

// The Sales-tab row
const fl1 = doc('FL', 'Z.414 ', 'Z.414 - OK DEUK202972-PCW', 9482.99, { flag: 2, issued: '2026-07-31', number: 'FL 26/ACE/07/2026' });
const fl2 = doc('FL', 'Z.414', 'Z.414 - OK DEUK202972-PCW', 9482.96, { flag: 3, issued: '2026-09-11', number: 'FL 7/ACE/09/2026' });
const r1 = saleRow(fl1, classifyDoc(fl1)), r2 = saleRow(fl2, classifyDoc(fl2));
ok('Z.414: advance then closing invoice, production, month from the date', r1.kind === 'prepaid' && r2.kind === 'final' && r1.job_ref === 'Z.414' && r1.producer === 'Acemark PL' && r1.period_year === 2026 && r1.period_month === 7 && r2.period_month === 9 && r1.country === 'UK' && r1.needs_check === null && r1.source === 'subiekt', [r1, r2]);
ok('Z.414 adds up to the sheet (18 965,95)', Math.round((r1.net + r2.net) * 100) === 1896595);
const tr = doc('FL', 'OK DE203065 -Mülheim-', null, 6410.45, { ...eur, gross: 7628.43, flag: 2, country: 'Niemcy' });
const rt = saleRow(tr, classifyDoc(tr), (ref) => (ref === 'OK DE203065' ? 'EKO_OKNA' : null));
ok('trade invoice in EUR: PLN amounts, producer from the order, EUR kept in the note', rt.net === 27340.57 && rt.gross === 32535.25 && rt.producer === 'EKO_OKNA' && rt.job_ref === 'OK DE203065' && /euro: 6410.45 net, rate 4.265/.test(rt.note) && rt.country === 'DE', rt);
const pr = doc('FS', 'J.Sz. ', 'Prowizja - wrzesień 2026 J.Sz. ', 13560);
ok('no number: still a sales row, marked, subtitle kept in the note', saleRow(pr, classifyDoc(pr)).needs_check === 'no_number' && saleRow(pr, classifyDoc(pr)).job_ref === null && saleRow(pr, classifyDoc(pr)).note === 'J.Sz.');
ok('"not a job" clears the mark', saleRow({ ...pr, not_job: true }, classifyDoc(pr)).needs_check === null);
ok('a foreign invoice without a rate is marked and counts as 0', saleRow({ ...tr, rate: null }, classifyDoc(tr)).needs_check === 'no_rate' && saleRow({ ...tr, rate: null }, classifyDoc(tr)).net === 0);

// Sales plan
const typedRow = { id: 'T1', invoice_no: 'fl 26/ace/07/2026', net: 9482.99, job_ref: 'Z.414', source: null };
const p1 = planSales([fl1, fl2, pr], [typedRow, { id: 'T2', invoice_no: 'FS 99/OLD', net: 5, source: null }]);
ok('a typed invoice with the same number is taken over, the rest are added, other typed rows stay', p1.update.length === 1 && p1.update[0].id === 'T1' && p1.update[0].adopted && p1.insert.length === 2 && !p1.remove.length, p1);
const stored = [{ id: 'S1', ...r1 }, { id: 'S2', ...r2 }, { id: 'S9', ...r2, source_id: 99999, invoice_no: 'FL gone' }];
const p2 = planSales([fl1, { ...fl2, net: 9500 }], stored);
ok('second sync: unchanged rows untouched, a changed amount updates, a document deleted in Subiekt is removed', !p2.insert.length && p2.update.length === 1 && p2.update[0].id === 'S2' && !p2.update[0].adopted && p2.update[0].fields.net === 9500 && p2.remove.join() === 'S9', p2);
ok('a number added in Subiekt moves the invoice on the next sync', planSales([{ ...pr, subtitle: 'Z.409' }], [{ id: 'S5', ...saleRow(pr, classifyDoc(pr)) }]).update[0]?.fields.job_ref === 'Z.409');
ok('RW documents never become sales rows', !planSales([doc('RW', 'Z.414', null, 9376.71)], []).insert.length);

// Material plan
const rw = doc('RW', 'Z.414', null, 9376.71, { issued: '2026-09-18', number: 'RW 3/PROD/09/2026' });
const jobs = [{ id: 'J414', reference_key: 'Z.414', locked: false }, { id: 'J500', reference_key: 'Z.500', locked: true }];
const typedMat = { id: 'I1', job_id: 'J414', kind: 'material', source: null, source_id: null, amount: 9000, invoice_no: null, item_date: null };
const other = { id: 'I2', job_id: 'J414', kind: 'transport', source: null, source_id: null, amount: 2611.05, invoice_no: null, item_date: null };
const m1 = planMaterial([fl1, fl2, rw], jobs, [typedMat, other]);
ok('RW replaces the typed material and leaves other costs', m1.remove.join() === 'I1' && m1.typedReplaced === 1 && m1.upsert.length === 1 && m1.upsert[0].id === null && m1.upsert[0].fields.amount === 9376.71 && m1.upsert[0].fields.invoice_no === 'RW 3/PROD/09/2026' && !m1.createJobs.length, m1);
const srcItem = { id: 'I3', job_id: 'J414', kind: 'material', source: 'subiekt', source_id: rw.doc_id, amount: 9376.71, invoice_no: 'RW 3/PROD/09/2026', item_date: '2026-09-18' };
ok('second sync changes nothing', (() => { const m = planMaterial([rw], jobs, [srcItem, other]); return !m.remove.length && !m.upsert.length; })());
ok('a changed RW amount updates its line', planMaterial([{ ...rw, net: 9400 }], jobs, [srcItem]).upsert[0]?.id === 'I3');
ok('an RW deleted in Subiekt (or its number removed) takes its line away', planMaterial([], jobs, [srcItem]).remove.join() === 'I3' && planMaterial([{ ...rw, subtitle: null }], jobs, [srcItem]).remove.join() === 'I3');
const newJob = planMaterial([doc('RW', 'Z.600', null, 500, { issued: '2026-10-07' }), doc('FL', 'Z.600', null, 2000, { issued: '2026-09-02', customer: 'Sternbau' })], jobs, []);
ok('a job missing in Job costs is created with the month of its first sales invoice', newJob.createJobs.length === 1 && newJob.createJobs[0].reference === 'Z.600' && newJob.createJobs[0].period_month === 9 && newJob.createJobs[0].customer === 'Sternbau' && newJob.upsert.length === 1, newJob);
ok('…or of its first RW when it has no invoice yet', planMaterial([doc('RW', 'Z.601', null, 500, { issued: '2026-10-07' })], jobs, []).createJobs[0].period_month === 10);
const lk = planMaterial([doc('RW', 'Z.500', null, 700)], jobs, [{ id: 'I9', job_id: 'J500', kind: 'material', source: null, source_id: null, amount: 1, invoice_no: null, item_date: null }]);
ok('a locked job is never changed', !lk.remove.length && !lk.upsert.length && lk.lockedSkipped.join() === 'Z.500', lk);
ok('RW without a clear job, or for an OK order, changes nothing in Job costs', (() => { const m = planMaterial([doc('RW', 'Z.413, Z.415, Z.414', null, 100), doc('RW', null, null, 37.44)], jobs, [typedMat]); return !m.remove.length && !m.upsert.length && !m.createJobs.length; })());
ok('sales alone do not create a job or touch material', (() => { const m = planMaterial([fl1], jobs, [typedMat]); return !m.remove.length && !m.upsert.length && !m.createJobs.length; })());

// The list to fix
const list = docsToCheck([fl1, pr, { ...pr, doc_id: 7001, not_job: true }, doc('RW', 'Z.339/Z.375', null, 708.86), { ...tr, doc_id: 7002, rate: null }]);
ok('to check: no number, several jobs, missing rate — not the ticked one, not the clear ones', list.map((x) => x.reason).sort().join() === 'no_number,no_rate,several_jobs', list.map((x) => x.reason));

// The agent's payload
ok('agent row is cleaned', (() => { const d = docFromAgent({ id: 55, symbol: 'fl', number: ' FL 1/ACE/10/2026 ', issued: '2026-10-09T00:00:00', net: '6410.450000', gross: 7628.43, currency: 'euro', rate: '4.265000', units: 1, subtitle: '  OK DE203065  -Mülheim ', flag: 3 }); return !!d && d.symbol === 'FL' && d.issued === '2026-10-09' && d.net === 6410.45 && d.rate === 4.265 && d.subtitle === 'OK DE203065 -Mülheim' && d.corrects === null; })());
ok('unknown document types and broken rows are dropped', docFromAgent({ id: 1, symbol: 'FZ' }) === null && docFromAgent({ id: 'x', symbol: 'FS' }) === null && docFromAgent(null) === null);

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('subiekt: all passed');
