# Deploying the office app — Test & Prod

Two cloud copies of the office app, each with its **own database and its own Monday board**,
so testers can't touch real data. The app code is identical — only the environment differs.

```
                main branch  ──►  ace-office-test   ──►  Supabase TEST project   ──►  Monday TEST board
   (you work here, auto-deploys)   (orange TEST badge)

              release branch ──►  ace-office-prod   ──►  Supabase PROD project   ──►  real Monday board
   (merge main→release to ship)    (stays warm)
```

Host: **Render** (deploys from GitHub; our database is Supabase, so we don't use Render's DB).
The repo already contains `render.yaml`, which defines both services.

---

## A. One-time setup

### 1. Two Supabase projects
Create **two** projects at <https://supabase.com> — e.g. `ace-test` and `ace-prod`. For each,
from **Settings → API**, note: `Project URL`, `anon` key, `service_role` key.

Apply **all** migrations to **both** projects (Supabase → SQL editor → run each file in
`supabase/migrations/` in numeric order, `0001` … `0018`). Then, on **test only**, run
`supabase/seed.sql` for sample jobs/teams, and create a test admin login (see step 5).

> Keep the two schemas identical. Every new migration gets applied to test first, then to
> prod when you release.

### 2. A dedicated test Monday board
Create a throwaway board in Monday for test. You can reuse the same `MONDAY_API_TOKEN`; test
jobs just link to the **test** board (set per job in the app), so nothing lands on the real one.

### 3. GitHub
Push the repo to GitHub. Create the prod branch:
```bash
git checkout main
git branch release
git push -u origin release
```

### 4. Render Blueprint
1. Render → **New → Blueprint** → connect your GitHub repo. Render reads `render.yaml` and
   proposes two services: **ace-office-test** and **ace-office-prod**.
2. Apply it. Then open **each** service → **Environment** and fill the secret values (they're
   marked `sync: false`, so Render won't read them from the file):

| Variable | ace-office-test | ace-office-prod |
|---|---|---|
| `APP_ENV` | `test` (preset) | `prod` (preset) |
| `SUPABASE_URL` | test project URL | prod project URL |
| `SUPABASE_ANON_KEY` | test anon key | prod anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | test service key | prod service key |
| `MONDAY_API_TOKEN` | your Monday token | your Monday token |
| `AZURE_SSO_ENABLED` | `false` (until SSO set up) | `false` |
| `LIVE_KEY` | optional | optional |

3. Each service builds and gives you a URL like `https://ace-office-test.onrender.com`.
   (Add custom domains later if you want, e.g. `office.acegroup…` / `test.acegroup…`.)

### 5. Admin logins (per project)
Logins live in each Supabase project, so create an admin in **each**. Easiest from your Mac,
pointing at the target project:
```bash
# test
SUPABASE_URL=<test-url> SUPABASE_ANON_KEY=<test-anon> SUPABASE_SERVICE_ROLE_KEY=<test-service> \
  node --import tsx apps/api/src/create-admin.ts
# prod: repeat with the prod keys
```

### 6. Custom domains (office.acemark.com.pl)

We serve the app under your own domain:

| Service | Domain |
|---|---|
| `ace-office-prod` | **office.acemark.com.pl** |
| `ace-office-test` | **office-test.acemark.com.pl** |

These are already declared in `render.yaml`. To make them live:

1. **Render** → each service → **Settings → Custom Domains**. Confirm the domain is listed
   (the blueprint adds it) and copy the **CNAME target** Render shows — it looks like
   `ace-office-prod.onrender.com`.
2. **DNS for `acemark.com.pl`** (at whoever hosts the zone — your `.pl` registrar or DNS
   provider) → add two **CNAME** records:

   | Type | Host / Name | Value (target) |
   |---|---|---|
   | CNAME | `office` | `ace-office-prod.onrender.com` |
   | CNAME | `office-test` | `ace-office-test.onrender.com` |

   (Subdomains use CNAME; only a *root* domain would need an A/ALIAS record.)
3. Wait for DNS to propagate (minutes to a couple of hours). Render then **auto-issues a free
   TLS certificate** (Let's Encrypt) and the site is live on `https://office.acemark.com.pl`.
   Until DNS resolves, the `*.onrender.com` URL keeps working.

**If you use Microsoft SSO**, after the domain is live add the new URLs to:
- **Supabase** → Authentication → URL Configuration → **Redirect URLs**:
  `https://office.acemark.com.pl` and `https://office-test.acemark.com.pl`.
- **Azure** app registration → Authentication → **Redirect URIs**: the same two URLs.
The app already builds its redirect from the current address, so nothing in code changes.

---

## B. Day-to-day workflow

1. **Build on `main`.** Every push auto-deploys **test** (`ace-office-test`). Bump the version
   markers as usual.
2. **Test** with Antek on the test URL (orange **TEST** badge, so it's unmistakable).
3. **Apply any new migration** to the **prod** Supabase project.
4. **Release to prod:** merge `main` into `release` and push — that deploys prod:
   ```bash
   git checkout release && git merge main && git push
   git checkout main
   ```
5. **Rollback** if needed: Render keeps a deploy history per service — click a previous deploy
   → **Redeploy**. (Or revert the `release` branch.)

---

## C. Notes & gotchas

- **The TEST badge.** `APP_ENV=test` shows an orange **TEST** chip in the header + on the login
  screen, an orange stripe under the header, and `[TEST]` in the browser tab. Prod shows a plain
  `PROD` chip. This is the fastest way to know which one you're in.
- **Free test sleeps.** The test service is on Render's free plan — after ~15 min idle the first
  request takes 30–60s to wake. Prod is on a small paid plan and stays warm.
- **Secrets stay server-side.** `SUPABASE_SERVICE_ROLE_KEY` and `MONDAY_API_TOKEN` live only in
  Render's environment, never in the browser. The `anon` key is public by design.
- **Keep schemas in sync.** The single most important discipline: apply each migration to test,
  then to prod at release. A prod feature that reads a missing column will error.
- **Mobile app.** If you also want a test build of the phone app, point its `.env`
  (`EXPO_PUBLIC_SUPABASE_URL` / `ANON`) at the **test** Supabase project.
- **Cost.** Test = free. Prod = Render's small "Starter" instance (a few $/month) so it stays
  warm. No database cost — Supabase's free tier covers early usage.
