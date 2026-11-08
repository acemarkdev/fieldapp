// The phone's Wysyłki screen (warehouse): which shipments to show, the loading progress and what is still
// missing before the truck leaves. Pure functions — tested in shipLogic.test.ts.
export interface PShip { id: string; name: string; status: string; ship_date: string | null; company: string; importer: string | null; totals?: { lines: number; net: number; gross: number }; photos?: number; missing?: string[]; sent_at?: string | null }
export interface PLine { id: string; qty: number | null; unit: string | null; description: string; net_kg: number | null; gross_kg: number | null; comment: string | null; loaded: boolean }
export interface PFile { id: string; line_id: string | null; kind: string; file_name: string | null }

export const STATUS_PL: Record<string, string> = { new: 'Nowa', in_progress: 'W trakcie', sent: 'Wysłana', sent_no_docs: 'Wysłana bez dokumentów' };
const DAY = 864e5;
/** Not sent yet, and the ones sent in the last `days` days (photos of the CMR often come a day later). */
export function forPhone(list: PShip[], now = new Date(), days = 7): PShip[] {
  const open = (s: PShip) => s.status === 'new' || s.status === 'in_progress';
  const recent = (s: PShip) => !!s.ship_date && now.getTime() - Date.parse(s.ship_date + 'T12:00:00Z') <= days * DAY;
  return list.filter((s) => open(s) || recent(s)).sort((a, b) => (open(a) === open(b) ? String(b.ship_date ?? '9999').localeCompare(String(a.ship_date ?? '9999')) : open(a) ? -1 : 1));
}
/** "17,5" / "1 200.5" → 17.5 / 1200.5; '' → null; anything else → undefined. */
export function kg(v: string): number | null | undefined {
  const s = String(v ?? '').replace(/[\s ]|kg/gi, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}
export const kgText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));
export function progress(lines: PLine[]) { return { loaded: lines.filter((l) => l.loaded).length, total: lines.length }; }
/** Before "Wysłane": lines not ticked, lines without weights, no CMR photo. */
export function beforeSending(lines: PLine[], files: PFile[]): string[] {
  const out: string[] = [];
  const p = progress(lines); if (p.loaded < p.total) out.push(`Nie wszystkie pozycje są zaznaczone jako załadowane (${p.loaded} z ${p.total}).`);
  const noKg = lines.filter((l) => l.net_kg == null || l.gross_kg == null).length; if (noKg) out.push(`${noKg} poz. bez wagi netto / brutto.`);
  if (!files.some((f) => f.kind === 'cmr')) out.push('Brak zdjęcia CMR.');
  return out;
}
export const firstLine = (t: string | null | undefined) => String(t ?? '').split('\n')[0];
