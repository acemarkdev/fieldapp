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
