// App access per role (Admin ▸ Roles), kept in server_config as JSON. Read on every request, so a
// short cache; saving clears it.
import { getConfig, setConfig } from './store';
import { setOverride, type AppOverrides } from '@ace/shared';

const KEY = 'role_app_access';
let cache: { at: number; value: AppOverrides } | null = null;
export async function getAppOverrides(): Promise<AppOverrides> {
  if (cache && Date.now() - cache.at < 15000) return cache.value;
  let value: AppOverrides = {};
  try { value = JSON.parse((await getConfig(KEY)) || '{}') ?? {}; } catch { value = {}; }
  cache = { at: Date.now(), value };
  return value;
}
export async function saveAppOverride(role: unknown, app: unknown, level: unknown): Promise<{ ok: true; overrides: AppOverrides } | { ok: false; error: string }> {
  const r = setOverride(await getAppOverrides(), role, app, level);
  if (!r.ok) return r;
  await setConfig(KEY, JSON.stringify(r.overrides));
  cache = { at: Date.now(), value: r.overrides };
  return r;
}
