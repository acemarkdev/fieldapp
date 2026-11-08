// Logistics ▸ Shipments: form checks, totals, the papers still missing, lines from a production list, the PDF.
import { shipDay, num, suggestName, invoiceText, totals, missingDocs, shipmentFields, lineFields, linesFromSpec, buildPackingListPdf, COMPANIES, type Shipment, type ShipLine } from './shipments';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (cond) console.log('✓ ' + name); else { fail++; console.log('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

ok('dates: dd.mm.yyyy, dd-mm-yy and ISO', shipDay('06.11.2026') === '2026-11-06' && shipDay('6-11-26') === '2026-11-06' && shipDay('2026-11-06') === '2026-11-06');
ok('dates: empty → null, nonsense or 31.02 → refused', shipDay('') === null && shipDay('jutro') === undefined && shipDay('31.02.2026') === undefined);
ok('kg: comma decimals and spaces; negative refused', num('17,5') === 17.5 && num('1 200.5 kg') === 1200.5 && num('') === null && num('-3') === undefined);
ok('name: "UK PCW 06.11.2026"', suggestName('pcw', '2026-11-06') === 'UK PCW 06.11.2026');
ok('invoice line as on the packing list', invoiceText('FL 7/ACE/11/2026', '2026-11-06') === 'FL 7/ACE/11/2026 z dnia 06.11.2026');
ok('totals add the weights', JSON.stringify(totals([{ net_kg: 17, gross_kg: 18 }, { net_kg: 17.5, gross_kg: 18.5 }, { net_kg: null, gross_kg: null }])) === JSON.stringify({ net: 34.5, gross: 36.5, lines: 3 }));
ok('missing papers only once it has left', missingDocs({ status: 'new' }, []).length === 0 && missingDocs({ status: 'sent' }, ['cmr']).join() === 'CC599' && missingDocs({ status: 'sent_no_docs' }, ['cmr', 'cc599']).length === 0);

const f = shipmentFields({ name: ' UK PCW 06.11.2026 ', company: 'wem', ship_date: '06.11.2026', importer: 'Perfect Crystal Windows Limited\n  1 Cumberland Avenue \n\n', status: 'sent' });
ok('shipment form: company defaults (seller, place of loading) and tidy addresses', f.ok && f.fields.seller === COMPANIES.wem.seller && f.fields.ship_from === COMPANIES.wem.ship_from && f.fields.importer === 'Perfect Crystal Windows Limited\n1 Cumberland Avenue' && f.fields.ship_date === '2026-11-06' && f.fields.status === 'sent', f);
ok('shipment form: a name is needed; a wrong date is refused', !shipmentFields({ name: '' }).ok && !shipmentFields({ name: 'X', ship_date: '45.13.2026' }).ok);
const l = lineFields({ description: 'Okno aluminiowe COR-70', qty: '1', net_kg: '17,5', gross_kg: '18,5', comment: 'Z.437' }, 0);
ok('line: weights read, unit defaults to Szt.', l.ok && l.fields.net_kg === 17.5 && l.fields.gross_kg === 18.5 && l.fields.unit === 'Szt.' && l.fields.qty === 1, l);
ok('line: an empty row is skipped, gross below net refused, no description refused', (lineFields({}, 0) as any).error === 'empty' && !lineFields({ description: 'A', net_kg: 20, gross_kg: 10 }, 0).ok && !lineFields({ qty: 2 }, 0).ok);
const fromSpec = linesFromSpec({ job: 'Z.437', order: 'OK PL203104', positions: [{ poz: 1, qty: 2, config: 'Okno aluminiowe COR-70 Industrial', w: 670, h: 1960, refs: ['W01'] }] });
ok('lines from a production list: description with size, comment with Z / order', fromSpec[0].description === 'Okno aluminiowe COR-70 Industrial (W670 mm x H1960 mm) W01' && fromSpec[0].comment === 'Z.437 - OK PL203104' && fromSpec[0].qty === 2, fromSpec);

(async () => {
  const s: Shipment = { id: 's1', company: 'acemark', name: 'UK PCW 06.11.2026', status: 'sent', ship_date: '2026-11-06', deliver_by: '2026-11-08', invoices: 'FL 7/ACE/11/2026 z dnia 06.11.2026\nFL 8/ACE/11/2026 z dnia 06.11.2026', importer: 'Perfect Crystal Windows Limited\n1 Cumberland Avenue Park Royal, NW10 7RX London\nVATIN: GB820211687', customer_id: null, delivery_address: '1 Cumberland Avenue, Park Royal, London NW10 7RX', carrier: 'UK-Transport Sp. z o.o.\nul. Sądowa 2/11, 20-027 Lublin\nNIP 7123424209', carrier_id: null, driver: 'Sebastian Marucha, Tel 605533191', plates: 'LU732RF / PP8398J', seller: COMPANIES.acemark.seller, ship_from: COMPANIES.acemark.ship_from, notes: 'Zażółć gęślą jaźń', monday_item_id: null, created_by_name: null, created_at: '', updated_at: '', sent_at: null };
  const ls: ShipLine[] = Array.from({ length: 40 }, (_, i) => ({ id: 'l' + i, shipment_id: 's1', pos: i, qty: 1, unit: 'Szt.', description: 'Okno aluminiowe COR-70 Industrial (W1125 mm x H1340 mm)', net_kg: 17.5, gross_kg: 18.5, comment: 'Z.437 - OK PL203104 - PCW - J034966P update 22092026', loaded: false }));
  // a 1×1 JPEG as the photo of line 0
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const a = await buildPackingListPdf({ shipment: s, lines: ls, withPhotos: false });
  const b = await buildPackingListPdf({ shipment: s, lines: ls, withPhotos: true, photos: new Map([['l0', jpg]]) });
  const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
  ok('packing list PDF builds, 40 lines run onto more pages', a.subarray(0, 5).toString() === '%PDF-' && pages(a) >= 2, pages(a));
  ok('with photos: taller rows → more pages', pages(b) >= pages(a), [pages(a), pages(b)]);
  const empty = await buildPackingListPdf({ shipment: s, lines: [], withPhotos: false });
  ok('an empty shipment still prints the form on one page', pages(empty) === 1, pages(empty));
  if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
  console.log('All shipment tests passed.');
})();
