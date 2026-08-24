// Customer pricing engine (budget module). Pure + deterministic so it can be unit-tested
// and run identically on the server. Money is in INTEGER pennies throughout.
//
// Model 'axs_flat_v1' (the first customer formula):
//   COST (our budget, not fitter pay), per item:
//     window: (frame/m² + glass/m²) × m²  +  window rip-out labour/unit
//     door:    frame/unit + glass/unit    +  door rip-out labour/unit
//   SALE (what the customer pays), grouped per flat:
//     • base rate per flat, which INCLUDES the N smallest windows in that flat
//     • windows beyond N (the biggest) bill at rate_per_m² on their m²
//     • communal windows (flat label starts "COMM") bill at rate_per_m², no base
//     • doors bill a flat rate per door, outside the flat/window calc
//     • snags are excluded; variations are a manual agreed amount, summed separately

export interface RuleMaterial { window_frame_per_m2: number; window_glass_per_m2: number; door_frame_per_unit: number; door_glass_per_unit: number }
export interface RuleLabour { window_per_unit: number; door_per_unit: number }
export interface RuleSale { rate_per_flat: number; rate_per_door: number; rate_per_m2_extra: number; windows_included_per_flat: number }
export interface RuleParams { material: RuleMaterial; labour: RuleLabour; sale: RuleSale }
export interface PricingRule { id?: string; name?: string; model?: string; params: RuleParams }

export interface PriceItem {
  id?: string;
  full_code?: string | null;
  kind?: string | null;                 // 'item' | 'snag'
  category: 'window' | 'door';
  width_mm?: number | null;
  height_mm?: number | null;
  m2?: number;                          // optional override; else derived from dims
  flat?: string | null;                 // location label; "COMM*" => communal
  is_variation?: boolean;
  variation_amount?: number | null;     // pennies (manual)
}

export const m2Of = (w?: number | null, h?: number | null): number => (w && h ? (w * h) / 1_000_000 : 0);
export const isCommunalFlat = (flat?: string | null): boolean => /^comm/i.test((flat ?? '').trim());
// Classify an item as window vs door from its type/code (single-door model for now).
export function classifyCategory(o: { item_type?: string | null; item_code?: string | null }): 'window' | 'door' {
  if ((o.item_type ?? '').toLowerCase().includes('door')) return 'door';
  if ((o.item_code ?? '').trim().toUpperCase().startsWith('D')) return 'door';
  return 'window';
}

const round = Math.round;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function itemCost(it: PriceItem, rule: PricingRule): number {
  const p = rule.params;
  if (it.category === 'door') return p.material.door_frame_per_unit + p.material.door_glass_per_unit + p.labour.door_per_unit;
  const m2 = it.m2 ?? m2Of(it.width_mm, it.height_mm);
  return round((p.material.window_frame_per_m2 + p.material.window_glass_per_m2) * m2) + p.labour.window_per_unit;
}

export interface FlatBreak { flat: string; windows: number; base: number; extraWindows: number; extraM2: number; extraAmount: number; total: number }
export interface JobBreak {
  flats: FlatBreak[];
  communal: { windows: number; m2: number; amount: number };
  doors: { count: number; amount: number };
  variations: { id?: string; code?: string | null; amount: number }[];
  variationsTotal: number;
  saleTotal: number;
  costTotal: number;
  margin: number;
}

export function priceJob(items: PriceItem[], rule: PricingRule): JobBreak {
  const sale = rule.params.sale;
  const live = items.filter((i) => (i.kind ?? 'item') !== 'snag');

  // Variations — manual agreed amount, their own line (still costed for margin).
  const variations = live.filter((i) => i.is_variation).map((i) => ({ id: i.id, code: i.full_code ?? null, amount: i.variation_amount ?? 0 }));
  const variationsTotal = variations.reduce((s, v) => s + (v.amount || 0), 0);

  const base = live.filter((i) => !i.is_variation);

  // Doors — flat rate each, regardless of flat/communal.
  const doorsList = base.filter((i) => i.category === 'door');
  const doors = { count: doorsList.length, amount: doorsList.length * sale.rate_per_door };

  // Windows — split communal vs per-flat.
  const windows = base.filter((i) => i.category === 'window').map((i) => ({ it: i, m2: i.m2 ?? m2Of(i.width_mm, i.height_mm) }));
  const communalW = windows.filter((w) => isCommunalFlat(w.it.flat));
  const communalM2 = communalW.reduce((s, w) => s + w.m2, 0);
  const communal = { windows: communalW.length, m2: round2(communalM2), amount: round(communalM2 * sale.rate_per_m2_extra) };

  const groups: Record<string, { m2: number }[]> = {};
  for (const w of windows) {
    if (isCommunalFlat(w.it.flat)) continue;
    const key = (w.it.flat ?? '').trim() || '(no flat)';
    (groups[key] = groups[key] || []).push({ m2: w.m2 });
  }
  const flats: FlatBreak[] = Object.keys(groups).sort().map((flat) => {
    const g = groups[flat];
    const count = g.length;
    let extraWindows = 0, extraM2 = 0, extraAmount = 0;
    if (count > sale.windows_included_per_flat) {
      const biggest = g.slice().sort((a, b) => a.m2 - b.m2).slice(sale.windows_included_per_flat); // include N smallest
      extraWindows = biggest.length;
      extraM2 = biggest.reduce((s, w) => s + w.m2, 0);
      extraAmount = round(extraM2 * sale.rate_per_m2_extra);
    }
    return { flat, windows: count, base: sale.rate_per_flat, extraWindows, extraM2: round2(extraM2), extraAmount, total: sale.rate_per_flat + extraAmount };
  });

  const flatsTotal = flats.reduce((s, f) => s + f.total, 0);
  const saleTotal = flatsTotal + communal.amount + doors.amount + variationsTotal;
  const costTotal = live.reduce((s, i) => s + itemCost(i, rule), 0);
  return { flats, communal, doors, variations, variationsTotal, saleTotal, costTotal, margin: saleTotal - costTotal };
}
