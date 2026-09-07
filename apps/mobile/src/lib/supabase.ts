import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { demoClient } from './demoClient';

// Public/safe values (anon key). Row-Level Security scopes every read/write to the
// signed-in user's tenant — the mobile app never uses the service-role key.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const configured = !!(url && anon);
// Show "Sign in with Microsoft" when the tenant uses Azure SSO.
export const ssoEnabled = process.env.EXPO_PUBLIC_AZURE_SSO_ENABLED === 'true';

// The real Supabase client. Kept as `realSupabase` so lead capture can always reach the
// real database even while the app is showing demo data through the proxy below.
// Fall back to harmless placeholders when unconfigured so the module doesn't throw at import
// (createClient requires a non-empty URL). Demo mode never touches the real client; real sign-in
// is still gated by `configured` in the UI.
export const realSupabase = createClient(url || 'https://placeholder.supabase.co', anon || 'placeholder-anon-key', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// DEMO mode: when on, every `supabase.*` call is transparently served by an in-memory
// client with sample data (see demoClient.ts). The real client is untouched, so production
// sign-in and data are never affected. Toggled by the app when a prospect starts/exits a demo.
let _demo = false;
export function setDemoMode(on: boolean): void { _demo = on; }
export function isDemo(): boolean { return _demo; }

export const supabase: any = new Proxy({} as any, {
  get(_t, prop: string) {
    const client: any = _demo ? demoClient : realSupabase;
    const v = client[prop];
    return typeof v === 'function' ? v.bind(client) : v;
  },
});
