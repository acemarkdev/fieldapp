# ACE Field App

Field survey platform for windows & doors fitting jobs.
Mobile capture (iPhone/iPad) + office web app (Chrome) on a multi-tenant Supabase store,
syncing to Monday.com (and, later, fabricator quote/order systems).

Built to be SaaS-ready from line one: every record carries a `tenant_id` and is protected by
Row-Level Security. ACE is tenant #1.

## Monorepo layout

```
ace-fieldapp/
├─ packages/
│  └─ shared/            # TypeScript types + domain logic (codes, ranking, rates) — shared everywhere
├─ apps/
│  ├─ mobile/            # Expo / React Native app (iPhone/iPad)         [Sprint 1+]
│  ├─ web/               # React office web app (Chrome)                 [Sprint 3]
│  └─ api/               # Sync API + Monday integration (Node)          [Sprint 1]
├─ supabase/
│  ├─ migrations/0001_init.sql   # multi-tenant schema + RLS
│  └─ seed.sql                   # ACE tenant, jobs, teams, sample catalogue
├─ .env.example
└─ package.json          # npm workspaces
```

## Status — Sprint 0 (foundations) ✅

- ✅ Multi-tenant database schema + Row-Level Security (`supabase/migrations/0001_init.sql`)
- ✅ Seed data — ACE as tenant #1 (`supabase/seed.sql`)
- ✅ Shared types + domain logic with passing tests (`packages/shared`)
- ⏳ Next (Sprint 1): the thin end-to-end slice — log in → scan → survey one item → it appears on the live Monday board.

## Setup (≈15 minutes)

**Prerequisites:** Node 20+, the [Supabase CLI](https://supabase.com/docs/guides/cli), and a Supabase project (you've created one).

```bash
# 1. Install dependencies
npm install

# 2. Run the shared-logic tests (should print "All 6 domain tests passed")
npm --workspace @ace/shared run test

# 3. Point the Supabase CLI at your project
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# 4. Apply the schema + seed
supabase db push                       # runs supabase/migrations
psql "$DATABASE_URL" -f supabase/seed.sql   # or paste seed.sql into the Supabase SQL editor

# 5. Copy env template and fill in your keys
cp .env.example .env
```

## Fast local install — office app only ⚡

`npm install` at the repo root installs **every** workspace, including `@ace/mobile`
(Expo / React Native). That pulls hundreds of MB and runs native build scripts, so it can take
several minutes — that slowness is the mobile dependencies, **not** the office code.

To run or deploy the **office web app** you don't need the mobile app at all. Install just the two
workspaces it uses — this is much faster:

```bash
cd ace-fieldapp
npm install -w @ace/api -w @ace/shared --ignore-scripts
```

Then start the office app (reads keys from `.env`):

```bash
npm run office -w @ace/api
```

Only install the **mobile** app when you're building FitAWindow for the Play Store — and do that
from inside `apps/mobile`, not the repo root:

```bash
cd apps/mobile
npm install
EAS_BUILD_NO_EXPO_GO_WARNING=true npx eas-cli@latest build -p android --profile production
```

**Is a slow install stuck, or just working?** In a second terminal run this twice a few seconds
apart — if the size keeps growing, it's fine, not hung:

```bash
du -sh node_modules
```

> Production deploys go **GitHub → Render**, and Render runs its own install on its servers, so a
> slow install on your Mac never affects the live office app. Local installs are only for testing.

## Applying database migrations

New features often need a Supabase migration (each `supabase/migrations/00NN_*.sql`). Apply any you
haven't run yet, in order, either with `supabase db push` or by pasting the file into the Supabase
SQL editor. Run on your **test** project first, confirm the app works, then run the same on
production. Recent ones: `0034` (Excel import), `0035` (duplicate job codes / Site code key),
`0036` (mark Excel-imported items).

Then push this folder to your GitHub repo:

```bash
git init && git add . && git commit -m "Sprint 0: schema, shared logic, scaffold"
git branch -M main
git remote add origin git@github.com:YOUR_ORG/ace-fieldapp.git
git push -u origin main
```

## What each person does

- **Claude builds:** the schema, shared logic, the Sync API, the Monday integration, the mobile and web apps, tests.
- **You (Radek):** hold accounts & secrets (Supabase, Monday API token, Apple), run the migrations, review, and handle the App Store release.

## Security notes

- The `SUPABASE_SERVICE_ROLE_KEY` and `MONDAY_API_TOKEN` are **server-side only** — they never ship inside the mobile or web app.
- Tenant isolation is enforced in the database by RLS, not just in application code.
- `.env` is git-ignored. Never commit real secrets.
