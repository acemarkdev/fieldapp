# Publishing ACE Field to Google Play

This is the end-to-end process for getting the mobile app (`apps/mobile`, Expo SDK 54,
Android package **`uk.co.acegroup.field`**) onto the Google Play Store, and for shipping
updates afterwards. It uses **EAS** (Expo Application Services) to build the release
bundle and submit it.

> One-time things are marked **(once)**. Everything else you repeat for each release.

---

## 0. What you need first (once)

- **Google Play Developer account** — one-time **$25** at
  <https://play.google.com/console>. Prefer an **Organisation** account (see the tester
  rule in §6 — organisation accounts skip it).
- **Expo account** — free, <https://expo.dev>.
- **Node + EAS CLI** on your Mac:
  ```bash
  npm install -g eas-cli
  eas login
  ```
- A **privacy policy URL** (Play requires one because the app signs users in and stores
  data). A simple hosted page is fine.

---

## 1. App config (once, then only when it changes)

`apps/mobile/app.json` already has the essentials:

```json
{ "expo": { "name": "ACE Field", "slug": "ace-field",
  "version": "0.37.1", "scheme": "acefield",
  "android": { "package": "uk.co.acegroup.field" } } }
```

Two things to know:

- **`version`** is the human version (e.g. `0.37.1`) shown to users. We already bump this
  on every release (the 4 version markers).
- **`versionCode`** is the integer Google uses to order uploads — **it must increase with
  every upload**. Easiest is to let EAS manage it: set `"cli": { "appVersionSource":
  "remote" }` and `autoIncrement` in `eas.json` (below), so you never hand-edit it.

---

## 2. eas.json (once)

Create `apps/mobile/eas.json`:

```json
{
  "cli": { "version": ">= 12.0.0", "appVersionSource": "remote" },
  "build": {
    "production": {
      "android": { "buildType": "app-bundle", "autoIncrement": true },
      "env": {
        "EXPO_PUBLIC_SUPABASE_URL": "https://YOUR-PROJECT.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "YOUR-ANON-KEY",
        "EXPO_PUBLIC_AZURE_SSO_ENABLED": "true",
        "EXPO_PUBLIC_AZURE_CLIENT_ID": "…",
        "EXPO_PUBLIC_AZURE_TENANT": "…"
      }
    },
    "preview": { "android": { "buildType": "apk" } }
  },
  "submit": { "production": {} }
}
```

- `buildType: app-bundle` produces the **`.aab`** Google requires (it generates
  per-device APKs from it).
- The `.env` file is **not** used by cloud builds — the `EXPO_PUBLIC_*` values must be in
  `eas.json` `env` (or set as EAS secrets: `eas secret:create`). Keep the anon key here
  (it's public by design); never put the Supabase **service-role** key or the Monday token
  in the app — those stay on the office server only.

---

## 3. Build the release bundle

From `apps/mobile`:

```bash
eas build:configure      # first time only — links the project to your Expo account
eas build --platform android --profile production
```

- On the first build EAS offers to **generate and store an upload keystore** — say yes and
  let EAS manage it (don't lose access to your Expo account; that keystore signs every
  future update).
- When it finishes you get a link to download the **`.aab`**.

---

## 4. Create the app in Play Console (once)

1. <https://play.google.com/console> → **Create app** → name "ACE Field", app/free, tick
   the declarations.
2. Fill the **Store listing**: short + full description, app **icon** (512×512), **feature
   graphic** (1024×500), and at least **2 phone screenshots**.
3. Complete the required questionnaires: **Privacy policy** URL, **Data safety** (declare
   that you collect account info + user content, over HTTPS), **Content rating**, **Target
   audience** (not children), **Ads** (none).

---

## 5. Upload the first build

Google requires the **first** `.aab` to be uploaded **manually**:

- Play Console → your app → **Testing → Internal testing** (fastest) → **Create release**
  → upload the `.aab` from §3 → add release notes → **Save / Review / Roll out**.

After that first manual upload, EAS Submit works for everything else:

```bash
eas submit --platform android --profile production   # picks your latest build
```

You'll authorise it once with a **Google service account JSON** (Play Console → Setup →
API access → create service account → grant "Release manager") — EAS documents this.

---

## 6. ⚠️ The tester requirement (new personal accounts)

If your Play Console account is a **personal** account **created after 13 Nov 2023**, Google
will **not** let you publish to Production until you have run a **Closed test with at least
12 testers, opted in continuously for 14 days**. Then you "apply for production access".

- **Organisation** accounts, and personal accounts made **before** that date, are **exempt**
  — they can go straight to Production. This is the main reason to use an org account.
- Practical path for a personal account: push the build to **Closed testing**, add ≥12
  testers (an email list or a Google Group — your own fitters/office staff count), wait the
  14 days, then promote to Production.

Sources: Google's policy pages linked at the bottom.

---

## 7. Shipping an update (every release)

1. Bump the version the way we already do — the **4 markers** to the new number
   (`packages/shared/src/version.ts`, `apps/mobile/src/lib/version.ts`,
   `apps/mobile/package.json`, `apps/mobile/app.json`).
   `versionCode` auto-increments via `eas.json` (§2), so nothing to edit there.
2. `eas build --platform android --profile production`
3. `eas submit --platform android --profile production`
4. In Play Console, promote the release from Internal/Closed → **Production** (or roll out
   straight to Production once you're past §6).

---

## 8. Microsoft SSO note for the store build

In Expo Go we used the `exp://` redirect. A **standalone** Play build uses the app's own
scheme, **`acefield://`** (set in `app.json`). Before shipping SSO in production, add the
production redirect URI (e.g. `acefield://auth` or the `makeRedirectUri()` output for the
standalone build) to the **Azure app registration → Authentication → redirect URIs**,
otherwise Microsoft login will error on the installed app. Test it from an internal-testing
install before going wide.

---

## Quick reference

```bash
# one-time
npm i -g eas-cli && eas login
cd apps/mobile && eas build:configure

# each release
# (bump the 4 version markers first)
eas build  --platform android --profile production
eas submit --platform android --profile production
```

## Sources
- [Submit to the Google Play Store with EAS Submit — Expo](https://docs.expo.dev/submit/android/)
- [Create a production build for Android — Expo](https://docs.expo.dev/tutorial/eas/android-production-build/)
- [Submit to app stores — Expo](https://docs.expo.dev/deploy/submit-to-app-stores/)
- [App testing requirements for new personal developer accounts — Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Everything about the 12 testers requirement — Google Play Developer Community](https://support.google.com/googleplay/android-developer/community-guide/255621488/everything-about-the-12-testers-requirement?hl=en)
