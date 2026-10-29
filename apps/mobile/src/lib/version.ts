// Bump this on every mobile change so the running app shows what's actually loaded.
// Displayed on the login screen and in the top bar.
// 0.66.0 — Mapping comes to the field app: on a job's Items screen, tap "Map" to build an
//   elevation × floor grid (GF first), enter window/door counts per floor with a live
//   Windows·Doors·Items total, then Preload to bulk-create items — matching the office app.
//   iPad-oriented; a phone-friendly stepper follows. No migration.
// 0.67.0 — Import from Excel in the field app: from Mapping, pick an .xlsx survey sheet,
//   review each row (Complete / Unfinished with the missing fields listed), fix any row
//   inline, then Upload to Items (missing data flagged Unfinished). Also "Delete imported".
//   Requires: npx expo install expo-document-picker expo-file-system  +  npm i xlsx.
// 0.68.0 — Map a job from the Jobs list: a "Map" action opens a picker of jobs that have no
//   items yet, grouped Live / Pending / Done by programme date (mirrors the office picker).
//   Pick one to jump straight into building its plan. No migration.
// 0.69.0 — Mapping on iPhone: a compact step-by-step flow (set scope → walk each floor entering
//   window/door counts with a running total and progress bar → review & Preload). Tablets keep
//   the full grid; the app picks the layout by screen width. Same items either way. No migration.
// 0.70.0 — Mapping works offline: if there's no signal, Preload / Upload-to-Items save the
//   records to the same pending queue as new items and sync automatically when back online
//   (duplicates are dropped on sync). No migration.
// 0.71.0 — Fix: on the iPad mapping grid the Preload/Clear buttons are now pinned to a fixed
//   footer, so they're always visible and tappable no matter how many elevations you add
//   (previously they scrolled off the bottom and wouldn't respond to taps). No migration.
// 0.71.1 — Same Preload-button fix for the iPhone step-by-step flow: on the Review step the
//   Preload button is now pinned to a fixed footer instead of the bottom of a flex:1 scroll
//   view, so it's reachable and tappable with any number of elevations. No migration.
// 0.72.0 — Fitter and surveyor changes from site feedback.
//   Fitter: (1) My schedule has a flat search — type a flat number to see everything still
//   Scheduled there across all the team's jobs (for swapping when a tenant is out). (2) The item
//   screen shows two big buttons, Installed and Delayed, instead of the status list; raising a
//   snag sets the item to Installed + snag. (3) The window type + style sketch and (4) the plan
//   with pins are shown on the item. (5) The item's name as on the PO ("Flat 12 Bathroom") sits
//   under Raise a snag.
//   Surveyor: (6) Plan screen — add a plan by photo, gallery or file, place mapped items as pins,
//   tap a pin to open the item and add its details.
//   Requires migration 0062_plans_surveyor.sql (surveyor may create plans).
// 0.72.1 — Build only, no change to screens: release builds now shrink and obfuscate the Android
//   code (R8), which Google Play asks for ("DEX code optimisation"). Needs a new store build.
// 0.73.0 — Production time: users with the Production role see only the time screen — search a
//   job's tasks, Start, Stop (starting another task stops the running one); hours today and recent entries.
// 0.73.1 — Login: the email is lowercased before sign-in (as the office app does), the real error is
//   shown, and the login screen says which database the build uses (TEST / PROD).
// 0.74.0 — Production time: compact clock box, "Moje zadania" (last 6 tasks used, Z number + task, one tap
//   to switch), today's entries can be corrected (start/end time ±1/±15 min or typed, never the date) and
//   commented (100 characters); older entries are locked (the production manager changes them).
// 0.75.0 — Scanners may add a plan from the phone (migration 0082). The demo gets a "View as" bar —
//   Office · Surveyor · Fitter · Production — with today's schedule and sample production tasks. Over-the-air
//   updates (expo-updates): later JavaScript-only fixes reach phones without a store release.
// 0.75.1 — Production managers can sign in on the phone too and get the same time screen as
//   production workers (log their own time). Needs migration 0084.
// 0.75.2 — Production time: a task whose name already starts with its job number (Z_437_cnc_…) is shown
//   without the job in front again ("Moje zadania", the running task, the correction sheet).
// 0.76.0 — Warehouse returns (Zwroty), QR scanning (expo-camera) — store build.
// 0.76.1 — ACE Scaffolding crews (role Scaffolder; also the scaffolding office, and admin via "crew screen"): My day —
//   the visits of my crews (or all crews) per day; a visit shows the site (tap → maps), the contact (tap → call) and
//   the scaffolds; Done (a dismantle reports the day the hire stops), Handover with the client's finger signature
//   (the hire starts, the certificate is made in the office app), delivery / collection notes per item, and the
//   7-day inspection (safe / not safe, defects, actions, up to 4 photos). Inspections due tab. Talks to the office
//   server (EXPO_PUBLIC_OFFICE_URL). Over the air on 0.76.0; needs office 1.48.0 and migrations 0101 + 0102.
// 0.76.2 — Warehouse: once a Z order is typed, the list under Wydania / Zwroty shows only that order's rows (link
//   "Pokaż wszystkie zlecenia" for all). Production time: entries of the last 7 days can be corrected (before: only
//   today; deleting stays today-only) — needs migration 0104; each task in Moje zadania can get the worker's own name
//   (✎, kept on this phone only — the office and the export keep the real name). Android: the edit sheets and the
//   warehouse form move above the keyboard (edge-to-edge no longer resizes the window). Over the air on 0.76.0.
// 0.76.3 — Production time: an entry can be moved to another task (as in Clockify) — in Moje wpisy ▸ Zmień, "Zmień
//   zadanie" picks from Moje zadania or a search of all open tasks; last 7 days and the running entry too. The entry
//   takes the task's name and job (Job costs labour follows); refused when either job is locked in Job costs. Needs
//   migration 0105. Over the air on 0.76.0.
// 0.76.4 — Production time: the first line of Moje zadania, "Bez zadania", starts the clock without a task; the task
//   is picked later (the running card's "Wybierz zadanie", or the entry in Moje wpisy — it opens on the task list).
//   Moje wpisy warns about entries still without a task. Such an entry counts in no job's labour until a task is set
//   (by the worker within 7 days, or by the production manager in the office). Needs migration 0106 (which also gives
//   the warehouse role back its time corrections). Over the air on 0.76.0.
// 0.76.5 — Production time, WEM: a task made from a WEM order asks the time type at START (Praca / Przezbrojenie /
//   Poprawka) and the quantity done at STOP — also when another task is started over it (work: prefilled with what is
//   left of the plan; setup: 0). Tasks show the workstation and “zrobione x / planned”, in the order of the work;
//   Moje wpisy show type and quantity and can correct them. Needs migrations 0114 and 0115; without them nothing changes.
// 0.76.6 — WEM: the "Ilość wykonana" field at STOP and in the entry correction is full height on Android (it was a
//   sliver that hid what was typed). Over the air on 0.76.0.
export const APP_VERSION = '0.76.6';
