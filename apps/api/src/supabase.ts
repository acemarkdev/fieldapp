// Supabase client for the backend (service-role key — server-side ONLY, bypasses RLS).
// Created lazily so importing this module never requires env to be present.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-side only).');
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

// Anon-key client for acting *as a user* (password sign-in). Fresh per call, no stored session.
export function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set.');
  return createClient(url, anon, { auth: { persistSession: false } });
}

// ACE = tenant #1 (matches supabase/seed.sql).
export const ACE_TENANT = '00000000-0000-0000-0000-0000000000ac';
