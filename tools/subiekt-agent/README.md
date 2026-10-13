# Subiekt nexo agent

A small PowerShell script that runs on the machine where Subiekt's SQL Server is reachable. Every
30 minutes it reads this year's sales invoices (FS, FL, KFS, KFL) and material issues (RW) with a
**read-only** SQL login and posts them to the office app (`POST /api/agent/subiekt`). It writes
nothing to Subiekt and opens no ports: outgoing HTTPS only.

What the office app does with the documents is in `apps/api/src/subiekt.ts` (rules + tests).

## Install

1. Copy `ace-subiekt-agent.ps1` to a folder on the Subiekt machine, e.g. `C:\ACE\subiekt-agent\`.
2. In the office app (admin): Fin&Ops ▸ Sales ▸ **Subiekt** ▸ *Create a new agent key*. Copy it.
3. Open PowerShell **as administrator** in that folder and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\ace-subiekt-agent.ps1 -Setup
   powershell -ExecutionPolicy Bypass -File .\ace-subiekt-agent.ps1 -Preview
   powershell -ExecutionPolicy Bypass -File .\ace-subiekt-agent.ps1
   powershell -ExecutionPolicy Bypass -File .\ace-subiekt-agent.ps1 -Install
   ```

   `-Setup` asks for the server, database, SQL login, office address, start date, SQL password and
   agent key. `-Preview` reads and prints without sending. The third line is one real sync.
   `-Install` registers the scheduled task (runs as SYSTEM, whether or not anyone is logged in).

`config.json` holds the settings; `secrets.bin` holds the SQL password and the agent key, encrypted
with Windows DPAPI for this computer. `agent.log` has one line per run.

To point a test run at the test site, set `url` in `config.json` to `https://office-test.acemark.com.pl`
and use a key created on the test site.
