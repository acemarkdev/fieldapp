import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Public/safe values (anon key). Row-Level Security scopes every read/write to the
// signed-in user's tenant — the mobile app never uses the service-role key.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const configured = !!(url && anon);
// Show "Sign in with Microsoft" when the tenant uses Azure SSO.
export const ssoEnabled = process.env.EXPO_PUBLIC_AZURE_SSO_ENABLED === 'true';

export const supabase = createClient(url, anon, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
