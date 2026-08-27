# Install the ACE office app on another Mac

The office app is a small Node server (it serves the web app and talks to Supabase + Monday).
You just need Node, the project files, and your `.env` secrets. It points at the **same
Supabase project** as your other Mac, so there's no separate database to set up.

## What to move
- **`ace-fieldapp-0.40.0.zip`** — the project (this is what you were given; it does *not*
  include `node_modules` or your secrets).
- **Your `.env` file** — copy it from the **current** Mac. It holds the Supabase
  service-role key and Monday token, so move it directly (AirDrop / USB / secure transfer),
  **not** through email or chat. If you can't find it, you can recreate it from
  `.env.example` (see step 4).

---

## Steps (Terminal on the new Mac)

### 1. Install Node 20+ (once)
If you don't already have it. Easiest via Homebrew:
```bash
# install Homebrew if you don't have it:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node        # installs a current Node (22.x)
node -v                  # confirm it prints v20.x or newer
```
(Or download the macOS installer from https://nodejs.org — the "LTS" build.)

### 2. Unzip the project
```bash
cd ~/                              # or wherever you want it to live
unzip ~/Downloads/ace-fieldapp-0.40.0.zip
cd ace-fieldapp
```

### 3. Install dependencies
```bash
npm install -w @ace/api
```
This installs just what the office server needs (skips the mobile/Expo toolchain). If it
complains, fall back to a full install: `npm install`.

### 4. Put your secrets in place
Copy the `.env` you brought over into the project root (same folder as `package.json`):
```bash
cp /path/to/your/.env  ./.env      # e.g. cp ~/Downloads/.env ./.env
```
If you don't have it, create one from the template and fill in the values from your
Supabase project (Settings → API) and Monday:
```bash
cp .env.example .env
open -e .env                        # edit: SUPABASE_URL, SUPABASE_ANON_KEY,
                                    #       SUPABASE_SERVICE_ROLE_KEY, MONDAY_API_TOKEN
```

### 5. Start the office app
```bash
node --env-file=.env --import tsx apps/api/src/office.ts
```
You'll see:
```
  ACE office app  →  http://localhost:3000
```
Open **http://localhost:3000** in a browser and log in with your ACE account.
Leave that Terminal window open while you're using the app; press **Ctrl+C** to stop it.

---

## Handy extras

- **Different port** (if 3000 is busy):
  ```bash
  PORT=4000 node --env-file=.env --import tsx apps/api/src/office.ts
  ```
- **Make it one short command** — add a script so you can just type `npm run office`.
  Open `apps/api/package.json` and ensure the `"office"` script loads the env file:
  ```json
  "office": "node --env-file=../../.env --import tsx src/office.ts"
  ```
  then run it from the repo root with `npm run office -w @ace/api`.
- **Create the first admin** (only if this is a brand-new Supabase project, not your case):
  ```bash
  node --env-file=.env --import tsx apps/api/src/create-admin.ts
  ```
- **Live wallboard** (optional): set `LIVE_KEY=something` in `.env`, then open
  `http://localhost:3000/live?key=something`.

## Notes
- The app needs an internet connection (it talks to your Supabase project).
- Keep `.env` private — it contains the service-role key. It's already git-ignored.
- This is the **office** app only. The **mobile** app is published/installed separately
  (see `docs/google-play-publishing.md`).
