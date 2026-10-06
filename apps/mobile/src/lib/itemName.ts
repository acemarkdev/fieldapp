// How an item is named for people on site — the same wording the purchase-order PDF uses
// (apps/api/src/poPdf.ts): "Flat 12 Bathroom" when a flat is set, else the item code (W1 / D1).
// Pure (no React Native imports) so it is unit-testable.
import { roomName } from './rooms';

export interface NamedItem {
  flat?: string | null; room_code?: string | null; item_code?: string | null;
  block?: string | null; elevation?: string | null; floor?: string | null;
}

const clean = (v: unknown) => String(v ?? '').trim();
const room = (code: unknown) => { const c = clean(code); return c ? roomName(c.toUpperCase()) : ''; };

/** "Flat 12 Bathroom", or the item code when the item has no flat. */
export function poShortName(it: NamedItem): string {
  const flat = clean(it.flat);
  if (flat) { const rn = room(it.room_code); return ('Flat ' + flat + (rn ? ' ' + rn : '')).trim(); }
  return clean(it.item_code);
}

/** The PO card's location line: "B4 · E1 · Flat 26B · Fl 2 · Bathroom · W2". */
export function poLocationLine(it: NamedItem): string {
  const flat = clean(it.flat), floor = clean(it.floor);
  return [clean(it.block), clean(it.elevation), flat ? 'Flat ' + flat : '', floor ? 'Fl ' + floor : '', room(it.room_code), clean(it.item_code)]
    .filter(Boolean).join(' · ');
}

/** Sketch catalogue key for a design code: "24", "Style 24" and "style24" all mean sketch 24. */
export function styleKey(designCode: string | null | undefined, known: Record<string, unknown>): string | null {
  const raw = clean(designCode);
  if (!raw) return null;
  if (known[raw] != null) return raw;
  const stripped = raw.replace(/^style\s*/i, '').trim();
  return stripped && known[stripped] != null ? stripped : null;
}
