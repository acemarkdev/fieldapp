// Whether a column exists yet (a migration may run after the deploy). Checked once a minute per column; a write
// drops the fields whose column is missing, so the app keeps working before the migration and uses them after.
import { db } from './supabase';

const seen = new Map<string, { at: number; ok: boolean }>();
export async function colReady(table: string, col: string): Promise<boolean> {
  const k = table + '.' + col, c = seen.get(k);
  if (c && Date.now() - c.at < 60_000) return c.ok;
  const { error } = await db().from(table).select(col).limit(1);
  const ok = !error; seen.set(k, { at: Date.now(), ok }); return ok;
}
/** The same fields without those whose column is not there yet. */
export async function onlyReady<T extends Record<string, any>>(table: string, fields: T, cols: string[]): Promise<T> {
  const out: Record<string, any> = { ...fields };
  for (const c of cols) if (c in out && !(await colReady(table, c))) delete out[c];
  return out as T;
}
