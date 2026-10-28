// Run: npx tsx apps/api/src/wemTasks.test.ts
import { parseCatalog, qtyRuleOf, orderFields, planTasks } from './wemTasks';
import { WEM_CATALOG_CSV } from './wemCatalogSeed';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// The catalogue file
const cat = parseCatalog(WEM_CATALOG_CSV);
ok('catalogue: all 89 codes read', cat.length === 89, cat.length);
const by = (c: string) => cat.find((r) => r.code === c)!;
ok('catalogue: rules from "Ilość planowana" and "Materiał"', by('SAS-SKR-ST01').qty_rule === 'sash' && by('SAS-SKR-ST01').timber_only && !by('SAS-SKR-ST03').timber_only && by('SAS-BOX-SB01').qty_rule === 'product'
  && by('DOD-HRN-01').qty_rule === 'horns' && by('DOD-NAW-02').qty_rule === 'vents' && by('DOD-RES-01').qty_rule === 'restrictors' && by('OGL-PRZ-01').qty_rule === 'none' && by('OGL-PRZ-01').product === null);
ok('catalogue: names and workstation kept', by('SAS-SKR-ST05').activity === 'czopowanie' && by('SAS-SKR-ST05').station === 'Czopiarka' && by('SAS-SKR-ST05').unit === 'szt. skrzydła' && by('SAS-SKR-ST05').department === 'Stolarnia');
ok('rule text', qtyRuleOf('× ilość × skrzydeł/szt.') === 'sash' && qtyRuleOf('× ilość') === 'product' && qtyRuleOf('nie planowany') === 'none');
ok('catalogue: a file without the code column gives nothing', parseCatalog('a;b\n1;2').length === 0);

// The workbook's example order WEM-2026-001
const f = orderFields({ order_ref: ' WEM-2026-001 ', client: 'X', positions: [
  { pos: '1', product: 'sash', qty: '4', sashes: '2', material: 'kantówka', horns: '2', vents: '1', restrictors: '2', size: '900×1600' },
  { pos: '2', product: 'Casement', qty: '3', sashes: '', material: 'tarcica', vents: '1' },
  { pos: '3', product: 'Drzwi', qty: '1' },
  { product: '', qty: '' },
] });
ok('order: cleaned, defaults filled, empty rows dropped', f.ok && f.order_ref === 'WEM-2026-001' && f.positions.length === 3 && f.positions[0].product === 'Sash' && f.positions[1].sashes === 1 && f.positions[2].material === 'kantówka' && f.positions[2].horns === 0, f);
ok('order: needs a number, a product and whole quantities', !orderFields({ positions: [{ product: 'Sash', qty: 1 }] }).ok && !orderFields({ order_ref: 'A', positions: [{ product: 'Okno', qty: 1 }] }).ok
  && !orderFields({ order_ref: 'A', positions: [{ product: 'Sash', qty: '1,5' }] }).ok && !orderFields({ order_ref: 'A', positions: [] }).ok && !orderFields({ order_ref: 'A', positions: [{ pos: '1', product: 'Sash', qty: 1 }, { pos: '1', product: 'Drzwi', qty: 1 }] }).ok);
if (f.ok) {
  const t = planTasks(f.order_ref, f.positions, cat), q = (code: string, pos: string) => t.find((x) => x.code === code && x.position === pos);
  // the workbook's "Import do aplikacji" sheet has 85 task rows for this order
  ok('plan: 85 tasks, as in the workbook', t.length === 85, t.length);
  ok('plan: kantówka skips ST01/ST02, tarcica keeps them', !q('SAS-SKR-ST01', '1') && !q('SAS-SKR-ST02', '1') && !!q('CAS-RAM-ST01', '2') && !!q('CAS-SKR-ST02', '2') && !q('DRZ-RAM-ST01', '3'));
  ok('plan: sash rows × sashes, others × quantity', q('SAS-SKR-ST05', '1')?.planned_qty === 8 && q('SAS-BOX-SB01', '1')?.planned_qty === 4 && q('SAS-KPL-SK13', '1')?.planned_qty === 4 && q('CAS-SKR-ST05', '2')?.planned_qty === 3);
  ok('plan: add-ons per unit, none at 0', q('DOD-HRN-01', '1')?.planned_qty === 8 && q('DOD-NAW-01', '1')?.planned_qty === 4 && q('DOD-NAW-02', '2')?.planned_qty === 3 && q('DOD-RES-01', '1')?.planned_qty === 8 && !q('DOD-HRN-01', '2') && !q('DOD-NAW-01', '3'));
  ok('plan: downtime and other once, at the end', t[t.length - 2].code === 'OGL-PRZ-01' && t[t.length - 1].code === 'OGL-INN-01' && t[t.length - 1].position === '' && t[t.length - 1].planned_qty === null);
  const s = q('SAS-SKR-ST05', '1')!;
  ok('plan: names for the phone and the export', s.name === 'Poz. 1 · SAS-SKR-ST05 · Sash | Skrzydło sash | czopowanie' && s.export_name === 'WEM-2026-001_1_SAS-SKR-ST05' && s.station === 'Czopiarka' && t[t.length - 1].export_name === 'WEM-2026-001_OGL-INN-01', s);
  ok('plan: a switched-off code is left out', planTasks('A', f.positions, cat.map((r) => (r.code === 'SAS-SKR-ST05' ? { ...r, active: false } : r))).every((x) => x.code !== 'SAS-SKR-ST05'));
}

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('All WEM task tests passed.');
