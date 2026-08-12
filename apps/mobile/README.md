# ACE Field — mobile app (Expo)

The field half of the product. This first cut: **sign in → jobs → items**, reading
directly from Supabase with the anon key (Row-Level Security scopes everything to the
signed-in user's tenant — no service-role key on the device).

## Run it (Expo Go)
1. From the repo root, install everything once:
   ```
   npm install
   ```
2. Configure Supabase for the app — copy the example and fill in the **public** values:
   ```
   cp apps/mobile/.env.example apps/mobile/.env
   # EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   # EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon/public key>
   ```
3. Start the dev server:
   ```
   cd apps/mobile
   npx expo start
   ```
4. Install **Expo Go** on your phone, scan the QR code. Or press `i` / `a` for a simulator.

## Signing in
Use any login created in the office app's **Users** tab (or `create-admin`). Because the
app_users row is linked to that Supabase account, RLS returns only your tenant's jobs/items.

## What's here / what's next
- Now: auth (session persists), jobs list, per-job items list with stage + install status + snag badge, pull-to-refresh.
- Next: item detail, the **scan → survey → fit** capture flow, photos, and offline queueing.
