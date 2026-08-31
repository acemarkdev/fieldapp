// Offline-first support for the field app: new items are queued in local storage and
// pushed to Supabase whenever the device is online (on save, on screen focus, on resume,
// or via a manual "Sync pending" button). Lists are cached so you can still navigate
// with no signal (e.g. in a basement).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

const PENDING_KEY = 'ace_pending_items';
const PHOTOS_KEY = 'ace_pending_photos';

export interface Pending {
  localId: string;
  job_id: string;
  full_code: string;
  payload: Record<string, any>;
}

// ---- simple JSON cache (for jobs / items lists) ----
export async function cacheSet(key: string, data: unknown): Promise<void> {
  try { await AsyncStorage.setItem('ace_cache_' + key, JSON.stringify(data)); } catch {}
}
export async function cacheGet<T>(key: string): Promise<T | null> {
  try { const v = await AsyncStorage.getItem('ace_cache_' + key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}

// ---- pending-item queue ----
async function readPending(): Promise<Pending[]> {
  try { const v = await AsyncStorage.getItem(PENDING_KEY); return v ? (JSON.parse(v) as Pending[]) : []; } catch { return []; }
}
async function writePending(list: Pending[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

export async function enqueueItem(p: Pending): Promise<void> {
  const list = await readPending();
  list.push(p);
  await writePending(list);
}

export async function getPending(jobId?: string): Promise<Pending[]> {
  const list = await readPending();
  return jobId ? list.filter((x) => x.job_id === jobId) : list;
}

// Edit a queued item in place (used to fix a record before it syncs).
export async function updatePending(localId: string, rec: Pending): Promise<void> {
  const list = await readPending();
  const i = list.findIndex((x) => x.localId === localId);
  if (i >= 0) { list[i] = rec; await writePending(list); }
}

// Remove a queued item and any photos queued against its code.
export async function removePending(localId: string): Promise<void> {
  const list = await readPending();
  const rec = list.find((x) => x.localId === localId);
  await writePending(list.filter((x) => x.localId !== localId));
  if (rec) {
    const photos = await readPhotos();
    for (const p of photos) if (p.itemFullCode === rec.full_code) await AsyncStorage.removeItem('ace_photo_' + p.localId);
    await writePhotos(photos.filter((p) => p.itemFullCode !== rec.full_code));
  }
}

// Try to push every queued item. Stops at the first network failure (still offline) and
// keeps the rest for next time. A duplicate (already on the server) is treated as done.
export async function flushPending(): Promise<{ synced: number; remaining: number; error?: string }> {
  const list = await readPending();
  const remaining: Pending[] = [];
  let synced = 0;
  let error: string | undefined; // a real server error (not just "offline")
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    try {
      const { error: e } = await supabase.from('survey_items').insert(rec.payload);
      if (e && (e as any).code !== '23505') { remaining.push(rec); error = e.message; } // real error: keep + report
      else synced += e ? 0 : 1;                                                          // ok or duplicate: drop
    } catch {
      remaining.push(...list.slice(i)); // network down: keep this + the rest, no error message
      break;
    }
  }
  await writePending(remaining);
  return { synced, remaining: remaining.length, error };
}

// ---- pending-photo queue ----
// Image bytes are stored one-per-key (they're big); the manifest holds only metadata.
export interface PendingPhoto {
  localId: string;
  tenant_id: string;
  itemId?: string;        // an existing server item
  itemFullCode?: string;  // a still-queued item — resolved to its id after that item syncs
  kind?: string;          // 'before' (survey/scan) | 'after' (fitter) | 'sketch' (snag). Defaults to 'before'.
}

async function readPhotos(): Promise<PendingPhoto[]> {
  try { const v = await AsyncStorage.getItem(PHOTOS_KEY); return v ? (JSON.parse(v) as PendingPhoto[]) : []; } catch { return []; }
}
async function writePhotos(list: PendingPhoto[]): Promise<void> { await AsyncStorage.setItem(PHOTOS_KEY, JSON.stringify(list)); }

export async function enqueuePhoto(meta: Omit<PendingPhoto, 'localId'>, base64: string): Promise<PendingPhoto> {
  const localId = 'photo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  await AsyncStorage.setItem('ace_photo_' + localId, base64);
  const list = await readPhotos();
  const rec: PendingPhoto = { localId, ...meta };
  list.push(rec);
  await writePhotos(list);
  return rec;
}

export async function getPendingPhotos(match: { itemId?: string; itemFullCode?: string }): Promise<PendingPhoto[]> {
  const list = await readPhotos();
  return list.filter((p) => (match.itemId && p.itemId === match.itemId) || (match.itemFullCode && p.itemFullCode === match.itemFullCode));
}

export async function getPhotoDataUri(localId: string): Promise<string | null> {
  const b = await AsyncStorage.getItem('ace_photo_' + localId);
  return b ? 'data:image/jpeg;base64,' + b : null;
}

// If a queued item's code changes on edit, re-point its queued photos to the new code.
export async function repointPendingPhotos(oldCode: string, newCode: string): Promise<void> {
  if (oldCode === newCode) return;
  const photos = await readPhotos();
  let changed = false;
  for (const p of photos) if (p.itemFullCode === oldCode) { p.itemFullCode = newCode; changed = true; }
  if (changed) await writePhotos(photos);
}

export async function flushPhotos(): Promise<{ synced: number; remaining: number; error?: string }> {
  const list = await readPhotos();
  const remaining: PendingPhoto[] = [];
  let synced = 0;
  let error: string | undefined;
  for (let i = 0; i < list.length; i++) {
    const ph = list[i];
    try {
      let itemId = ph.itemId;
      if (!itemId && ph.itemFullCode) {
        const { data } = await supabase.from('survey_items').select('id').eq('tenant_id', ph.tenant_id).eq('full_code', ph.itemFullCode).maybeSingle();
        itemId = data?.id;
      }
      if (!itemId) { remaining.push(ph); continue; }         // its item hasn't synced yet — retry later
      const base64 = await AsyncStorage.getItem('ace_photo_' + ph.localId);
      if (!base64) continue;                                  // data missing — drop
      const path = `${ph.tenant_id}/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
      const up = await supabase.storage.from('photos').upload(path, decode(base64), { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const ins = await supabase.from('item_photos').insert({ tenant_id: ph.tenant_id, item_id: itemId, kind: ph.kind ?? 'before', storage_path: path });
      if (ins.error) throw ins.error;
      await AsyncStorage.removeItem('ace_photo_' + ph.localId);
      synced++;
    } catch (e: any) {
      remaining.push(...list.slice(i)); // offline / server error: keep this + the rest
      error = e?.message;
      break;
    }
  }
  await writePhotos(remaining);
  return { synced, remaining: remaining.length, error };
}

// Push queued items first (so their photos can resolve), then queued photos.
export async function flushAll(): Promise<{ synced: number; remaining: number; error?: string }> {
  const it = await flushPending();
  const ph = await flushPhotos();
  return { synced: it.synced + ph.synced, remaining: it.remaining + ph.remaining, error: it.error ?? ph.error };
}
