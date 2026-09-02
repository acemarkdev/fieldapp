// Single source of truth for the app version, shared by web (and later mobile).
// Bump APP_VERSION and add a CHANGELOG entry whenever we ship a change.
//   MAJOR.MINOR.PATCH — MINOR for new features, PATCH for fixes/tweaks.
export const APP_VERSION = '0.62.2';

export interface ChangelogEntry { version: string; date: string; changes: string[]; }

export const CHANGELOG: ChangelogEntry[] = [
  { version: '0.62.2', date: '2026-09-01', changes: [
    'Fix: Floor now keeps its F. Mapping preload and Save, and the bulk Floor update, were stripping the F and storing just the number (so a Floor you set as F1 showed as 1 in the table and on items). Floor is now stored and shown with its F (1 is normalised to F1; labels like GF are kept). To correct items saved before this fix, select them and bulk-set Floor again. (Flat still stores a bare number as it feeds price grouping.)',
  ] },
  { version: '0.62.1', date: '2026-09-01', changes: [
    'QA: added 48 test scenarios (T-107..T-154) to the in-app Test tab covering everything since v0.44 - reports & customer install PDF, customer portal, doors rate, retire team, the new-item prefixes/room picker, Items filters and inline code editing, bulk field apply, photo routing (office + mobile), the scanner mapping workflow, full item spec editing, Monday column auto-provisioning and the activity log.',
  ] },
  { version: '0.62.0', date: '2026-09-01', changes: [
    'Activity log (first step). A new admin-only Logs tab records who did the high-value actions: item created / edited / deleted, items synced to Monday, mapping saved, jobs created / deleted, and board linked. Each entry shows when, which user, their role, the action and a short summary, with a search box. Backed by a small audit_log table (migration 0025); more actions can be added over time.',
  ] },
  { version: '0.61.0', date: '2026-09-01', changes: [
    'Items tab: the ITEM column header now has a filter too.',
    'Floor no longer forces an F. In the New survey item form and the Mapping table, the auto-F only applies to a plain number (1 -> F1); type a label like GF and it stays GF (no more FGF). Same smart behaviour for Block/Elevation/Flat letters.',
  ] },
  { version: '0.60.0', date: '2026-08-31', changes: [
    'Mapping table: added a manual Flat column next to Floor. If you fill Flat it becomes the F-segment of the code (replacing the mapping floor); leave it blank to keep the floor. Both Floor and Flat are saved on the item. Added a Clear all button on the table (alongside the per-row delete). And switching to the Items tab now always refreshes the list, so items you just saved from Mapping show up immediately.',
  ] },
  { version: '0.59.0', date: '2026-08-31', changes: [
    'Auto-provision Monday columns on board link. When you link a Monday board to a job (Sync tab), the app now checks the board and creates any missing required columns automatically — Picture Before/After, Design Sketch, Labour Cost, and every item field the sync writes (Block, Elevation, Flat/Plot No., Floor, Item, Room, Item Type, Window Type, Material, Glass, sizes, transoms, mullions, comments, install status, fitters, etc.). It matches by column title and only creates the ones that are absent, then tells you how many it added. No more prepping each real job board by hand.',
  ] },
  { version: '0.58.3', date: '2026-08-31', changes: [
    'Plan PDFs: the numbered pins are smaller and semi-transparent, so the window they mark stays visible underneath instead of being hidden behind a solid dot.',
  ] },
  { version: '0.58.2', date: '2026-08-31', changes: [
    'Items tab: the STAGE column header now has a filter too (Scanned / In survey / Surveyed / Synced), matching the other column filters.',
  ] },
  { version: '0.58.1', date: '2026-08-31', changes: [
    'Item drawer: the Save details button is now a sticky footer, always visible while you scroll the form. Bulk toolbar tidy-up: the seven Set boxes are replaced by one Field picker + a value box + Apply, and the actions (Sync selected, Delete, Clear) sit on their own row, separated from the field editing.',
  ] },
  { version: '0.58.0', date: '2026-08-31', changes: [
    'Full item editing in the office. The item drawer now has an editable Specification form matching the phone/New-item fields — design code (with the style picker), material, item type, window type, glass, safety glass, glazing, width/height/cill, open in/out, transoms, mullions, coupled, add-ons and comments — with a Save details button. This means an item mapped by a scanner (code only) can be completed in the office: add measures, window types and the rest. Editing marks the item for re-sync to Monday.',
  ] },
  { version: '0.57.1', date: '2026-08-31', changes: [
    'Bulk assign now includes Flat as well (Block, Elevation, Floor, Flat, Room). Setting Flat in bulk rebuilds each item code with the Flat as the F-segment; synced items and code clashes are skipped.',
  ] },
  { version: '0.57.0', date: '2026-08-31', changes: [
    'Bulk assign now covers Floor and Room too (not just Block/Elevation). Select items, type a value in the toolbar and press Set. Because Floor and Room are part of the code, bulk-setting them rebuilds each item code (Floor becomes the F-segment); items already synced to Monday are skipped, as are any that would clash with an existing code. The toolbar wraps so all the Set boxes fit.',
  ] },
  { version: '0.56.0', date: '2026-08-31', changes: [
    'Items tab: Flat and Room are now editable inline (with a Room column filter too), and editing them rebuilds the item code — the Flat becomes the F-segment (replacing the mapping floor) and the Room slots in before the item, e.g. AXS.LAB.B1.E1.F1.W1 -> after Flat 2 + Room LR -> AXS.LAB.B1.E1.F2.LR.W1. Codes can be edited until the item is synced to Monday, after which Flat/Room lock (un-sync to change). Duplicate codes are blocked.',
    'Items tab layout: the left Jobs panel can be hidden/shown with the "Jobs" toggle, and the items table scrolls horizontally, so the extra Block/Elevation/Floor/Room columns fit on smaller screens.',
  ] },
  { version: '0.55.0', date: '2026-08-31', changes: [
    'Items tab: Block, Elevation and Floor columns, each with a header filter (like Flat/Status/Team). And a bulk assign-to-all: select items, type a Block and/or Elevation in the toolbar and press Set to apply it across them (sets the field for filtering/reporting; it does not rewrite existing item codes).',
    'Fix: mapped items no longer show Flat=1. The mapping "floor" is now stored in the Floor field instead of Flat, so the Items tab reads correctly; the code still shows F{floor} (e.g. AXS.LAB.B1.E1.F1.W1). Applies to items mapped from this version on.',
  ] },
  { version: '0.54.1', date: '2026-08-31', changes: [
    'Mapping tweaks: the Save button now sits in a fixed footer under the table (visible as soon as you Preload) with a live item count. Coupling is now explicit — tick Couple, set the count, then press Add on that row to split it into the numbered lines (W2 x2 -> W2.1, W2.2) so you can see and edit them before saving. A running total (floors, windows, doors, items) shows under the floor rows. And a non-numeric floor like GF no longer gets an F prefix (stays GF, not FGF).',
  ] },
  { version: '0.54.0', date: '2026-08-31', changes: [
    'Scanner mapping workflow. New jobs start as \'New\' and are hidden from scanners; an admin assigns a mapping start date (Mapping tab) which flips the job to \'Pending mapping\' and reveals it to scanners. In the Mapping tab a scanner sets Block and Elevation (defaults for the batch), then adds a row per floor with the number of windows and doors; a new row opens automatically as each is filled. Preload builds one line per item (e.g. Block 1 / Elevation 1 / Floor 1 with 3 windows + 1 door -> AXS.LAB.B1.E1.F1.W1..W3 and .D1). Each line can be edited, deleted, or marked Couple with a count to split it (W2 x2 -> W2.1, W2.2). Save creates the items; the job stays Pending mapping so more can be pre-loaded.',
    'Fix: photo kinds. Added the \'before\' and \'after\' values to the photo_kind database type so the Picture Before / Picture After routing (v0.52) actually saves. Requires migration 0024.',
  ] },
  { version: '0.53.0', date: '2026-08-31', changes: [
    'Mobile photos route to Monday by role too. A photo taken in the phone app by a scanner or surveyor now goes to the board\'s "Picture Before" column; a fitter\'s photo goes to "Picture After" — matching the office app. Snag defect photos are unchanged (Design Sketch). Previously all phone photos went to Design Sketch.',
  ] },
  { version: '0.52.0', date: '2026-08-31', changes: [
    'Office photos route to the right Monday column by role. A photo added in the office by a scanner or surveyor now goes to the board\'s "Picture Before" column; one added by a fitter goes to "Picture After". They no longer use "Design Sketch". The item drawer shows which column your photo will land in before you upload. (Legacy mobile survey shots and snag sketches still use Design Sketch.)',
  ] },
  { version: '0.51.0', date: '2026-08-31', changes: [
    'Add photos to an item from the office app. The item drawer now has an \'Add photo\' button, so you can attach a photo straight from a laptop or iPad/Chrome without the phone. It saves to the same store as the mobile app and syncs to Monday when the item is pushed.',
  ] },
  { version: '0.50.0', date: '2026-08-31', changes: [
    'New survey item: Room is now a picker, sorted by how often you use each room. Instead of typing a code from memory, pick the room from a dropdown that shows the full name and code (e.g. "Kitchen (KT)"). The list is ordered by how many times each room has been used across all jobs — your most common rooms float to the top — with the rest alphabetical. Two rooms were added: Lounge (LG) and WC. Any older code not in the standard list still appears so nothing is lost.',
  ] },
  { version: '0.49.2', date: '2026-08-31', changes: [
    'New survey item: Floor now auto-adds its F too — type "1" and the field shows "F1", matching Block/Elevation/Flat.',
  ] },
  { version: '0.49.1', date: '2026-08-31', changes: [
    'New survey item tweaks. Block, Elevation and Flat now auto-add their letter as you type — type "1" and the field shows "B1" / "E1", type "21" and Flat shows "F21" (still stored as the bare number). And picking a style now fills Item type with Window/Door (it was going into Window type by mistake).',
  ] },
  { version: '0.49.0', date: '2026-08-31', changes: [
    'New survey item: code fields auto-capitalise. In the New survey item form, the location fields that build the code (block, elevation, flat, floor, room, item) now turn what you type into capitals automatically, so codes stay consistent without holding Shift.',
  ] },
  { version: '0.48.0', date: '2026-08-31', changes: [
    'Filter the Items list by Team. The TEAM column header now has a dropdown, alongside the existing Flat and Install status filters. It lists the teams actually present on the current job\'s items (plus "— no team —"), and combines with the other column filters and the chip filters at the top.',
  ] },
  { version: '0.47.0', date: '2026-08-31', changes: [
    'Retire a team instead of deleting it. A team with items assigned still can\'t be deleted (it would orphan their rates and history), but you can now Retire it from Teams & rates. A retired team stays on its existing items, reports and the calendar, but is hidden from every new-assignment dropdown (items list, bulk assign, new item, and the fitter\'s team in Users). It shows greyed with a "retired" tag and can be reactivated anytime; if an item still points at a retired team, that team stays visible in its own dropdown marked "(retired)".',
  ] },
  { version: '0.46.0', date: '2026-08-31', changes: [
    'Separate fitter rate for Doors. Each team now has two rates in Teams & rates: a Windows rate (the existing default) and a Doors rate (default £120). An item is paid at its team\'s rate for its category — doors are detected from the item type/code — while a per-item rate override still beats both. The rate that flows to Monday\'s Labour Cost, the install PDFs, and the phone app all follow this automatically. Existing teams were seeded with a £120 doors rate; adjust per team as needed.',
  ] },
  { version: '0.45.0', date: '2026-08-31', changes: [
    'Customer self-service portal. A new "Customer" role gives a client a read-only login that shows only their own jobs (matched by the CLIENT part of the job code, e.g. AXS) and lets them download the rate-free "Customer install PDF" for each — no teams, rates, dashboard, or anyone else\'s jobs. Set a customer up in Users: add them with the Customer role, then fill in their CLIENT code. The boundary is enforced three ways: the role sees only the portal, the server whitelists just the customer endpoints, and database RLS scopes their rows even on a direct query.',
  ] },
  { version: '0.44.0', date: '2026-08-31', changes: [
    'Reports: full code shown, and a customer-safe install PDF. The items table Code column now shows the full item code in full (it wraps instead of truncating) on both PDFs. The install report button is renamed "Internal install PDF" (it still shows teams + rates), and a new "Customer install PDF" produces a rate-free copy (no Team, no Rate, no labour total) that is safe to send a customer. Both are on the Plans tab.',
  ] },
  { version: '0.43.2', date: '2026-08-28', changes: [
    'Plans: prevent uploading a plan to the wrong job. Plans belong to the job selected in the Plans tab, and that selector persists — so plans meant for another job could get filed under whatever job was showing. Upload now asks "Add this plan to job X?" first. The PDF report also double-checks that every plan it embeds belongs to the job (belt-and-braces). If plans were already misfiled, delete the strays from Plans → Delete plan.',
  ] },
  { version: '0.43.1', date: '2026-08-28', changes: [
    'Deploy config: custom domains. The Render blueprint now serves prod at office.acemark.com.pl and test at office-test.acemark.com.pl; docs/deploy-test-prod.md has the CNAME/DNS steps (and the SSO redirect URLs to add). Config/docs only — no app change.',
  ] },
  { version: '0.43.0', date: '2026-08-27', changes: [
    'Test/Prod deployment setup. The office app now reads an APP_ENV flag and shows a clear TEST badge (orange, in the header + login + browser tab) so the test and live copies are unmistakable. Added a Render blueprint (render.yaml) that defines two cloud services — test (from main) and prod (from a release branch), each pointing at its own Supabase project and Monday board — plus docs/deploy-test-prod.md with the full setup and release workflow. tsx moved to runtime deps and a start script added so it runs on a host.',
  ] },
  { version: '0.42.1', date: '2026-08-27', changes: [
    'Fix: the on-screen Budget breakdown (and the Variations tick boxes) were blank. The breakdown view referenced a helper (stat) that lives in the separate /live wallboard script, so it threw "stat is not defined" and never rendered — the customer-price PDF was unaffected, which hid the bug. Inlined the summary cards so the breakdown and the Variations list now show. Present since 0.36.0.',
  ] },
  { version: '0.42.0', date: '2026-08-27', changes: [
    'Items tab: Flat column + header filters. The office items table now shows a Flat column, and the Flat and Install-status column headers each have a dropdown to filter the list (e.g. show only flat 21, or only Installed). The item counter reflects the filtered view, so an invoice manager can quickly validate how many items are in each flat and at each status. Filters reset when you switch jobs.',
  ] },
  { version: '0.41.2', date: '2026-08-27', changes: [
    'Fix: the Users tab now lets you assign the invoice manager role. Two hard-coded role lists in the office had never been updated, so invoice_manager showed on the Roles matrix but couldn\'t actually be assigned (the server rejected it and the dropdown omitted it). Both now derive from the shared role list, so any future role appears automatically. Needs migration 0016 (adds the enum value) applied.',
  ] },
  { version: '0.41.1', date: '2026-08-27', changes: [
    'Finance access hardening + verification. Confirmed and locked down the finance walls: added automated tests (permissions matrix + a static audit that every finance route in the office server is capability-guarded and the mobile app never queries a finance table), a Supabase SQL check that RLS is on and admin/invoice_manager-only on all finance tables, and documented the model in docs/roles-and-access.md. No behaviour change — this proves office/field/mobile can never see costs or prices.',
  ] },
  { version: '0.41.0', date: '2026-08-27', changes: [
    'In-app QA Test tab (office, admin/office). A new Test tab lists the app\'s test scenarios grouped by area; a tester ticks each OK or NOK with an optional comment, and results are saved to the database against the current app version and tester. Live progress (tested / OK / NOK / untested), filter by area or result, and Export CSV. Scenarios come from the same versioned list as the test-plan spreadsheet. Requires migration 0018.',
  ] },
  { version: '0.40.0', date: '2026-08-26', changes: [
    'Office deletes + item counters. (1) Delete a job (admin/office) — allowed only when it has no items; otherwise it tells you how many to clear first. (2) Delete one or more items: select rows and hit Delete in the bulk bar (managers only; snags/photos/pricing cascade). (3) The items header now shows a live count — how many items are shown (and of how many when filtered), how many have changed since last sync, and how many aren\'t synced yet.',
  ] },
  { version: '0.39.0', date: '2026-08-25', changes: [
    'Customer price-breakdown PDF (office, finance only). A "Customer price PDF" button in the Budget job view downloads a branded, customer-facing quote: per-flat rows (base + biggest extras), doors, communal windows, variations and the grand total. It deliberately shows ONLY the sale side — never our cost or margin. Endpoint GET /api/job/:code/price.pdf, gated to finance.view.',
  ] },
  { version: '0.38.0', date: '2026-08-25', changes: [
    'Variations in the budget breakdown (office, finance only). The job price view now lists the job\'s items with a Variation tick + a manual amount (£). Marking an item pulls it out of the flat\'s fixed scope and bills it separately at the agreed amount, and the totals/margin update live. Stored in the finance-only item_pricing table; endpoint PUT /api/item/:id/pricing gated to finance.manage.',
  ] },
  { version: '0.37.1', date: '2026-08-24', changes: [
    'Pick a pricing rule when creating a job in the office. The "+ New job" form now includes a Pricing rule dropdown (only for admins / invoice managers, since rules are finance-only); choosing one assigns it to the new job on save, so the Budget breakdown is ready immediately. Plain office users don\'t see the picker.',
  ] },
  { version: '0.37.0', date: '2026-08-24', changes: [
    'Create jobs from the office. The office had no way to add a job (only the phone did). The Items tab now has a "+ New job" link by the JOBS list (admin/office): enter client code, job code, name and optional site address, with a live CLIENT.JOB code preview. Backed by a new POST /api/jobs, role-gated to jobs.manage. Handy for setting a job up at the desk and then assigning its pricing rule.',
  ] },
  { version: '0.36.0', date: '2026-08-24', changes: [
    'Budget module — assign a rule to a job + live price breakdown (office, admin/invoice_manager). In the Budget tab you can now pick a job, assign one of your pricing rules to it, and see the numbers: three cards (customer price, our budget cost, margin with %), a per-flat table (windows, base rate, biggest-extra windows m² and £, flat total), plus lines for doors, communal windows and variations, then the customer total. Snags excluded, variations separate. Computed server-side by the pricing engine; still finance-gated (endpoints + RLS). No migration.',
  ] },
  { version: '0.35.0', date: '2026-08-24', changes: [
    'Budget module — pricing-rules manager (office, admin/invoice_manager only). A new Budget tab lists customer pricing rules and lets you create/edit/delete them: material cost (window frame/glass per m², door frame/glass per unit), rip-out labour (window/door per unit), and sale rates (per flat, per door, per m², windows included per flat), all entered in £ and stored in pennies. The tab is hidden from every other role and the endpoints are role-gated on the server (on top of RLS). Next: assign a rule to a job + the per-flat price/margin view.',
  ] },
  { version: '0.34.0', date: '2026-08-24', changes: [
    'Budget & customer-pricing module — foundations (admin only, no UI yet). New finance-only tables (pricing_rules, job_pricing, item_pricing) readable strictly by admin and a new invoice_manager role — office/field/mobile can never see costs or prices. A configurable per-customer pricing rule (model + rates) drives, per job: our budget cost (materials + rip-out labour) and the customer sale price grouped by flat (base rate incl. the 5 smallest windows, biggest extras + communal per m², doors flat-rate, snags excluded, variations manual). Pricing engine lives in @ace/shared and is unit-tested against the Axis worked example. Requires migrations 0016 + 0017. UI comes next.',
  ] },
  { version: '0.33.1', date: '2026-08-24', changes: [
    'Fix: role could load as null on the phone, hiding role-gated buttons (e.g. "+ New job" for admin/office). The mobile app only matched your app_users row by auth id, so an identity that was never linked (set up for the web app, or Microsoft SSO) was invisible under RLS. The app now links your login to your user row by email on sign-in (new link_current_user() function) and shows your role next to the version. Requires migration 0015.',
  ] },
  { version: '0.33.0', date: '2026-08-24', changes: [
    'Office install calendar. A new Calendar tab shows every scheduled install across all jobs and teams on a month grid, with a colour-coded count on each day (green all-installed, magenta any snag/misfit, amber otherwise), month paging, and a team filter. Click a day to list its installs (job, code, team, status); click one to open the item. Dates come from the Monday pull. Office/admin/surveyor only.',
  ] },
  { version: '0.32.0', date: '2026-08-24', changes: [
    'Install PDF now shows planned install dates. The install report has a new "Scheduled" column (the date pulled from Monday) next to each item, and the summary shows the overall scheduled date range plus how many items aren\'t scheduled yet. Survey report is unchanged.',
  ] },
  { version: '0.31.1', date: '2026-08-24', changes: [
    'Fix: clicking a style in the office picker did nothing — the grid called a pickStyle() that was never defined, so no design code was set. Added it; picking now fills the design code + window type and closes the picker.',
  ] },
  { version: '0.31.0', date: '2026-08-24', changes: [
    'Office new-item form now matches the phone. The desk "New item" form gained the full survey spec — window type, safety glass, cill depth, transoms ×3, mullions ×3, open in/out, coupled, add-ons — plus a visual "Choose style…" picker: the same 391 Clearview sketches as the app, filterable by product type / wide / high and code search. Picking a style sets the design code (and fills the window type) and shows a thumbnail. Office staff can now create fully-specified items without the app.',
  ] },
  { version: '0.30.0', date: '2026-08-24', changes: [
    'Month view for the fitter schedule. A new Agenda / Month toggle on "My schedule": Month shows a calendar grid with a count badge per day (colour-coded — green all-installed, magenta if any snag/misfit, amber otherwise), month arrows to page back/forward, and tapping a day lists that day\'s items below. Agenda stays the default.',
  ] },
  { version: '0.29.2', date: '2026-08-24', changes: [
    'PDF report: pin numbers now cross-reference the table. Each pin on the plan is numbered, and that number appears in a new "#" column next to the matching item in the table below — so you can read a pin off the plan and find its row. Replaces the old number-plus-window-code legend under the plan, which was unclear.',
  ] },
  { version: '0.29.1', date: '2026-08-24', changes: [
    'Plan screen now reports load failures instead of failing silently. Before, if the plan couldn\'t be read it showed the same "no plan uploaded" empty state as a job that genuinely has none — so a fitter opening a job with no plan just saw a dead end. It now surfaces the actual error (and still says clearly when a job simply has no plan yet).',
  ] },
  { version: '0.29.0', date: '2026-08-24', changes: [
    'Fitter schedule on the phone. Fitters now land on "My schedule" — an agenda of their team\'s work grouped by day: Overdue, Today, Tomorrow, each day this week/next, Later, and Not-scheduled-yet. Tap any item to open the fit flow. A "Jobs ›" link still opens the full job list. Planned install dates come from Monday: the office "Pull fitters" button now also reads the board\'s date column (install/plan/schedule/due/date) into each item. Requires migration 0014.',
  ] },
  { version: '0.28.0', date: '2026-08-24', changes: [
    'Per-job PDF reports (office). The Plans tab now has Survey PDF and Install PDF buttons: a branded, printable document with the job summary, the floor plan(s) with colour-coded item pins and a numbered legend, a spec/status table, a snags list, and a photo appendix. Survey PDF shows dimensions/glass/design + survey photos; Install PDF shows team/rate/install status + install photos. Available to admin/office/surveyor.',
  ] },
  { version: '0.27.0', date: '2026-08-24', changes: [
    'Fitter data scope (database enforced). A fitter now only reads the items assigned to their own team — plus those items’ photos, the jobs that hold their work, and their own team row (other teams’ rates stay hidden). Enforced by Row-Level Security, so it holds even outside the app. Snags inherit their parent item’s team so fitters keep seeing snags on their own items. Other roles are unchanged. Requires migration 0013.',
  ] },
  { version: '0.26.2', date: '2026-08-24', changes: [
    'Plan filter fix (follow-up): Unplaced now always means not pinned on any plan for the site, in both single- and multi-plan modes. It no longer lists items that are placed on another plan.',
  ] },
  { version: '0.26.1', date: '2026-08-24', changes: [
    'Plan filter fix: Unplaced now means not pinned on any plan (was showing items placed on another plan). In multi-plan mode it still means not on this plan.',
  ] },
  { version: '0.26.0', date: '2026-08-24', changes: [
    'One plan per item (configurable). By default an item can be pinned to only one plan \u2014 on other plans it shows as \'on <plan name>\' and can\'t be re-placed (unpin it there first). A new office Plans setting \'Item can be on multiple plans\' (admin/office) relaxes this, e.g. for plan versions. Enforced in the office, on the phone, and on the server. Requires migration 0012.',
  ] },
  { version: '0.25.2', date: '2026-08-24', changes: [
    'Plan navigation: opening an item from a plan pin now returns to the plan on Back (then Back again to Items), instead of jumping straight to the items list.',
  ] },
  { version: '0.25.1', date: '2026-08-17', changes: [
    'Plan screen: pull down to refresh — pins placed on the web app now update without leaving and re-entering the screen.',
  ] },
  { version: '0.25.0', date: '2026-08-17', changes: [
    'Plan view on the phone. A new Plan button on the items screen opens the job\'s floor plan with the item pins, colour-coded by install status. Tap a pin to open its item. Surveyors/office can drop or move a pin (pick an item, tap the plan) and unpin; fitters/scanners get read-only. Plan selector for jobs with multiple plans, and a placed/unplaced filter. Completes the plan feature end to end (office sets up, field uses it).',
  ] },
  { version: '0.24.1', date: '2026-08-17', changes: [
    'Fix: the mobile package.json now declares the native modules the app uses (react-native-safe-area-context, expo-web-browser, expo-auth-session, expo-crypto). They were installed earlier via expo install but not listed, so unzipping a new build dropped them and Metro failed with "Unable to resolve react-native-safe-area-context". Run npx expo install to pull them at SDK-correct versions.',
  ] },
  { version: '0.24.0', date: '2026-08-17', changes: [
    'Raise a snag on the phone. Opening an item now has a "Raise a snag" button (surveyors, fitters, office): add a description + optional photos and it creates a snag item (kind=snag, -S<n> code, install status Snag) against the parent, copying its location/spec — the same model as the office. The office can then schedule it and it syncs to Monday (photo → Design Sketch). Online action; scanners don\'t see the button.',
  ] },
  { version: '0.23.2', date: '2026-08-17', changes: [
    'Plans polish: widened the items panel and let long codes wrap so the place/unpin action no longer clips.',
  ] },
  { version: '0.23.1', date: '2026-08-17', changes: [
    'Fix: placing a pin failed with "invalid input syntax for type uuid" — the generic PUT /api/item/:id route was catching /api/item/:id/pin and treating "pin" as the id. The item route now ignores the /pin path so the pin endpoint handles it.',
  ] },
  { version: '0.23.0', date: '2026-08-17', changes: [
    'Plan view with item pins (office). New Plans tab: upload a floor plan / elevation image per job, then pin each item to its spot on the plan (click an item, click the plan). Pins are colour-coded by install status and clicking one opens the item. Filter items by placed / unplaced, switch between multiple plans per job. Foundation for the phone plan viewer next. Needs migration 0011 (job_plans + item pin fields + plans storage bucket) in Supabase.',
  ] },
  { version: '0.22.0', date: '2026-08-17', changes: [
    'Style picker filters by size. Loaded the Clearview Window Types sheet (505 styles) into the app, so the Choose-style picker now filters by Wide (1-6) and High (1-3) sections plus product Type (Window / Door / Tilt & Turn), on top of code search and the MOST USED HERE ranking. Each tile shows its wide x high and opening count. Picking a style also auto-fills the item window type from the catalogue. Metadata in src/lib/styleMeta.ts (regenerate from the xlsx when it changes).',
  ] },
  { version: '0.21.0', date: '2026-08-17', changes: [
    'Full sketch catalogue in the style picker. All 391 real Clearview style sketches (from the sketches folder, keyed by design code) are now bundled into the app and shown in the Choose-style picker as image tiles \u2014 works fully offline. Search by code (e.g. 27, 129B) and a MOST USED HERE ranking (from pick_events, room-weighted) float the common ones to the top. Picking sets the item design_code; the chosen sketch shows on the form and in item detail. Regenerate the catalogue with the bundled asset map when sketches change.',
  ] },
  { version: '0.20.0', date: '2026-08-17', changes: [
    'Visual style picker (mobile). The survey form now has a "Choose type…" button that opens a full-screen picker with sketched window/door layouts (SVG), Window / Door / Tilt & turn and 1 / 2 / 3+ light filters, and a "MOST USED HERE" grid auto-ranked by pick frequency (learned from pick_events, room-weighted). Picking a style sets the item\'s window type + design code (Clearview style number) and remembers it for "Same as last item". design_code now maps to a Monday "Design Code" column. Needs: npx expo install react-native-svg.',
  ] },
  { version: '0.19.0', date: '2026-08-17', changes: [
    'Fuller survey spec + scanner "one hands" mode. The mobile survey form now captures Window type, Safety glass, Cill depth, Transoms x1-3, Mullions x1-3, Open in/out, Coupled and Add-ons (on top of material/glazing/glass/sizes). A scanner can flip an on-screen "Add full details now" toggle to survey while scanning (saves as surveyed); left off, it stays a quick location-only scan. New window_type field (migration 0010) maps to a Monday "Window Type" column. Apply 0010_window_type.sql in Supabase.',
  ] },
  { version: '0.18.1', date: '2026-08-17', changes: [
    'Mobile: switched to react-native-safe-area-context for the safe-area handling, clearing the "SafeAreaView has been deprecated" warning and giving better notch/home-indicator insets. Run: npx expo install react-native-safe-area-context.',
  ] },
  { version: '0.18.0', date: '2026-08-17', changes: [
    'Surveyor: add the spec to a scanned item on the phone. Opening an item now shows an "Add survey details" button (surveyor/office) that reopens it in the full form \u2014 fill material, glazing, glass, sizes, team \u2014 and Save details updates the item and moves it to stage "surveyed". Completes the two-pass field flow (scanner creates, surveyor details). Also clearer item tags: "on Monday" vs "saved \u00b7 not on Monday" (the old "local" wording wrongly implied device-only \u2014 items are in the database and visible on any device once saved).',
  ] },
  { version: '0.17.0', date: '2026-08-17', changes: [
    'Scanner mode (mobile). A scanner now gets a streamlined "Scan item" form \u2014 capture each item\'s location/identity only (block, elevation, flat, room, item, floor + optional photo), saved at stage "scanned"; the spec is left blank for the surveyor to fill later. A "Save & scan next" button keeps the location and bumps the item number for fast sequential scanning. The full survey form (with spec) still shows for surveyors/office. Next: let surveyors add the spec to an existing scanned item on the phone.',
  ] },
  { version: '0.16.1', date: '2026-08-17', changes: [
    'Fix: a fitter marking an item Installed was blocked with "fitters may only update the install status" \u2014 because installing also stamps the install date, which the fitter-guard trigger hadn\'t whitelisted. Migration 0009 lets fitters set the install date (and after-photo) alongside the status. Apply 0009_fitter_guard_install_date.sql in Supabase.',
  ] },
  { version: '0.16.0', date: '2026-08-17', changes: [
    'Fitter team view. A fitter login is now assigned to a team (office Users tab \u2192 Team column), and on the phone a fitter sees only their team\'s ready-to-fit items. Team\u2192item assignment stays mastered in Monday: the Sync tab has a new "Pull fitters" button that reads the Monday Fitters column back into the app and sets each item\'s team (no re-sync loop). Requires migration 0008 (app_users.team_id).',
  ] },
  { version: '0.15.0', date: '2026-08-17', changes: [
    'Role checks in the office server (defence in depth). Every mutating office API now verifies the caller\'s role against the capability matrix, not just the UI — so even a direct API call is refused (the office server uses the service-role key and bypasses the database rules, so this closes that gap). This completes role enforcement across all three layers: database (RLS), office server, and both UIs. Note: managing teams and linking/pushing Monday boards is now allowed for office (not admin-only), matching the matrix.',
  ] },
  { version: '0.14.3', date: '2026-08-17', changes: [
    'Fix mobile SSO redirect: after the Microsoft login, Safari showed \'can\'t open the page\' because the app was returning to a custom acefield:// URL that Expo Go can\'t open. It now lets Expo pick the right redirect per environment (exp:// in Expo Go, acefield:// in a dev/standalone build) and parses the returned tokens robustly. Add the exp:// redirect (or exp://*) to Supabase Redirect URLs for Expo Go testing.',
  ] },
  { version: '0.14.2', date: '2026-08-17', changes: [
    'Mobile app: "Sign in with Microsoft" on the phone login, so SSO-only field staff can sign in (matches the office web app). Uses the same Azure provider; only the mobile redirect needs adding to Supabase. Setup: docs/mobile-sso-setup.md.',
  ] },
  { version: '0.14.1', date: '2026-08-17', changes: [
    'Fix: "Reset password" could show a new password that was never actually applied to the login (so the user still couldn\'t sign in). It now updates the auth account directly by its linked ID (with a paged email fallback) and fails loudly if the update didn\'t take — no more phantom passwords.',
  ] },
  { version: '0.14.0', date: '2026-08-17', changes: [
    'Role-aware screens: people now only see what their role allows. Office — Dashboard/Teams/Monday-sync tabs, the "+ New item" button, and inline edit/sync controls are hidden for roles that lack the capability. Mobile — "+ New job" is hidden unless you can manage jobs, the survey "+ New" is hidden for fitters, fitters see only items that are ready to fit, and the install-status editor is shown only to fitters/office. The database (migration 0007) still enforces the rules underneath.',
  ] },
  { version: '0.13.1', date: '2026-08-17', changes: [
    'Fix: the Users table was clipping its right-hand columns (Status / actions) on narrower screens — the panel is now wider and scrolls sideways if needed so every column is visible.',
  ] },
  { version: '0.13.0', date: '2026-08-17', changes: [
    'Role enforcement in the database (migration 0007): on the mobile/direct path, surveyors can add items but not jobs, fitters can set install status but not edit the spec, and only admin/office manage jobs & teams. This is the real security boundary — apply 0007_role_access.sql in Supabase.',
  ] },
  { version: '0.12.0', date: '2026-08-17', changes: [
    'Roles & access: a capability matrix (role → what they can do) is now the single source of truth in @ace/shared, with a new admin-only Roles tab that shows exactly what each role can do. Foundation for enforcing access across the office app, mobile app, and database.',
  ] },
  { version: '0.11.1', date: '2026-08-14', changes: [
    'recognise CLI now accepts a folder — runs every photo and prints a summary table (fast way to eyeball model accuracy on many images)',
  ] },
  { version: '0.11.0', date: '2026-08-14', changes: [
    'Phase A frame recognition: a server-side vision service (POST /api/recognise/:itemId) analyses an item photo and returns the window layout + style. Off unless VISION_API_URL/MODEL are set.',
  ] },
  { version: '0.10.3', date: '2026-08-13', changes: [
    'Sync now reports how many photos were pushed to Monday (and surfaces any photo-push error instead of failing silently)',
  ] },
  { version: '0.10.2', date: '2026-08-13', changes: [
    'Field photos (from the mobile app) now push to the Monday Design Sketch column on sync, once each (no duplicates on re-sync)',
  ] },
  { version: '0.10.1', date: '2026-08-12', changes: [
    'A page refresh now returns you to the tab you were on (and the same job/filter), instead of jumping to the Dashboard',
  ] },
  { version: '0.10.0', date: '2026-08-12', changes: [
    '"Needs re-sync" flag: synced items that change (e.g. a phone status update) show a "changed" tag + amber Re-sync, a "Needs re-sync" filter, and a dashboard card',
  ] },
  { version: '0.9.1', date: '2026-08-12', changes: [
    'Re-sync button on already-synced items — push later changes (e.g. a status update from the phone) to Monday; updates the existing item in place, never duplicates',
  ] },
  { version: '0.9.0', date: '2026-08-10', changes: [
    'Live wallboard at /live — a standalone auto-refreshing status page you can pin as a browser tab',
  ] },
  { version: '0.8.0', date: '2026-08-09', changes: [
    'Dashboard cards are clickable — jump to a filtered Items view (incl. a new "All jobs" view)',
    'Items tab now has filter chips: synced, not synced, installed, snags, open snags',
    'Dashboard shows an install-status breakdown (scheduled / installed / snag / misfit / delayed)',
  ] },
  { version: '0.7.0', date: '2026-08-09', changes: [
    'New Dashboard tab (default view): totals + per-job progress for synced, installed, snags, and labour',
  ] },
  { version: '0.6.2', date: '2026-08-09', changes: [
    'Microsoft SSO now shows the account picker, so you can switch users after signing out',
  ] },
  { version: '0.6.1', date: '2026-08-09', changes: [
    'Microsoft SSO now requests the email scope explicitly (fixes "error getting user email")',
  ] },
  { version: '0.6.0', date: '2026-08-09', changes: [
    'Sign in with Microsoft (SSO) — optional, links to your account by email',
  ] },
  { version: '0.5.1', date: '2026-08-09', changes: [
    'Monday links now resolve to the right account (account slug captured on sync)',
    'Fixed snag row layout — long code no longer overlaps the description',
  ] },
  { version: '0.5.0', date: '2026-08-09', changes: [
    'Snags are now first-class items with their own labour cost and fitter team',
    'Snag names on Monday now include the defect description',
    'Added in-app version chip + this changelog',
  ] },
  { version: '0.4.0', date: '2026-08-09', changes: [
    'Admin Users tab: create logins, set roles, activate/deactivate, reset passwords',
    'Name & email are editable inline; email changes update the Supabase login',
  ] },
  { version: '0.3.0', date: '2026-08-09', changes: [
    'Create new items from the desk (auto-assembles the full code)',
    'Item detail drawer with all fields + photos',
    'Bulk select + multi-line processing: sync, assign team, set install status',
  ] },
  { version: '0.2.0', date: '2026-08-08', changes: [
    'Teams & rates management (admin)',
    'Monday sync tab: link a board, per-job counts, batch Sync-all',
    'Item links resolve to the correct Monday account',
  ] },
  { version: '0.1.0', date: '2026-08-08', changes: [
    'Office web app: Supabase-Auth login, edit rate/status/team, Sync to Monday',
  ] },
];
