// Single source of truth for the app version, shared by web (and later mobile).
// Bump APP_VERSION and add a CHANGELOG entry whenever we ship a change.
//   MAJOR.MINOR.PATCH — MINOR for new features, PATCH for fixes/tweaks.
export const APP_VERSION = '1.13.2';

export interface ChangelogEntry { version: string; date: string; changes: string[]; }

export const CHANGELOG: ChangelogEntry[] = [
  { version: '1.13.2', date: '2026-10-05', changes: [
    'Fix: Operations showed \u201cundefined.undefined\u201d instead of jobs, and New job, delete job, item details, snags and sign-off PDFs could fail. Since Job costs was added (v1.8.0), four Fin&Ops functions had the same names as the office job functions and silently replaced them. They are now named apart, and a new test stops this from happening again. No data was changed or lost.',
  ] },
  { version: '1.13.1', date: '2026-10-05', changes: [
    'Fin&Ops \u25b8 Performance \u25b8 Result: new line Other income (Trade from Poland) with its % of sales, between Operating profit and Financial cost. As in the Performance Sheet it is subtracted: Profit before tax = Operating profit \u2212 Other income \u2212 Financial cost (trade is already inside Sales, but the cost of those goods is not in Materials). Click a month to open those trade invoices. Included in the CSV export and in Polish.',
  ] },
  { version: '1.13.0', date: '2026-10-04', changes: [
    'Fin&Ops \u25b8 Performance \u25b8 Result: Depreciation and Financial cost can now be typed in per month \u2014 click a month in those rows, enter the amount (empty clears it). Two new lines follow: Operating profit (EBITDA \u2212 Depreciation) and Profit before tax (Operating profit \u2212 Financial cost), each with its % of sales. The RESULT header now shows Profit before tax.',
    'The new rows are in the CSV export and in Polish; every change is recorded in the audit log.',
  ] },
  { version: '1.12.0', date: '2026-10-04', changes: [
    'Fin&Ops \u25b8 Performance: new Result block at the bottom, built like the Performance Sheet. Sales \u2212 Materials (RW of the jobs counted in the month, from Job costs) \u2212 Sales costs (the whole Sales department incl. payroll) = Gross margin; \u2212 Overheads (Office incl. payroll + Production payroll) = EBITDA. Every line shows its % of sales underneath, per month and for the year.',
    'Months that still use a payroll estimate are shown in italics in the Result rows too. Click a Materials cell to open Job costs for that month; click Sales to open the Sales tab.',
    'A reference row shows the Production invoice overheads, which are not part of the result (materials are counted as RW instead). The Result rows are included in the CSV export and are available in Polish.',
  ] },
  { version: '1.11.0', date: '2026-10-04', changes: [
    'Language per user. Admin \u25b8 Users has a new Language column: Default (EN), English or Polski. A user set to Polski sees the whole Fin&Ops menu in Polish \u2014 Wyniki (Performance), Koszty (Costs), Koszty zlece\u0144 (Job costs), Sprzeda\u017c (Sales) and P\u0142ace (Payroll): screens, windows, messages, month names, number format (1 234,56) and CSV headers. Everyone else, and the rest of the app, stays in English. Data from monday and the sheets (suppliers, categories, statuses) is shown as it is. Requires migration 0060_user_language.sql to set a language; without it everyone stays in English.',
  ] },
  { version: '1.10.1', date: '2026-10-04', changes: [
    'Performance: a \u201cCollapse all / Expand all\u201d button for the Fixed / Variable blocks and the UK customer breakdown. Groups you close stay closed when you change the year, company or decimals. Fixed: clicking a country in the Sales block no longer toggles the UK customers or clips its label.',
  ] },
  { version: '1.10.0', date: '2026-10-04', changes: [
    'Fin&Ops \u25b8 Payroll. Each month the finance user enters total salaries and total payroll tax for Office, Sales and Production and ticks Actuals when the figures are final. A month without the tick shows an estimate \u2014 the average of the last 3 months with actuals, per department \u2014 or the user\u2019s own figure if one is typed without ticking. Ticking a month moves the estimate on to the next one. A ticked month is protected until it is unticked.',
    'Performance: the Salaries and Taxes rows of each department are now filled from Payroll (estimates in orange italics), department totals include payroll, and a new row \u201cTotal costs incl. payroll\u201d sits under the Monday control sum. Requires migration 0059_fin_payroll.sql.',
  ] },
  { version: '1.9.0', date: '2026-10-04', changes: [
    'Fin&Ops \u25b8 Sales (phase 5.1) \u2014 the \u201cSprzeda\u017c\u201d sheet in the app, entered by hand until Subiekt is connected. One row per job, holding all of its invoices (prepayments and the final one); click a job to see, add, edit or delete them. Invoices without a number are shown as planned; sales not tied to a job have their own group. Filters (year, month, Orpiszew / trade, country, buyer), totals, CSV export, and an admin import that pastes the existing sheet (lines already here are skipped).',
    'Job costs now take a job\u2019s sales from its sales invoices (their net sum) when it has any \u2014 no more copying by hand; the value from the sheet is kept for reference and a filter lists the jobs where the two differ. Locking a job freezes its sales figure, so later invoices cannot move a locked job\u2019s result.',
    'Performance shows a Sales results block under the costs, as in the sheet: total, Sales from Orpiszew (producer Acemark PL) and Trade from Poland (everything else), each by country, with the UK split into Acemark Glazing / PCW / Others UK. Click a number to see its invoices. Requires migration 0058_fin_sales.sql.',
  ] },
  { version: '1.8.0', date: '2026-10-04', changes: [
    'Fin&Ops \u25b8 Job costs (phase 4) \u2014 the \u201cKoszty\u201d sheet in the app: profit & loss per job order. One row per job (Z.373, \u201cZ.102 panele\u201d, Z.214B\u2026 are separate jobs) with the sheet\u2019s columns: Material Cost (RW), other cost \u2014 panels, glass, other extras, painting, transport, customs clearance, labour hours and cost, sales, total cost, profit / loss, profitability, customer. Open a job to enter its cost lines \u2014 several per job (e.g. several invoices), each with an optional invoice number, supplier, date and note; labour is hours \u00d7 rate (default rate set by an admin). Filters, totals, CSV export. An admin can lock a job \u2014 it is then read-only for everyone until an admin unlocks it \u2014 and can import the existing sheet by pasting its rows (existing jobs are skipped). Finance and admin only. Requires migration 0057_fin_jobs.sql.',
  ] },
  { version: '1.7.3', date: '2026-10-04', changes: [
    'Fin&Ops: the Performance Sheet is treated as an open list \u2014 a category under a department that did not have it before (e.g. Internet under Sales) is no longer reported; Performance simply shows it as a line. \u201cTo fix in monday\u201d now lists only KONTO not matching the category, a missing department / category, and an invoice date outside its month group. No migration, no sync needed.',
  ] },
  { version: '1.7.2', date: '2026-10-03', changes: [
    'Fin&Ops sync scope. Under \u201cSync from Monday\u201d choose All, Last 12 months or Last 3 months \u2014 a scoped sync reads only those month groups, so it is much faster. The automatic daily sync now refreshes the last 12 months only. Older invoices are left exactly as they were; run \u201cAll\u201d when something older was changed on the board.',
    'Fin&Ops \u25b8 Costs: every invoice that needs fixing now has an \u201cOpen in monday to fix\u201d button right under its warning, and the supplier name on every row opens the invoice in monday. No migration.',
  ] },
  { version: '1.7.1', date: '2026-10-03', changes: [
    'Fin&Ops: an invoice is now counted in the month of its monday group (not its invoice date), so monthly totals match the board exactly \u2014 e.g. September 2026 = 461,311.90. Invoices dated outside their group\u2019s month are listed under \u201cTo fix in monday\u201d. Entries without an invoice number are now registered too: their Cost ID uses BRAK-FV-<date> in place of the number, and filling the number in later updates the ID without raising a Changed flag. \u201c429 Office\u201d is accepted as a Production line. Takes effect after the next sync. No migration.',
  ] },
  { version: '1.7.0', date: '2026-10-03', changes: [
    'Fin&Ops: the board\u2019s Koszt (sta\u0142y / zmienny) column is no longer used \u2014 fixed or variable is always decided by the category, as in the sheet. New \u201cTo reclassify\u201d worklist: invoices whose category is not a line for their department in the Performance Sheet (e.g. 429 Office under Production), whose KONTO does not match the category, or that have no department / category. Performance shows the count with a link; the Costs tab lists them with the reason in plain words, a monday link to fix each one, a new filter (any reason or one reason) and \u201cExport this list (CSV)\u201d. After fixing in monday, the next sync clears them. No migration.',
  ] },
  { version: '1.6.1', date: '2026-10-03', changes: [
    'Fin&Ops: automatic daily sync from Monday \u2014 on by default at 06:00 Poland time. Admins can change the hour or switch it off on the Costs tab (\u201cAutomatic sync \u2026 change\u201d). Runs once a day; if the server was restarting at that hour it runs as soon as it is back. Automatic runs appear in the last-sync line as \u201cAutomatic (daily)\u201d. No migration.',
  ] },
  { version: '1.6.0', date: '2026-10-03', changes: [
    'Fin&Ops \u25b8 Performance (phase 2). The New Performance Sheet layout, calculated from the synced invoices: department (Office / Sales / Production) \u2192 Overheads \u2192 Fixed / Variable \u2192 cost line, with a column per month, a year total and the \u201cControl sum \u2014 Monday\u201d row. Click any number to open the invoices behind it on the Costs tab. Fixed / variable follows the sheet\u2019s category rule by default (or the board\u2019s Koszt column), and the page counts invoices where the two disagree. Year and company (Acemark / Ace Group / Poza bilans) selectors, collapsible blocks, CSV export. Salaries and payroll taxes are placeholders until the payroll source is connected. No migration.',
  ] },
  { version: '1.5.1', date: '2026-10-03', changes: [
    'Fin&Ops \u25b8 Costs: the test site now syncs with the copy board \u201cFAKTURY WSZYSTKIE _TEST\u201d; only the live site reads and writes the real board. The Costs page links to the board it is using. No migration.',
  ] },
  { version: '1.5.0', date: '2026-10-03', changes: [
    'New Fin&Ops menu \u25b8 Costs (phase 1 of company cost control) + new role Acemark Finance. \u201cSync from Monday\u201d pulls every purchase invoice from the board FAKTURY WSZYSTKIE (all history) into the app. Each invoice gets a Cost ID \u2014 SUPPLIER#INVOICE NO#NET \u2014 when first synced: kept in the app as the trusted copy and written to a new \u201cCost ID\u201d column on the board. Later syncs rebuild it from monday\u2019s current values; if the supplier, invoice number or net amount was edited, the invoice is flagged Changed (old \u2192 new shown; an admin can accept it). Also flags duplicate Cost IDs (same invoice entered twice), incomplete invoices and KONTO not matching the category. Filters by year, month, company (Acemark / Ace Group / Poza bilans), department, category, fixed/variable, status and warnings, with net / unpaid totals. Acemark Finance users see only Fin&Ops. Requires migrations 0055_acemark_finance_role.sql then 0056_fin_costs.sql.',
  ] },
  { version: '1.4.1', date: '2026-10-01', changes: [
    'Labels: savings counter, visible to admins only \u2014 PDFs processed (one per label download), time saved (1 hour per PDF) and money saved (50 PLN per hour). Counts every download since the feature launched. No migration.',
  ] },
  { version: '1.4.0', date: '2026-10-01', changes: [
    'Labels: every piece now prints as a pair \u2014 the label in the left column and its copy in the right \u2014 so one A4 sheet holds 4 pieces (8 labels). New \u201c+ Add HARDWARE labels\u201d button adds a row at the end with two labels that say HARDWARE plus the job line. \u201cSkip\u201d now counts sheet rows (0\u20133). No migration.',
  ] },
  { version: '1.3.2', date: '2026-10-01', changes: [
    'Confirmations: a report can only be approved once every item has a decision (Akceptuję / Nie akceptuję), every rejected item says what is wrong, and every question is answered. Enforced on the server; the recipient is told what is missing and the page scrolls to the first gap. Applies to reports that save as they go (the Z.439 type). No migration.',
  ] },
  { version: '1.3.1', date: '2026-10-01', changes: [
    'Confirmations moved to the Logistics menu (Logistics \u25b8 Labels, Confirmations) with the same access as Labels: the logistics role and admins. Office users no longer see it. No migration.',
  ] },
  { version: '1.3.0', date: '2026-09-30', changes: [
    'Operations \u25b8 Confirmations: share a report for sign-off by link. Upload a \u201craport do potwierdzenia\u201d (HTML), copy the link and send it; the recipient marks decisions, signs and clicks Approve, which locks the report and notifies you (email / Teams DM). The table shows every shared report with Pending approval / Approved, the approver and date, plus Copy link, Open, PDF (decisions + answers + signature) and Filled report (the page exactly as the customer filled it in, to print or save as PDF). Works with any report structure: items/questions are read per file; reports with the autosave hook save every decision as it is made, others are captured on Approve with a name + signature box. The report runs sandboxed so it can\u2019t touch office logins. Admin and office roles. Requires migration 0054_confirmations.sql.',
  ] },
  { version: '1.2.0', date: '2026-09-30', changes: [
    'Logistics \u25b8 Labels + new logistics role. Upload an Archimede production printout (WYDRUK PRODUKCYJNY PDF) and download an A4 sheet of window/door labels in the WEM format \u2014 8 per page (2 \u00d7 4, 105 \u00d7 74 mm), one label per piece: \u201cWymiar Okna: P/N W\u2026 x H\u2026\u201d (outer frame size) and the job line with the window/door reference in bold (taken from the note, e.g. W02.1, W03.1). The PDF is read directly (no AI, nothing stored); every row is editable before printing, with WEM logo / company details tick boxes and \u201cskip first N labels\u201d for part-used sheets. New role logistics sees only this tab (server allow-list + database policies). Requires migrations 0052_logistics_role.sql then 0053_logistics_scope.sql (only to assign the role; admins can use Labels without them).',
  ] },
  { version: '1.1.2', date: '2026-09-30', changes: [
    'New-password / new-login window: separate Copy buttons for the email and the password (the old single Copy put \u201cemail  password\u201d on the clipboard, so pasting it into the password box failed). \u201cCopy both (for sharing)\u201d copies them on two labelled lines. Also, a password reset no longer signs that user out of their other sessions. No migration.',
  ] },
  { version: '1.1.1', date: '2026-09-30', changes: [
    'Fix: Admin \u25b8 Users \u25b8 Reset password could show a new password that then failed with \u201cInvalid email or password\u201d. The reset now only trusts a user\u2019s linked login if it has the same email (a stale link \u2014 e.g. a row copied from another environment \u2014 used to change the wrong login), confirms the login\u2019s email (unconfirmed logins can\u2019t sign in), relinks the user, and finally does a real test sign-in with the new password \u2014 if that fails you get an error with the reason instead of a password that doesn\u2019t work. Login now ignores stray spaces / capitals in the email and says so when an email isn\u2019t confirmed; failed logins are logged with the reason. Generated passwords avoid look-alike characters (l/1, O/0) and use a secure random source. No migration.',
  ] },
  { version: '1.1.0', date: '2026-09-30', changes: [
    'Teams personal messages for PO approvals. Besides the channel post, each approver now gets a 1:1 Teams chat (from the Workflows bot) when a £2000+ request is raised, and the requestor gets one when it is approved or rejected (with the reason). Matched by the user\u2019s email in the app = their Microsoft sign-in. Enable by setting TEAMS_PO_DM_WEBHOOK to a Teams Workflow URL \u2014 setup in docs/teams-po-notifications.md. No migration.',
  ] },
  { version: '1.0.3', date: '2026-09-30', changes: [
    'PO request window redesigned. Approve / Reject now sit at the top in an \u201cAwaiting approval\u201d banner; once decided, the banner shows who approved or rejected it, when, and the comment. Documents are a tidy list with a styled Choose files / Upload row, and status changes live in a Progress section. Rejecting now opens a dialog that requires a comment \u2014 the Reject button stays disabled until one is typed, and the server refuses a rejection without it. The reason is saved on the request, written to the audit log, and included in the requestor\u2019s email / Teams notification. Requires migration 0051_po_decision_comment.sql.',
  ] },
  { version: '1.0.2', date: '2026-09-30', changes: [
    'PO notifications link straight to the PO. \u201cOpen in ACE Office\u201d (Teams card and email) now opens that PO request\u2019s detail, not just the app \u2014 also after signing in first (password or Microsoft SSO). Links look like /?po=<id>. No migration.',
  ] },
  { version: '1.0.1', date: '2026-09-30', changes: [
    'Teams PO notifications now send an Adaptive Card, so TEAMS_PO_WEBHOOK works with a Teams Workflows webhook (\u201cSend webhook alerts to a channel\u201d) as well as a legacy Incoming Webhook connector, which Microsoft is retiring. No migration.',
  ] },
  { version: '1.0.0', date: '2026-09-30', changes: [
    'PO approvals & notifications. Requests of £2000+ notify the approver pool (all admins) and, on a decision, notify the requestor \u2014 across three channels: an in-app badge on the PO requests tab showing how many are in review (plus an “Awaiting approval” quick filter), Microsoft Teams (set TEAMS_PO_WEBHOOK to the channel\u2019s Incoming Webhook URL in the server environment), and email (set RESEND_API_KEY in the server environment; the from-address and app link are set in the new Notifications settings). Emails are HTML-escaped, and re-saving the same decision doesn\u2019t re-notify. Channels light up as configured; in-app works immediately. No migration.',
  ] },
  { version: '0.99.0', date: '2026-09-28', changes: [
    'Suppliers: Import from Monday. On Purchasing \u25b8 Suppliers, admins can pull the Approved Suppliers monday board into the app \u2014 it adds new suppliers and refreshes contact / email / phone on existing ones (matched by name). No migration.',
  ] },
  { version: '0.98.1', date: '2026-09-28', changes: [
    'PO requests refinements: search box + cost-centre-type filter on the list, and a Copy button that opens a new request pre-filled from an existing one. On the request form: cost-centre-type tick boxes (Framework / Enquiry / General) that narrow the cost-centre dropdown, a Budget file upload above the Quote file, Start and End of service date fields, and a Fitters-team dropdown (active office teams). Requires migration 0050.',
  ] },
  { version: '0.98.0', date: '2026-09-27', changes: [
    'PO requests, rebuilt natively (Purchasing ▸ PO requests). Staff raise a purchase-order request \u2014 title, cost centre (from the register), supplier (approved list or free-text), amount + currency, delivery date/location, qty of items/snags, remake flag, special instructions \u2014 and attach files (quote, PO, order ack, delivery docs). Requests of £2000+ are flagged as needing approval; a purchasing manager approves or rejects, then the request moves through PO sent → supplier confirmed → part/delivered. New Purchasing menu groups PO requests, Suppliers (admin-managed approved list) and Cost centres. New capabilities: purchasing.request (raise, internal staff) and purchasing.manage (approve + manage suppliers/cost centres, admin). Requires migration 0049.',
  ] },
  { version: '0.97.0', date: '2026-09-27', changes: [
    'Cost centres (Admin \u25b8 Cost centres, admin only) \u2014 foundation for purchasing/PO. One register that tags every purchase: framework phases (seeded from the PO board\u2019s All-Frame-Work list) and general overheads are added by hand, and job cost centres are imported from the Enquiries monday board (code = the L-number parsed from the enquiry name, description = the enquiry name). Type filter + search; import button pulls & refreshes enquiry-derived centres. New purchasing.manage capability (admin). Requires migration 0048. Next: the PO Request board rebuilt natively in the app, tagged by cost centre.',
  ] },
  { version: '0.96.2', date: '2026-09-26', changes: [
    'PO drawing: mullion and transom measurements are now drawn on the item sketch \u2014 the style sketch is scaled to the frame\u2019s real width:height, with dashed guide lines and mm labels for each mullion (from left, along the top) and transom (from top, down the left side), plus the overall size beneath.',
  ] },
  { version: '0.96.1', date: '2026-09-26', changes: [
    'PO card fix: removed the auto-drawn frame rectangle that could show a different number of sections than the Clearview style sketch. Each item now shows one window drawing (the style sketch) with the size and any transom/mullion positions listed as text beneath \u2014 no more conflicting pictures.',
  ] },
  { version: '0.96.0', date: '2026-09-25', changes: [
    'PO PDF redesigned (Phase 2). The purchase order is now one detailed card per item instead of a compact table: full specification (type, opening, material, glass + safety, glazing + bars, cill, add-ons, coupled, comments), a to-scale frame sketch drawn from the item\u2019s width/height with its transom and mullion positions, and the Clearview style thumbnail. The customer\u2019s contractual requirements (Pass24, Building control, Trickle vents, \u2026) print as chips in the header. Sort order (by flat / floor / item code / full code) still applies to the card order. No migration.',
  ] },
  { version: '0.95.1', date: '2026-09-25', changes: [
    'Hotfix: a mis-escaped quote in the new Customers/filter dropdown handlers caused a page script syntax error that blocked sign-in. Corrected \u2014 login and all buttons work again. No migration.',
  ] },
  { version: '0.95.0', date: '2026-09-25', changes: [
    'Customer cards (Admin \u25b8 Customers, admin only). Each customer has a short code (e.g. AXS), full name, a list of contact people (role, name, email, phone) and the contractual requirements that apply to them \u2014 ticked from a master list you maintain (Pass24, Building control, Trickle vents, Key-locked windows, \u2026). New jobs must now pick a customer from this list: you can\u2019t add a job for a customer whose card doesn\u2019t exist yet. An item\u2019s detail drawer shows the contractual requirements inherited from its job\u2019s customer. Requires migration 0047. (Printing these on the PO comes with the PO redesign, Phase 2.)',
  ] },
  { version: '0.94.0', date: '2026-09-25', changes: [
    'Items filters are now multi-select. Every column filter (Block, Elevation, Flat, Floor, Room, Item code, Stage, PO, Install status, Team) is a tick-box dropdown \u2014 pick several values at once (e.g. flats 12 + 14 + 21, or W1 + W2) and the list and counter update to the combined view. Each filter shows how many values are selected and has a Clear. Filters still reset when you switch jobs.',
    'Job Dates: added an independent Delivery phase (start\u2013end) between Scaffold and Fitting \u2014 it shows on the Gantt like the other phases. Not tied to any other date. Requires migration 0046.',
  ] },
  { version: '0.93.1', date: '2026-09-23', changes: [
    'Fix: on the PO PDF header, a long Site address or Deliver-to address wrapped onto two lines but the next line (PO phase, etc.) didn\u2019t move down, so they overlapped. Header rows now advance by the text\u2019s actual height, so nothing overlaps regardless of address length. No migration.',
  ] },
  { version: '0.93.0', date: '2026-09-22', changes: [
    'PO now stays editable after Monday sync. Previously an item\u2019s PO phase went read-only the moment it was synced to Monday, so you couldn\u2019t group or generate a PO for synced items. PO phase can now be set on items that are Surveyed OR Synced, and the PO PDF includes synced items \u2014 it only locks when you click \u201cMark ready\u201d for that phase (admin can still unlock). PO phase is an internal grouping and isn\u2019t pushed to Monday, so editing it on a synced item doesn\u2019t disturb the board. No migration.',
  ] },
  { version: '0.92.1', date: '2026-09-22', changes: [
    'Fix: linking a Monday board (or Sync all / Pull fitters) failed with \u201cCannot coerce to single JSON object\u201d on any job whose client.job code was shared by more than one job. The Monday sync tab was still identifying jobs by that non-unique code; it now uses each job\u2019s unique id for board-link, sync and pull, matching the rest of the app. Display still shows the code. No migration.',
  ] },
  { version: '0.92.0', date: '2026-09-22', changes: [
    'Items: bulk \u201cMark surveyed\u201d. Select any number of Unfinished items and click Mark surveyed in the selection bar \u2014 it promotes every selected item whose mandatory fields are all complete to Surveyed (and clears the Unfinished flag), skipping any still missing a required field (so an incomplete item is never promoted). Already-synced items aren\u2019t downgraded. Reports how many were promoted and how many were skipped. Needs items.edit; no migration.',
  ] },
  { version: '0.91.0', date: '2026-09-22', changes: [
    'PO PDF: choose the item sort order. Next to the PO phase picker there\u2019s now a sort dropdown \u2014 by Flat (default), by Floor, by Item code (groups all like windows/doors together, e.g. every W02), or by Full code (the previous behaviour). Sorting is natural/numeric, so flat 13 no longer splits across pages the way the old code-string order did.',
  ] },
  { version: '0.90.1', date: '2026-09-22', changes: [
    'Fix: Excel import now recognises Material spellings — “PVC”, “PVCu”, “uPVC” all import as uPVC (and alu/aluminum → Aluminium, wood → Timber), so the value matches the item dropdown instead of coming through blank. Separately, the item detail dropdowns (Material, etc.) now keep any non-standard stored value visible rather than silently blanking it, so a legacy value is never lost when you open and save an item.',
  ] },
  { version: '0.90.0', date: '2026-09-22', changes: [
    'Items: mass-update every mandatory field. The “Set on selected” bulk bar now covers all required item fields, grouped into Location (Block, Elevation, Floor, Flat, Room, Item code — these rebuild the item code and skip items already synced to Monday) and Specification (Material, Item type, Glass (panes), Glass texture, Width, Height, Open in/out, Style/design code). Tick the items, pick a field and value, and Apply sets it on all of them at once (leave the value blank to clear). Where the field is one that syncs to Monday, changed items are automatically re-flagged for re-sync. Needs items.edit; no migration.',
  ] },
  { version: '0.89.1', date: '2026-09-19', changes: [
    'Style fix: the sign-off, invoice and QA-checklist dialog buttons now use the standard footer styling (magenta primary + outlined secondary), instead of showing as plain browser buttons.',
  ] },
  { version: '0.89.0', date: '2026-09-19', changes: [
    'Install sign-off (Operations ▸ Sign-off, admin / office). A new tab lists every flat on a job with its install progress — items, how many are installed, open snags, and whether it’s ready (all installs done). Open a flat to run a QA checklist (each line ticks Pass by default; untick and note anything that fails), see that flat’s after-install photos, mark the flat Passed or Failed with handover notes, and save. Signed-off flats show a Passed/Failed badge and can produce a one-page handover certificate PDF (checklist results, notes, who signed and when, and the after-photos). Admins can edit the tenant’s checklist wording; each sign-off snapshots the checklist it was saved with, so past records never change. New qa.signoff capability (admin + office only); the sign-off table is tenant-read with admin/office-only writes. Requires migration 0045.',
  ] },
  { version: '0.88.0', date: '2026-09-17', changes: [
    'Client invoicing (Finance ▸ Invoices, admin / invoice manager only). Raise a VAT invoice from any priced job: it snapshots the customer price breakdown at that moment (so the invoice never changes even if items are edited later), adds VAT at a rate you set, and gives it a sequential number (INV-0001…). Each invoice tracks a status — Draft → Awaiting payment (Send) → Paid, or Void — with a “Mark paid” action (optional payment reference) and “Mark unpaid” to reverse. Summary cards show total Outstanding, Paid and Overdue at a glance, and overdue invoices are flagged. Download a clean customer-facing invoice PDF (line items per flat, doors, communal and variations, subtotal, VAT and total, with a PAID stamp once settled). Drafts are editable (bill-to address, notes, due date, VAT) and deletable; issued invoices are voided rather than deleted. Fully finance-walled: the table has its own RLS and every endpoint is capability-gated, so office / field / mobile never see it. Requires migration 0044.',
  ] },
  { version: '0.87.1', date: '2026-09-11', changes: [
    'Mapping: Build grid now labels the first floor GF (ground floor), then F1, F2, … (still editable).',
  ] },
  { version: '0.87.0', date: '2026-09-11', changes: [
    'Mapping: a live running total of windows and doors (and total items) updates as you type counts into the elevation/floor grids. It’s pinned to the top so it stays visible while you scroll through the elevations. No migration needed.',
  ] },
  { version: '0.86.0', date: '2026-09-11', changes: [
    'New/Edit job: a “Multi-elevation flats” checkbox (unticked by default) — unticked means single-elevation flats, ticked means multi-elevation flats. Saved on the job. Requires migration 0042.',
  ] },
  { version: '0.85.0', date: '2026-09-10', changes: [
    'Style (design code) is now a mandatory field everywhere: items without a style count as Unfinished, can’t be marked Surveyed, and can’t be created from the New-item form; the Excel import grid flags a missing style like any other required field. No migration needed.',
  ] },
  { version: '0.84.2', date: '2026-09-10', changes: [
    'Fix: “Save & mark Surveyed” now refuses to promote an item to Surveyed while required data is missing — it lists exactly what’s missing (including the style / design code) and highlights those fields. Enforced on the server too, so no path can mark an incomplete item Surveyed. Style is now required to survey an item.',
  ] },
  { version: '0.84.1', date: '2026-09-10', changes: [
    'Fix: the item detail drawer now has editable Flat and Room fields, so you can complete a required Room right there (previously Room was flagged as needed but only editable from the Items table). Changing them rebuilds the code and is locked once synced to Monday; the “to finish” highlight now marks Room/Flat in the drawer.',
  ] },
  { version: '0.84.0', date: '2026-09-10', changes: [
    'PO phase lock. Once a PO phase is set, a “Mark ready” button (next to PO PDF) marks it ready for ordering: its items are stamped with who marked it and when, and locked from PO-phase changes — the PO cell shows a lock and can only be changed by an admin (who also gets an “Unlock” action). The purchase-order PDF now prints a generation stamp (generated by whom, date and time) and, when set, a “Ready for PO” stamp. Requires migration 0041.',
  ] },
  { version: '0.83.0', date: '2026-09-10', changes: [
    'Per-item activity log. Open any item and the drawer now shows an Activity timeline (newest first) — who created it and how (loaded via mapping / import, or added manually), and every change since with the person, their role, the timestamp, and the exact field change (e.g. Width: 640 → 660). Edits now record field-level before→after; item creation records who and via what. Shows the latest 20 with a “show all” link. Requires migration 0040.',
  ] },
  { version: '0.82.0', date: '2026-09-10', changes: [
    'Items header toolbar redesigned. The mixed buttons are now grouped: job actions (Files, Edit, Delete) sit in one quiet segmented control with Delete as a red trash icon; PO (phase picker + PDF) is a second bound control; and “New item” is the single accent button, pushed to the right. Consistent styling and small icons throughout.',
  ] },
  { version: '0.81.2', date: '2026-09-10', changes: [
    'Mapping: after Save, the “Preloaded items” table clears so it’s obvious the items have been created (no more stale rows left on screen).',
  ] },
  { version: '0.81.1', date: '2026-09-10', changes: [
    'Mapping fix: building a plan now requires explicitly picking a job in the “Build a plan for job” list. If nothing is picked, Build grid / Preload / Save are blocked (they no longer silently save to the first job). The job list on the left of the Items screen is now grouped into collapsible sections — Live, Pending and Job done (by programme end date) — with a count per group and each group remembers whether it’s open. Removed the counts line beside the Mapping picker.',
  ] },
  { version: '0.81.0', date: '2026-09-10', changes: [
    'Mapping: a job picker at the top of the screen to choose which job to build a plan for. It lists only jobs that don’t have any items yet, grouped by programme status — Live (a programme end date still to come), Pending (no date), and Job done (programme end date has passed). No migration needed.',
  ] },
  { version: '0.80.0', date: '2026-09-09', changes: [
    'Mapping: build by elevations × floors. Enter a Block, a Number of elevations and a Number of floors, then “Build grid” — you get a separate floor grid (F1…FN) per elevation to fill windows & doors, and Preload expands every elevation into the review table (each row keeps its own elevation, editable) before Save.',
    'Jobs: a Delivery address (with its own postcode) is now captured on New/Edit job, with a “Delivery address is the same as the site address” tick (default off). Site address is now mandatory too. The delivery address prints in the purchase-order PDF header (“Deliver to”). Requires migration 0039.',
    'Items: a new “Omit” install status. On the Budget screen an “Include Omit items” tick (default off) controls whether omitted items are counted in the budget/price and the customer price PDF. Requires migration 0038.',
  ] },
  { version: '0.79.0', date: '2026-09-09', changes: [
    'Purchase orders. New PO column in the Items table: assign a phase number (1, 2, 3…) to group items — editable only once an item is Surveyed. Filter the table by PO phase, and set a phase on many items at once via bulk edit (Set on selected → PO phase). A “PO PDF” button (top of the Items view) generates a landscape purchase-order document for a chosen phase, listing every Surveyed item with BOTH the full item code and a short code (“Flat 16A Bathroom”, or the item code like W1/D1 when there’s no flat), full spec (type / material / style, W×H, glass / glazing / safety, open / cill, qty) and the style sketch. Requires migration 0037.',
  ] },
  { version: '0.78.2', date: '2026-09-09', changes: [
    'Fix: the “Clear screen & delete draft” button on the Excel import panel was invisible — it used a white-on-purple style meant for the selection bar, so it rendered white-on-white on the light toolbar. Both it and the red “Delete items imported” button now have proper import-toolbar styling and are clearly visible.',
  ] },
  { version: '0.78.1', date: '2026-09-09', changes: [
    'Import from Excel: clearer wording for the two clear/delete buttons. “Clear screen & delete draft” (in the grid toolbar) empties the on-screen grid and resets the file picker so you can re-import an adjusted version of the same sheet — it only clears the draft, not the Items board. A short hint and a tooltip now spell this out, distinct from “Delete items imported to this job”, which removes rows already uploaded to the Items board.',
  ] },
  { version: '0.78.0', date: '2026-09-09', changes: [
    'Import from Excel: duplicate checking. A “Check duplicates” checkbox (on by default) on the Mapping import panel — when on, rows whose item code repeats in the sheet, or already exists in the job’s Items, are highlighted red and marked as duplicates live in the grid (with a “Duplicates only” filter). On Upload to Items, those duplicates are skipped: uploaded rows clear from the screen, skipped ones stay with a reason (“Already in Items” / “Duplicate row”) so you can fix them. Untick the box to skip all duplicate checking. The setting is remembered per browser.',
  ] },
  { version: '0.77.0', date: '2026-09-09', changes: [
    'Import from Excel: a “Delete items imported to this job” button removes items previously uploaded from a sheet (items already synced to Monday are kept), so you can re-import cleanly. Item edit screen: the required fields still needed to finish an item are now highlighted in the same amber as the Unfinished badge, with a short note at the top listing anything to set in the Items table (Block/Elevation/Room/Flat) — so it’s obvious what to complete. Requires migration 0036.',
  ] },
  { version: '0.76.0', date: '2026-09-09', changes: [
    'Jobs can now share the same client.job code (e.g. two “AXS.PAD” sites). The free-text Site code is now each job’s unique identifier — give the second job a different Site code. Item codes are now unique per job (not per tenant), so each site can independently hold the same B3…W2 code. Jobs are addressed internally by a stable id, so renaming a Site code no longer risks clashes. Import from Excel: the clear button is now “Clear screen & delete draft”. Requires migration 0035.',
  ] },
  { version: '0.75.0', date: '2026-09-09', changes: [
    'Operations → Mapping: Import from Excel. Upload a survey sheet (the Main tab) to load every row into an editable, filterable grid — all columns editable, saved as a per-job draft on the server (survives, visible to the team). When ready, ‘Upload to Items’ creates the items in one go. Any row missing required data (Block, Elevation, Flat or Floor, Room, Item, Material, Item type, Glass, Glazing, Width, Height, Open in/out) is still created but flagged ‘Unfinished’ — a new status shown in the Items view with its own filter, and an item clears the flag automatically once its details are completed. Requires migration 0034 (adds import_drafts + survey_items.incomplete).',
  ] },
  { version: '0.74.0', date: '2026-09-08', changes: [
    'Admin → Billing: usage billing per tenant. Set a per-item rate for each tenant; the screen shows items created in a chosen month × that rate, with a total, for monthly invoicing. Each admin sees their own tenant; the Acemark (vendor) super-admin sees every tenant and can edit each rate inline. Counts all survey items created that month. Requires migration 0033 (adds tenants.item_rate_pennies).',
  ] },
  { version: '0.73.0', date: '2026-09-08', changes: [
    'Grouped navigation: the top menu is now organised into five dropdown groups \u2014 Operations (Dashboard, Items, Mapping, Plans, Calendar), Sales (Leads), CRM (Customers), Finance (Budget) and Admin (Teams & rates, Monday sync, Test, Users, Roles, Logs). Groups you have no access to are hidden. New Leads tab lists demo/quote leads (and holds the quote-destination email, moved from Users); new Customers tab lists customer portal accounts.',
  ] },
  { version: '0.72.0', date: '2026-09-08', changes: [
    'QA tab: a version dropdown lets you view test results from any previous app version (results are recorded per version, so the tab starts fresh each deploy). Past versions open read-only; the current version stays editable. CSV export follows the selected version. Nothing was ever deleted \u2014 this just surfaces the history.',
  ] },
  { version: '0.71.1', date: '2026-09-08', changes: [
    'Site code now shows in the left jobs list (the free-text site code labels each job for users), while the top header and item codes keep using the job code (client.job). Hover a job in the list to see its job code.',
  ] },
  { version: '0.71.0', date: '2026-09-08', changes: [
    'Jobs: a separate Site code. New/Edit job now has a \'Site code\' field shown on screen (the top header now displays it instead of the raw client.job), while item codes still build from client_code.job_code. Optional \u2014 defaults to CLIENT.JOB when blank. Existing jobs are backfilled from client.job (migration 0032).',
  ] },
  { version: '0.70.5', date: '2026-09-08', changes: [
    'Budget: \'Our cost (budget)\' and \'Margin\' (amount and %) are temporarily shown as £0 / 0 and marked \'under review\', while the internal cost model is reworked. Customer price is unaffected.',
  ] },
  { version: '0.70.4', date: '2026-09-07', changes: [
    'Budget: a warning now appears when windows have no Width/Height, e.g. \'N windows have no dimensions — their m² charges (extra windows and COM units) are £0 until you add dimensions\'. Explains why m²-based amounts read zero even when the rate is set.',
  ] },
  { version: '0.70.3', date: '2026-09-07', changes: [
    'Budget: commercial units are recognised by the label COM or COMM (e.g. COM, COMM, COM-1, COMM2) and billed by the m² rate. Tightened so ordinary words that merely start with \'com\' are not misread as commercial.',
  ] },
  { version: '0.70.2', date: '2026-09-07', changes: [
    'Budget: COM (commercial/communal) units are now billed by the m² rate instead of the fixed per-flat rate. Detection widened from labels starting \'COMM\' to \'COM\', so a flat labelled COM/Com/com is priced on its window m² (rate per m²) and never counts as a fixed-rate flat. Breakdown/PDF labels updated to "Communal / COM".',
  ] },
  { version: '0.70.1', date: '2026-09-07', changes: [
    'Fix: inline Flat edits in the Items tab now store the value in uppercase, matching the bulk update and new-item form. Previously a Flat typed as \'com\'/\'Com\' was saved as-is but shown uppercased by the grid (text-transform), so identical-looking flats could be stored as different values and split per-flat pricing/reports.',
  ] },
  { version: '0.70.0', date: '2026-09-07', changes: [
    'Demo quote destination is now configurable. In the Users tab (admin) there\'s a "Demo — quote request destination" field to set the email that the mobile app\'s "Request a quote" opens a message to. Stored in a new app_config table (migration 0031) and read live by the mobile app; falls back to the built-in default if unset.',
  ] },
  { version: '0.69.0', date: '2026-09-07', changes: [
    'Per-team scoping on the Calendar and Gantt. Both now default to the signed-in user\'s team when they belong to one (fitters land on their own team\'s work), and the Gantt gains a team filter dropdown like the month calendar already has. It\'s a default, not a lock — anyone can switch the filter to "All teams" or another team.',
  ] },
  { version: '0.68.0', date: '2026-09-07', changes: [
    'Calendar/Gantt access opened up. A new "View calendar" capability now controls the Calendar tab (previously tied to the dashboard permission). It is granted to Office, Surveyor, Scanner, Fitter and Invoice manager (Admin always has it) — so those roles can now open the install calendar and programme Gantt. Everyone who can view sees all jobs; per-team filtering can come later.',
  ] },
  { version: '0.67.2', date: '2026-09-03', changes: [
    'New/Edit job: clicking outside the popup (or the ✕) when you have unsaved changes now asks to confirm before discarding, so you no longer lose what you were typing. Saving still closes normally.',
  ] },
  { version: '0.67.1', date: '2026-09-03', changes: [
    'Gantt polish: the Month / Gantt toggle buttons are now properly sized (no more overlap), and each job row shows its full name (wraps instead of being cut off).',
  ] },
  { version: '0.67.0', date: '2026-09-03', changes: [
    'Programme dates on jobs. The New job and Edit job screens now have a Dates tab with six start/end date pairs: Programme (overall), Mapping, Survey, Scaffold erect, Scaffold dismantle, and Fitting. All optional. (These are planning dates, separate from the operational mapping-start that releases a job to scanners.)',
    'Gantt view on the Calendar tab. A new Month / Gantt toggle switches the Calendar between the existing install calendar and a programme timeline — one row per job, a coloured bar per phase, with month gridlines and a legend. Requires migration 0029 (adds the date columns). Calendar filtering/access refinements to follow.',
  ] },
  { version: '0.66.0', date: '2026-09-03', changes: [
    'Multi-page PDF plans. You can now pick a PDF for a plan (from disk or from a job\'s attached files) — each page is rendered to an image in your browser and added as its own plan, named "Base (1/3)", "(2/3)"… so every page is independently pinnable. Single-page PDFs and images work as before. PDF rendering uses a self-hosted pdf.js (no external CDN), loaded only when you add a PDF.',
  ] },
  { version: '0.65.1', date: '2026-09-03', changes: [
    'The job\'s postcode now shows next to the job name in the header at the top of the Items screen.',
  ] },
  { version: '0.65.0', date: '2026-09-02', changes: [
    'Plans access for field roles. Scanner and Surveyor now see the Plans tab and can upload plan images, pin items, and switch plans (new plans.view / plans.manage / plans.pin capabilities). PDF report buttons stay office/admin only.',
    'Postcode is now a required field when creating a job. Admins/office can edit a job\'s name, address and postcode any time via a new "Edit job" button next to Files (per-job header).',
    'Add a plan image from a job\'s attached files. Alongside "Upload from disk", a new "From job files" button lets you pick any image already attached to the job and use it as a plan. Requires migration 0028 (adds jobs.postcode).',
  ] },
  { version: '0.64.1', date: '2026-09-02', changes: [
    'Item edit screen tidy-up. Width and Height now sit side by side in a highlighted Dimensions box so they stand out. Transoms (button + 3 fields) and Mullions (button + 3 fields) are each grouped and separated by a thin divider line. The Snags section is hidden for surveyor and scanner roles (still shown for admin/office).',
  ] },
  { version: '0.64.0', date: '2026-09-02', changes: [
    'Job file attachments. When creating a job you can now attach drawings/files (jpg, pdf, zip; up to 25MB each). On any job, a Files button (in the Items header) and a ... on the job in the left list open a Files window: images and PDFs preview/open in the browser, everything else downloads. Managers can add more files or delete them there. Requires migration 0027 (adds job_files + the jobfiles storage bucket is auto-created).',
  ] },
  { version: '0.63.2', date: '2026-09-02', changes: [
    'Bulk update: the Apply button now shows an \'Applying…\' state (disabled) with an \'Applying to N item(s)…\' message while the update runs, and reports the result when done — so you can tell it worked.',
  ] },
  { version: '0.63.1', date: '2026-09-02', changes: [
    'Fix: bulk-updating Floor no longer clears Flat (and vice versa). Floor and Flat are independent fields; updating one via mass-update, or editing Flat inline, keeps the other intact. The item code still uses Flat as its F-segment when present. If some items lost their Flat, select them and bulk-set Flat again to restore it.',
  ] },
  { version: '0.63.0', date: '2026-09-01', changes: [
    'Office item edit screen: richer, guided spec. Material and Window type are now dropdowns (uPVC/Aluminium/Timber/Composite; Casement/Fixed/Tilt & Turn/Sash). Glass is split into three choices - Glass (Double/Triple), Glass texture (Clear/Obscure/Contara/Satin/Stipolite) and Glazing bars (None/Astragal/Georgian/Leaded/Diamonds). Safety glass (Toughened/Laminated) and Cill depth (Stub/155mm/85mm/180mm) are dropdowns too. Added Transom equal and Mullion equal tick boxes (when ticked the transom/mullion sizes are optional); these sync to new Monday checkbox columns. Coupled and Add-ons are clearly optional. Save details now keeps the screen open, and a new Save & mark Surveyed button advances the item to the Surveyed stage. Requires migration 0026; new Monday columns (Glazing Bars, Transom Equal, Mullion Equal) are auto-created on board link.',
    'Items tab: the Room column now shows the full room name (e.g. Kitchen (KT)) and edits via a room picker.',
  ] },
  { version: '0.62.3', date: '2026-09-01', changes: [
    'Hover your name (top-right) to see your signed-in role in a small tooltip.',
  ] },
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
