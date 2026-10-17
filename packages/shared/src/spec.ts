// Specification parameters: the Emplas order-form fields and Building Regulations checks, each set
// at one of six levels and inherited downwards to the items. The most specific level wins:
//   6 Item  >  5 Room type (all kitchens in the job…)  >  4 Flat  >  3 Elevation  >  2 Job  >  1 Customer
// The catalogue of fields (which levels each one may be set at, and who fills it in) is generated
// from the Spec Matrix decisions into specCatalogue.ts.
import { SPEC_FIELDS, SPEC_HEADER, SPEC_REGS, SPEC_TYPE_FIELDS } from './specCatalogue';

export type SpecLevelKey = 'customer' | 'job' | 'elevation' | 'flat' | 'room' | 'item';
export type SpecWho = 'office' | 'mapper' | 'surveyor';
export type SpecKind = 'text' | 'number' | 'choice' | 'multi' | 'bool' | 'date';

export interface SpecFieldDef {
  label: string;
  hint?: string;
  reg?: string;               // regulation it comes from (Part F, Part L…)
  kind: SpecKind;
  options?: string[];
  unit?: string;
  column?: string;            // item-level value lives in this survey_items column
  merge?: 'concat';           // notes: every level's value is kept, top-down
  section: 'header' | 'regs' | 'form';
}
export interface SpecEntry { key: string; levels: number[]; who: SpecWho[]; decided: boolean; default?: string }

export const SPEC_LEVELS: { n: number; key: SpecLevelKey; label: string }[] = [
  { n: 1, key: 'customer', label: 'Customer' },
  { n: 2, key: 'job', label: 'Job' },
  { n: 3, key: 'elevation', label: 'Elevation' },
  { n: 4, key: 'flat', label: 'Flat' },
  { n: 5, key: 'room', label: 'Room type' },
  { n: 6, key: 'item', label: 'Item' },
];
export const SPEC_WHO_LABEL: Record<SpecWho, string> = { office: 'Office', mapper: 'Mapper', surveyor: 'Surveyor' };
export const levelNumber = (k: SpecLevelKey): number => SPEC_LEVELS.find((l) => l.key === k)!.n;
export const levelKey = (n: number): SpecLevelKey => SPEC_LEVELS.find((l) => l.n === n)!.key;
export const isSpecLevel = (k: unknown): k is SpecLevelKey => SPEC_LEVELS.some((l) => l.key === k);

/** Item types with an Emplas order form. "Window" stays as the legacy type of older items. */
export const ITEM_TYPES = ['Door', 'Casement', 'Flush Casement', 'Flush Casement Optima', 'Patio', 'Shaped', 'Bay'] as const;
export const LEGACY_ITEM_TYPES = ['Window'];
export const ALL_ITEM_TYPES: string[] = [...LEGACY_ITEM_TYPES, ...ITEM_TYPES];

/** The order-form type for a stored item_type ("flush casement" → "Flush Casement"), or null. */
export function specType(itemType: string | null | undefined): string | null {
  const t = String(itemType ?? '').trim().toLowerCase();
  return (ITEM_TYPES as readonly string[]).find((x) => x.toLowerCase() === t) ?? null;
}

export { SPEC_FIELDS, SPEC_HEADER, SPEC_REGS, SPEC_TYPE_FIELDS };

/** Regulations + the order-form fields of the item's type (header fields are per PO, not per item). */
export function specEntriesForType(itemType: string | null | undefined): SpecEntry[] {
  const t = specType(itemType);
  return [...SPEC_REGS, ...(t ? SPEC_TYPE_FIELDS[t] ?? [] : [])];
}

export interface SpecLevelField { key: string; def: SpecFieldDef; who: SpecWho[]; types: string[]; decided: boolean; default?: string }
/**
 * Every field that may be set at a level (for the customer / job / elevation / flat / room editors).
 * A field shared by several types (frame finish…) appears once, listing the types that use it.
 */
export function specFieldsAtLevel(level: SpecLevelKey): SpecLevelField[] {
  const n = levelNumber(level);
  const out = new Map<string, SpecLevelField>();
  const add = (e: SpecEntry, type: string | null) => {
    if (!e.levels.includes(n)) return;
    const cur = out.get(e.key);
    if (cur) {
      if (type && !cur.types.includes(type)) cur.types.push(type);
      for (const w of e.who) if (!cur.who.includes(w)) cur.who.push(w);
      cur.decided = cur.decided && e.decided;
      return;
    }
    out.set(e.key, { key: e.key, def: SPEC_FIELDS[e.key], who: [...e.who], types: type ? [type] : [], decided: e.decided, default: e.default });
  };
  SPEC_HEADER.forEach((e) => add(e, null));
  SPEC_REGS.forEach((e) => add(e, null));
  for (const t of ITEM_TYPES) (SPEC_TYPE_FIELDS[t] ?? []).forEach((e) => add(e, t));
  return [...out.values()];
}

/** May this field be set at this level (for any type)? */
export function specAllowedAt(key: string, level: SpecLevelKey): boolean {
  return specFieldsAtLevel(level).some((f) => f.key === key);
}

/** Validate / normalise a value for a field: '' / null clears it. Throws a readable message. */
export function normaliseSpecValue(key: string, raw: unknown): string | null {
  const def = SPEC_FIELDS[key];
  if (!def) throw new Error('Unknown specification field: ' + key);
  if (raw == null) return null;
  if (Array.isArray(raw)) raw = raw.join(', ');
  let v = String(raw).trim();
  if (!v) return null;
  if (def.kind === 'number') {
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n)) throw new Error(def.label + ' must be a number.');
    v = String(n);
  } else if (def.kind === 'bool') {
    if (/^(true|yes|y|1)$/i.test(v)) v = 'Yes';
    else if (/^(false|no|n|0)$/i.test(v)) v = 'No';
    else throw new Error(def.label + ' must be Yes or No.');
  } else if (def.kind === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(def.label + ' must be a date (YYYY-MM-DD).');
  }
  if (v.length > 500) throw new Error(def.label + ' is too long (500 characters at most).');
  return v;
}

// ---------- scopes ----------
/** The part of an item that picks its elevation / flat / room-type row ('' for customer, job, item). */
export function specScopeKey(level: SpecLevelKey, it: { block?: string | null; elevation?: string | null; flat?: string | null; room_code?: string | null }): string {
  const b = String(it.block ?? '').trim();
  const q = (v: string | null | undefined) => { const s = String(v ?? '').trim(); return s ? (b ? b + '/' + s : s) : ''; };
  if (level === 'elevation') return q(it.elevation);
  if (level === 'flat') return q(it.flat);
  if (level === 'room') return String(it.room_code ?? '').trim().toUpperCase();
  return '';
}
/** "Elevation B1/E1", "Flat 21", "Room type KT"… for showing where a value comes from. */
export function specSourceLabel(level: SpecLevelKey, scopeKey: string): string {
  const l = SPEC_LEVELS.find((x) => x.key === level)!.label;
  if (level === 'flat') return 'Flat ' + scopeKey;
  return scopeKey ? l + ' ' + scopeKey : l;
}

export interface SpecValueRow {
  level: SpecLevelKey;
  owner_id: string;           // customer id (customer level), item id (item level), else job id
  scope_key: string;          // elevation / flat / room code, '' otherwise
  param_key: string;
  value: string;
}

export interface ResolvedSpec {
  key: string;
  def: SpecFieldDef;
  entry: SpecEntry;
  value: string | null;
  level: SpecLevelKey | null; // where the winning value was set; null = matrix default or nothing
  source: string;             // "Job", "Elevation E1", "Default", "—"
  itemEditable: boolean;      // may be set on the item itself (level 6)
}

/**
 * Resolve one item's specification. `rows` are the spec values of the item's customer, its job
 * (job / elevation / flat / room rows) and the item itself — any extra rows are ignored.
 */
export function resolveItemSpec(
  item: Record<string, any>,
  rows: SpecValueRow[],
  ids: { customerId?: string | null; jobId: string },
): ResolvedSpec[] {
  const scopes: { level: SpecLevelKey; owner: string | null | undefined; scope: string }[] = [
    { level: 'item', owner: item.id, scope: '' },
    { level: 'room', owner: ids.jobId, scope: specScopeKey('room', item) },
    { level: 'flat', owner: ids.jobId, scope: specScopeKey('flat', item) },
    { level: 'elevation', owner: ids.jobId, scope: specScopeKey('elevation', item) },
    { level: 'job', owner: ids.jobId, scope: '' },
    { level: 'customer', owner: ids.customerId, scope: '' },
  ];
  const find = (key: string, s: typeof scopes[number]) => (s.owner && (s.level === 'item' || s.level === 'job' || s.level === 'customer' || s.scope))
    ? rows.find((r) => r.level === s.level && r.owner_id === s.owner && r.scope_key === s.scope && r.param_key === key)?.value ?? null
    : null;
  return specEntriesForType(item.item_type).map((entry) => {
    const def = SPEC_FIELDS[entry.key];
    const itemEditable = entry.levels.includes(6);
    const colVal = def.column ? item[def.column] : null;
    const hasCol = colVal != null && String(colVal).trim() !== '';
    if (def.merge === 'concat') {
      const parts: string[] = [];
      for (const s of [...scopes].reverse()) {
        const v = s.level === 'item' && hasCol ? String(colVal) : find(entry.key, s);
        if (v) parts.push(v);
      }
      return { key: entry.key, def, entry, value: parts.join(' · ') || null, level: parts.length ? 'item' : null, source: parts.length ? 'All levels' : '—', itemEditable };
    }
    if (hasCol) return { key: entry.key, def, entry, value: String(colVal), level: 'item', source: 'Item', itemEditable };
    for (const s of scopes) {
      const v = find(entry.key, s);
      if (v != null && v !== '') return { key: entry.key, def, entry, value: v, level: s.level, source: specSourceLabel(s.level, s.scope), itemEditable };
    }
    if (entry.default) return { key: entry.key, def, entry, value: entry.default, level: null, source: 'Default', itemEditable };
    return { key: entry.key, def, entry, value: null, level: null, source: '—', itemEditable };
  });
}

/** The PO-wide values (header fields and job / customer-level settings), job value over customer value. */
export function resolveJobSpec(rows: SpecValueRow[], ids: { customerId?: string | null; jobId: string }): { key: string; label: string; value: string; source: string; section: SpecFieldDef['section'] }[] {
  const keys = new Set<string>();
  for (const l of ['customer', 'job'] as SpecLevelKey[]) specFieldsAtLevel(l).forEach((f) => keys.add(f.key));
  const out: { key: string; label: string; value: string; source: string; section: SpecFieldDef['section'] }[] = [];
  for (const key of keys) {
    const def = SPEC_FIELDS[key];
    const j = rows.find((r) => r.level === 'job' && r.owner_id === ids.jobId && r.param_key === key)?.value;
    const c = ids.customerId ? rows.find((r) => r.level === 'customer' && r.owner_id === ids.customerId && r.param_key === key)?.value : undefined;
    const dflt = [...SPEC_HEADER, ...SPEC_REGS].find((e) => e.key === key)?.default;
    const value = j ?? c ?? dflt;
    if (value) out.push({ key, label: def.label, value, source: j ? 'Job' : c ? 'Customer' : 'Default', section: def.section });
  }
  return out;
}
