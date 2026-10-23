# ACE office / FitAWindow — set up a Windows laptop for development (run once, in PowerShell).
#   Right-click Start > Terminal (or PowerShell), then:
#     Set-ExecutionPolicy -Scope Process Bypass -Force; & "$HOME\Downloads\setup-windows.ps1"
# What it does: installs Git and Node.js (if missing, with winget), clones the repo to C:\apps\ace-fieldapp, turns
# on the pre-push check, installs the packages, runs the checks, and creates Claude's memory notes for this project.
# What it does NOT do: copy the secret .env files — copy those yourself from the Mac (USB / password manager).
$ErrorActionPreference = 'Stop'
$Root = 'C:\apps'; $Repo = Join-Path $Root 'ace-fieldapp'
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

Step 'Git and Node.js'
if (-not (Have git)) { winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements; RefreshPath }
if (-not (Have node)) { winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements; RefreshPath }
if (-not (Have git) -or -not (Have node)) { Write-Host 'Git or Node.js is still not found — close this window, open a new one and run the script again.' -ForegroundColor Yellow; exit 1 }
Write-Host ("git " + (git --version) + " · node " + (node -v))

Step "Folders: $Root"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'from-mac') | Out-Null   # for the loose files from the Mac (optional)

Step 'Project'
if (-not (Test-Path (Join-Path $Repo '.git'))) { git clone https://github.com/acemarkdev/fieldapp.git $Repo } else { git -C $Repo pull --ff-only }
git -C $Repo config core.hooksPath .githooks
git -C $Repo config user.name 'Radek Dering'
git -C $Repo config user.email 'radek.d@acegroup-uk.com'

Step 'Packages (a few minutes)'
Push-Location $Repo
npm install
Step 'Checks'
npm run check
Pop-Location

Step "Claude's notes for this project"
# Claude Code keeps per-project notes in %USERPROFILE%\.claude\projects\<folder name>\memory; for C:\apps\ace-fieldapp
# the folder is C--apps-ace-fieldapp. If Claude later uses another name, tell Claude to look here.
$Mem = Join-Path $HOME '.claude\projects\C--apps-ace-fieldapp\memory'
New-Item -ItemType Directory -Force -Path $Mem | Out-Null
@'
- [monday production board → Job costs](ace-monday-production-board.md) — Z import button, column mapping, duplicate rules
- [FitAWindow phone releases](ace-phone-release.md) — OTA vs store build, iOS submit via ASC API key (no Apple ID login)
- [Verify prod is live](ace-verify-prod-live.md) — after move to prod, poll office.acemark.com.pl for the new version before saying it's live
'@ | Set-Content -Encoding utf8 (Join-Path $Mem 'MEMORY.md')
@'
---
name: ace-monday-production-board
description: "Job costs ◂ monday board PRODUCTION ACEMARK PL (3576361679) — column mapping and import rules (v1.32.0, live on prod 2026-10-19)"
metadata:
  type: project
---

New Z jobs are created on monday board 3576361679 "PRODUCTION ACEMARK PL". Job costs has a manual "Load from monday" button (admin, no schedule — user wanted a button only). Built in `apps/api/src/mondayJobs.ts`.

Mapping: item name starts with Z number → job "Z.NNN"; `numbers__1` Wartosc Zlecenia → budget offer_net; `numeric_mm6rgrgy` Godziny zalozone → budget labour_hours × default labour rate; `dropdown0__1` ODBIORCA → customer; item created date → period month/year.

Rules the user chose: Z numbers appearing more than once on the board (sub-orders like Z.102_FAZA_1/2, Z.214.b) are excluded; only Zs missing from Job costs are created; existing jobs' empty budgets are filled only if ticked. First load done on prod 2026-10-19 ("works, loaded").
'@ | Set-Content -Encoding utf8 (Join-Path $Mem 'ace-monday-production-board.md')
@'
---
name: ace-phone-release
description: FitAWindow phone releases — OTA vs store build, iOS submit via ASC API key (never Apple ID login: Keychain lock -20209)
metadata:
  type: project
---

FitAWindow (apps/mobile, Expo) — user runs the commands himself.
- OTA: `npm run update:test|prod -- "msg"` (scripts/ota.mjs, passes --environment; works on Windows since 2026-10-23). runtimeVersion = app version, so OTA only reaches phones on exactly that version. The repo is on **0.76.0** (store build); 0.76.1 = ACE Scaffolding crew screen, over the air.
- Store: `npx eas-cli build --platform all --profile production --auto-submit` (runs in Expo's cloud — works from Windows, iOS too); answer **no** to Apple login and to emulator prompts. Android goes to Play internal → user promotes to staff track.
- iOS submit uses an **App Store Connect API key stored on EAS** and `ascAppId` 6823690829 in eas.json — no Apple ID password. Logging in with the Apple ID locked the account (-20209) twice. If a submit fails: `npx eas-cli submit --platform ios --latest`.
'@ | Set-Content -Encoding utf8 (Join-Path $Mem 'ace-phone-release.md')
@'
---
name: ace-verify-prod-live
description: After "move to prod" (push to release), always confirm office.acemark.com.pl actually serves the new version before saying it's live
metadata:
  type: feedback
---

After pushing `origin/main:release`, poll https://office.acemark.com.pl/ until the page contains the new APP_VERSION, then report it live.

**Why:** on 2026-10-21 Render's auto-deploy of `release` did not run; the user had to deploy manually in Render and asked: "always check prod is live after pushing".

**How to apply:** every "move to prod" — push, then check for up to ~5 min; if still old, tell the user Render did not deploy and suggest a manual deploy / Auto-Deploy setting. Same for test (office-test.acemark.com.pl) when it matters.
'@ | Set-Content -Encoding utf8 (Join-Path $Mem 'ace-verify-prod-live.md')
Write-Host "Notes written to $Mem"

Step 'Still to do by hand'
$missing = @(
  @{ f = Join-Path $Repo '.env'; what = 'test database + monday token (from the Mac: ~/apps/ace-fieldapp/.env)' },
  @{ f = Join-Path $Repo '.env.prod'; what = 'prod database (from the Mac: ~/apps/ace-fieldapp/.env.prod)' },
  @{ f = Join-Path $Repo 'apps\mobile\.env'; what = 'phone app, test database (from the Mac: ~/apps/ace-fieldapp/apps/mobile/.env)' }
) | Where-Object { -not (Test-Path $_.f) }
foreach ($m in $missing) { Write-Host ("  copy  " + $m.f + "   — " + $m.what) -ForegroundColor Yellow }
if (-not $missing) { Write-Host '  the three .env files are in place' -ForegroundColor Green }
Write-Host "  phone app: cd $Repo\apps\mobile; npx eas-cli login   (account radekthering)"
Write-Host "  optional:  loose files from the Mac (koszty-import.tsv, spec-matrix.html, *-powerapp.zip) -> $Root\from-mac"
Write-Host "`nDone. Open $Repo as the working folder in the Claude app." -ForegroundColor Green
