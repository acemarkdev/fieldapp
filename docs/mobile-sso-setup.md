# Mobile "Sign in with Microsoft" — setup

The phone app can now sign in with Microsoft (Azure), the same identity your office
web app uses. Because the office SSO already works, **Azure/Entra is already configured** —
the only new thing to add is the mobile redirect URL in Supabase.

## 1. Install the auth packages (once)

From `apps/mobile`, let Expo pick the versions that match your SDK:

```
npx expo install expo-web-browser expo-auth-session expo-crypto
```

## 2. Turn the button on

The "Sign in with Microsoft" button shows only when this env var is set. Add it to the
`.env` the app loads (alongside `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`):

```
EXPO_PUBLIC_AZURE_SSO_ENABLED=true
```

## 3. Allow the mobile redirect in Supabase

Supabase brokers the login and then redirects back into the app via our custom scheme.
In **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**, add:

- **Standalone / dev build:** `acefield://auth-callback`
- **Expo Go (dev):** the `exp://…/--/auth-callback` URL the app is using. It depends on your
  machine's IP, so the simplest is to add a wildcard `exp://*` for development, or read the
  exact value — `ssoRedirectUri()` in `src/lib/auth.ts` returns it (temporarily `console.log`
  it, or check the browser URL bar when the login page opens).

Azure itself needs **no change**: it only knows Supabase's callback
(`https://<your-project>.supabase.co/auth/v1/callback`), which is already registered for the
office SSO. The `acefield://` redirect is entirely between Supabase and the app.

## 4. Test

Start the app, tap **Sign in with Microsoft**, complete the Microsoft login in the in-app
browser. On return you should land on the Jobs screen. The app then reads your role from
`app_users` (linked by email during the office SSO setup) and gates the UI accordingly.

## Notes & gotchas

- **Expo Go vs dev build.** Expo Go works for testing but its `exp://` redirect changes with
  your network. For anything beyond a quick test, build a dev client (`npx expo run:ios` /
  `run:android` or an EAS dev build) so the redirect is the stable `acefield://auth-callback`.
- **The user must exist in `app_users`.** SSO authenticates the person, but their role/tenant
  come from the `app_users` row linked by email. Invite them in the office **Users** tab first
  (same as web SSO). If they have no row, they'll sign in but see no data.
- **Password login still works** for anyone who has a password set; SSO is an additional option.
- Flow is PKCE (with an implicit-token fallback), handled in `src/lib/auth.ts`.
