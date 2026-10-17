// Load the merged Cortizo catalogue (build.py's items.json + final/*.png) into the office app's
// database: the sketches into the private 'cortizo' bucket, the references into cortizo_items.
// The whole set is replaced: references no longer in the catalogues are removed.
//
//   npx tsx tools/cortizo-catalogue/upload.mts "<extract folder>"            dry run: counts only
//   npx tsx tools/cortizo-catalogue/upload.mts "<extract folder>" --write    really writes
//
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment (e.g. `set -a; . ./.env`):
// point them at the test project first, then at prod. Tenant: ACE (override with --tenant <uuid>).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { db, ACE_TENANT } from '../../apps/api/src/supabase.ts';
import { SKETCH_BUCKET } from '../../apps/api/src/cortizo.ts';

const dir = process.argv[2];
const write = process.argv.includes('--write');
const ti = process.argv.indexOf('--tenant');
const tenant = ti > 0 ? process.argv[ti + 1] : ACE_TENANT;
if (!dir) { console.error('Usage: upload.mts "<extract folder>" [--write] [--tenant <uuid>]'); process.exit(1); }

const items: any[] = JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8'));
const sketches = readdirSync(join(dir, 'final')).filter((f) => f.endsWith('.png'));
const host = (process.env.SUPABASE_URL ?? '').replace(/^https:\/\//, '').split('.')[0];
console.log(`${items.length} references (${items.filter((i) => i.kind === 'profile').length} profiles), ${sketches.length} sketches → project ${host || '(SUPABASE_URL not set)'}, tenant ${tenant}`);
if (!write) { console.log('Dry run — add --write to load them.'); process.exit(0); }

async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) await fn(list[i++]); }));
}
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

let up = 0;
await pool(sketches, 8, async (f) => {
  const { error } = await db().storage.from(SKETCH_BUCKET).upload(`${tenant}/${f}`, readFileSync(join(dir, 'final', f)), { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`${f}: ${error.message}`);
  if (++up % 500 === 0) console.log(`  sketches ${up}/${sketches.length}`);
});
console.log(`sketches uploaded: ${up}`);

const now = new Date().toISOString();
const rows = items.map((i) => ({
  tenant_id: tenant, ref: i.ref, kind: i.kind, desc_en: i.desc_en || null, desc_es: i.desc_es || null,
  weight_g_m: num(i.weight_g_m), surface_dm2_m: num(i.surface_dm2_m),
  colour_en: i.colour_en || null, colour_es: i.colour_es || null, type_en: i.type_en || null, type_es: i.type_es || null,
  sketch: i.sketch || null, systems: i.systems ?? [], sources: i.sources ?? [], imported_at: now,
}));
for (let k = 0; k < rows.length; k += 500) {
  const { error } = await db().from('cortizo_items').upsert(rows.slice(k, k + 500), { onConflict: 'tenant_id,ref' });
  if (error) throw error;
}
// references from an earlier import that are no longer in the catalogues
const { error: delErr, count } = await db().from('cortizo_items').delete({ count: 'exact' }).eq('tenant_id', tenant).lt('imported_at', now);
if (delErr) throw delErr;
console.log(`references loaded: ${rows.length}, removed (no longer in the catalogues): ${count ?? 0}`);
