// Worked-example tests for the AXS.LAB pricing model. Run: npx tsx packages/shared/src/pricing.test.ts
import { priceJob, itemCost, isCommunalFlat, classifyCategory, type PricingRule, type PriceItem } from './pricing';

const RULE: PricingRule = {
  model: 'axs_flat_v1',
  params: {
    material: { window_frame_per_m2: 13000, window_glass_per_m2: 3000, door_frame_per_unit: 34000, door_glass_per_unit: 3000 },
    labour: { window_per_unit: 8000, door_per_unit: 12000 },
    sale: { rate_per_flat: 315900, rate_per_door: 135000, rate_per_m2_extra: 32400, windows_included_per_flat: 5 },
  },
};

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`✗ ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`✓ ${label} = ${JSON.stringify(got)}`);
}

// helpers to build items
const win = (flat: string, wmm: number, hmm: number, extra: Partial<PriceItem> = {}): PriceItem =>
  ({ category: 'window', flat, width_mm: wmm, height_mm: hmm, ...extra });
const door = (flat: string, extra: Partial<PriceItem> = {}): PriceItem =>
  ({ category: 'door', flat, ...extra });

// --- unit helpers ---
eq('isCommunalFlat COMMS', isCommunalFlat('COMMS'), true);
eq('isCommunalFlat Commons', isCommunalFlat('Commons'), true);
eq('isCommunalFlat 21', isCommunalFlat('21'), false);
eq('classify door by type', classifyCategory({ item_type: 'Single Door' }), 'door');
eq('classify door by code', classifyCategory({ item_code: 'D01' }), 'door');
eq('classify window', classifyCategory({ item_type: 'Window', item_code: 'W01' }), 'window');

// --- item cost ---
eq('window cost 1m²', itemCost(win('21', 1000, 1000), RULE), 24000);      // 16000*1 + 8000
eq('window cost 3m²', itemCost(win('21', 3000, 1000), RULE), 56000);      // 16000*3 + 8000
eq('door cost', itemCost(door('21'), RULE), 49000);                        // 34000+3000+12000

// --- full job (the worked example) ---
const items: PriceItem[] = [
  // Flat 21: 5 windows @ 1m², plus a door
  win('21', 1000, 1000), win('21', 1000, 1000), win('21', 1000, 1000), win('21', 1000, 1000), win('21', 1000, 1000),
  door('21'),
  // Flat 22: 7 windows -> m² [1,1,1,1,1,2,3]; 5 smallest included, biggest two (2+3) billed
  win('22', 1000, 1000), win('22', 1000, 1000), win('22', 1000, 1000), win('22', 1000, 1000), win('22', 1000, 1000),
  win('22', 2000, 1000), win('22', 3000, 1000),
  // Communal window 4m²
  win('COMMS', 2000, 2000),
  // A variation door, manual £500
  door('X', { is_variation: true, variation_amount: 50000, full_code: 'AXS.LAB.V1' }),
  // A snag window (excluded entirely)
  win('21', 1000, 1000, { kind: 'snag' }),
];

const b = priceJob(items, RULE);

eq('flat21 total', b.flats.find((f) => f.flat === '21')!.total, 315900);            // base only
const f22 = b.flats.find((f) => f.flat === '22')!;
eq('flat22 extraWindows', f22.extraWindows, 2);
eq('flat22 extraM2', f22.extraM2, 5);
eq('flat22 extraAmount', f22.extraAmount, 162000);                                   // 5 * 32400
eq('flat22 total', f22.total, 477900);                                               // 315900 + 162000
eq('communal', b.communal, { windows: 1, m2: 4, amount: 129600 });                   // 4 * 32400
eq('doors', b.doors, { count: 1, amount: 135000 });                                  // variation door excluded
eq('variationsTotal', b.variationsTotal, 50000);
eq('saleTotal', b.saleTotal, 1108400);   // 315900 + 477900 + 129600 + 135000 + 50000
eq('costTotal', b.costTotal, 506000);    // 120000 + 49000 + 216000 + 72000 + 49000
eq('margin', b.margin, 602400);

if (failures) { console.error(`\n${failures} FAIL`); process.exit(1); }
console.log('\nAll pricing tests passed.');
