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
export const APP_VERSION = '0.71.1';
