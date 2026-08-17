// "Sign in with Microsoft" for the phone app.
// Opens the Supabase Azure OAuth flow in a secure in-app browser and brings the
// resulting session back into the app via our custom URL scheme (acefield://).
//
// Requires (installed with SDK-correct versions via `npx expo install`):
//   expo-web-browser  expo-auth-session  expo-crypto
//
// Supabase + Azure must allow the redirect URL this produces (see docs/mobile-sso-setup.md).
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from './supabase';

// Lets the in-app browser hand control back to the app cleanly.
WebBrowser.maybeCompleteAuthSession();

// The URL Microsoft returns to after login. We DON'T force a scheme: makeRedirectUri
// returns the exp:// dev URL inside Expo Go (a custom scheme won't resolve there) and
// the app's acefield:// scheme in a dev/standalone build. Whatever it resolves to must
// be in Supabase's Redirect URLs. Temporarily log this to see the exact value.
export function ssoRedirectUri(): string {
  return makeRedirectUri({ path: 'auth-callback' });
}

// Pull query (?a=b) or fragment (#a=b) params out of a redirect URL. Done by hand because
// `new URL()` is unreliable for non-http schemes like exp:// on some engines.
function paramsFrom(url: string): URLSearchParams {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const h = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  return new URLSearchParams(q || h);
}

export async function signInWithMicrosoft(): Promise<{ error?: string }> {
  try {
    const redirectTo = ssoRedirectUri();

    // Ask Supabase for the provider URL but don't let it auto-redirect — we drive the browser.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { redirectTo, scopes: 'openid profile email', skipBrowserRedirect: true },
    });
    if (error || !data?.url) return { error: error?.message ?? 'Could not start Microsoft sign-in.' };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === 'cancel' || result.type === 'dismiss') return { error: 'Sign-in cancelled.' };
    if (result.type !== 'success' || !result.url) return { error: 'Sign-in did not complete.' };

    const url = result.url;
    const params = paramsFrom(url);

    // PKCE (default): the redirect carries ?code=... — exchange it for a session.
    const code = params.get('code');
    if (code) {
      const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
      return exErr ? { error: exErr.message } : {};
    }

    // Implicit fallback: tokens arrive in the URL fragment (#access_token=...).
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      const { error: sErr } = await supabase.auth.setSession({ access_token, refresh_token });
      return sErr ? { error: sErr.message } : {};
    }

    return { error: params.get('error_description') ?? 'Microsoft did not return a session.' };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}
