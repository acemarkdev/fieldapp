// ACE Scaffolding crews on the phone (CrewScreen) — the pure helpers, tested in crewLogic.test.ts.
// The crew screen talks to the office server (not to the database directly): its address comes from
// EXPO_PUBLIC_OFFICE_URL, or — for builds made before that was set — from which database the app uses.

const TEST_DB = 'kmmnlbksxncdzlorobcc', PROD_DB = 'swvquulcchcwyyhpjfsm';
export function officeUrl(explicit: string | undefined, supabaseUrl: string | undefined): string {
  if (explicit) return explicit.replace(/\/+$/, '');
  const u = String(supabaseUrl ?? '');
  if (u.includes(PROD_DB)) return 'https://office.acemark.com.pl';
  if (u.includes(TEST_DB)) return 'https://office-test.acemark.com.pl';
  return 'https://office-test.acemark.com.pl';
}
export const isoDay = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export function dayLabel(d: string, today: string): string {
  if (d === today) return 'Today';
  if (d === addDays(today, 1)) return 'Tomorrow';
  if (d === addDays(today, -1)) return 'Yesterday';
  const x = new Date(d + 'T00:00:00Z');
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getUTCDay()] + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7);
}
export type Pt = { x: number; y: number };
/** The strokes of a signature as "svg:<w>x<h>:<path>" (what the server draws on the handover certificate). */
export function signaturePath(strokes: Pt[][], w: number, h: number): string | null {
  const parts = strokes.filter((s) => s.length > 1).map((s) => 'M' + s.map((p, i) => (i ? 'L' : '') + Math.round(p.x) + ' ' + Math.round(p.y)).join(' '));
  if (!parts.length) return null;
  return `svg:${Math.round(w)}x${Math.round(h)}:${parts.join(' ')}`;
}
/** Segments to draw a stroke with plain Views: centre, length and angle of each piece. */
export function segments(stroke: Pt[]): { cx: number; cy: number; len: number; deg: number }[] {
  const out: { cx: number; cy: number; len: number; deg: number }[] = [];
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1], b = stroke[i], dx = b.x - a.x, dy = b.y - a.y;
    out.push({ cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, len: Math.max(1, Math.hypot(dx, dy)), deg: (Math.atan2(dy, dx) * 180) / Math.PI });
  }
  return out;
}
export const VISIT_LABEL: Record<string, string> = { erect: 'Erect', adapt: 'Adapt', inspect: 'Inspect', dismantle: 'Dismantle', deliver: 'Deliver', collect: 'Collect' };
export const SCAFFOLD_LABEL: Record<string, string> = { booked: 'Booked', erecting: 'Up — not handed over', on_hire: 'On hire', dismantle_requested: 'Dismantle requested', dismantling: 'Dismantling', down: 'Down' };
/** Which scaffolds a handover can include: up (or still booked), not yet on hire. */
export const canHandOver = (status: string) => status === 'booked' || status === 'erecting';
export const mapsUrl = (address: string, ios: boolean) => (ios ? 'http://maps.apple.com/?q=' : 'https://www.google.com/maps/search/?api=1&query=') + encodeURIComponent(address);
