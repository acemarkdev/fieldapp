// Single source of truth for the app version, shared by web (and later mobile).
// Bump APP_VERSION and add a CHANGELOG entry whenever we ship a change.
//   MAJOR.MINOR.PATCH — MINOR for new features, PATCH for fixes/tweaks.
export const APP_VERSION = '1.69.0';

export interface ChangelogEntry { version: string; date: string; changes: string[]; }

export const CHANGELOG: ChangelogEntry[] = [
  { version: '1.69.0', date: '2026-10-29', changes: [
    'Production time ▸ WEM analysis, step 3 of WEM time measurement. For any period, per task code: minutes of Praca, Przezbrojenie and Poprawka, pieces (from Praca only — rework is never a new piece), work minutes and all minutes per piece, % lost and labour cost per piece at each worker’s own rate. Headline figures (hours, % lost, downtime, labour cost, data gaps), top 5 by % lost and by minutes per piece, one Sash / Casement / Drzwi in hours and zł once every code of its path is measured, a weekly trend (all codes, or the code clicked) and the table grouped by code, department, product, element, activity or workstation.',
    'Exports: the analysis per code (as analiza.py) and the time entries in the WEM layout — ID;Pracownik;Nr zlecenia;Poz.;Kod tasku;Rodzaj czasu;Start;Stop;Ilość wykonana;Uwagi. Costs only for roles that see rates.',
  ] },
  { version: '1.68.1', date: '2026-10-28', changes: [
    'Production time (Acemark and WEM): delete for one or many. Tasks: a “delete” link on each task and “Delete selected” for the ticked ones — time already logged on them stays on the job. Time entries: a tick box on each row (and one to tick all shown) with “Delete selected”; each deleted entry goes to the log of time changes.',
  ] },
  { version: '1.68.0', date: '2026-10-28', changes: [
    'Production time ▸ WEM, step 2 of WEM time measurement (phone 0.76.5). A WEM task made from an order asks the time type at START — Praca, Przezbrojenie, Poprawka — and the quantity done at STOP, also when the worker starts another task over it (work: prefilled with what is left of the plan; setup: 0; rework: typed, never counted as new pieces). On the phone each WEM task shows its workstation and “done / planned” (everyone’s work entries), in the order of the work; Moje wpisy show type and quantity and can correct them (7 days).',
    'Office ▸ Production time (WEM): time entries show the type and the quantity done, and the manager can correct both in the entry window. Needs migration 0115.',
  ] },
  { version: '1.67.0', date: '2026-10-28', changes: [
    'Production time ▸ WEM, step 1 of WEM time measurement. Task catalogue: the 89 fixed task codes from the WEM file (PRODUKT-ELEMENT-CZYNNOŚĆ, e.g. SAS-SKR-ST05 = Sash, skrzydło, czopowanie) with department, product, element, activity, workstation and unit, loaded on first use. Names, workstations and units can be corrected and a code switched off; the code itself never changes. A newer catalogue file (CSV) can be loaded.',
    'WEM orders: type the order (number, client, positions — product, quantity, sashes per unit, material, horns / vents / restrictors per unit, size) and saving creates its tasks with the rules of the WEM workbook: kantówka skips cutting along and planing, sash tasks × sashes, add-ons per unit, downtime and other once. Each task carries its code, position, workstation and planned quantity. Saving again updates the quantities, adds new tasks and closes the ones no longer in the order; close or reopen all tasks of an order at once. Needs migration 0114.',
  ] },
  { version: '1.66.1', date: '2026-10-28', changes: [
    'Sales orders: the other sales reps’ fees are part of the budget. The order’s budget cost and margin include them (a % is of the order net); on the actual side they count once due, with the order’s first payment. Budget against actual shows them as their own line, “Other sales reps (fees)”. Each quote version counts the fees at its own amount — a new REP FEES column, and the quote form’s live total and margin include them. CSV: an “Other reps fees” column.',
  ] },
  { version: '1.66.0', date: '2026-10-28', changes: [
    'Sales orders, step C of replacing the monday Enquiries board — more than one sales rep. Finance section: Sales rep (main) with a “Bonus applies” tick, on by default; unticked, the order does not count in that rep’s monthly commission bands. “+ Add sales rep” adds any number of other reps — a rep from the app or any other name — each paid a fixed amount or a % of the order’s net value (the approved quote), shown as you type with the order’s total.',
    'The other reps’ lump sums are due in the month the order starts to count (its first payment), like commission. Commission page: a new card lists the lump sums of the rep picked (also on orders that belong to another rep) and notes the orders whose main-rep bonus is switched off. Performance ▸ commission accrual now includes the lump sums. CSV export: main rep bonus and other reps. Needs migration 0113.',
  ] },
  { version: '1.65.0', date: '2026-10-27', changes: [
    'Sales orders, step B of replacing the monday Enquiries board — quotes to the customer. Each quote is a version: the amount, the file sent, deliver and install or delivery only, and the budget behind it (purchase, installation, delivery — installation left out for delivery only), with the total cost and the margin against the 30 % rule. Status per version: Quote sent, Quote approved, Rejected, Rework; “+ New version” copies the previous one. Amount and file stay as sent — a change is a new version; the budget can be corrected.',
    'The quote in force — the approved version, else the newest — sets the order’s net value, budget and status: approved → Accepted (the confirmed realisation date opens), newest rejected → Lost, otherwise Offer. Only one version can be approved. Once the order has its Z job, the budget costs come from the job as before. Orders without a quote keep their typed value and budget. The list shows the quote version next to the status.',
    'Customer documents on the order, in versions: the first note with its file is v1; every later file is the next version and needs a comment (what changed). The newest is in bold as current; older versions are marked outdated and can still be opened. Needs migration 0112.',
  ] },
  { version: '1.64.0', date: '2026-10-27', changes: [
    'Sales orders, step A of replacing the monday Enquiries board. The order number is built for you: OK + the customer’s country + the next free number + your own text (OK DE203066 - Mülheim, Krüger). The form shows the next number; it is taken only when the order is saved. An admin can type the number and set the next one while orders still come from monday; once saved, the number and country stay unless an admin changes them.',
    'Customers: a customer list to pick from — typing filters it, and when nothing matches “+ New customer” opens a short form (two name lines, street, postal code, city, country, phone, e-mail). The order’s country follows the customer. “Same as delivery address” is ticked by default; untick it to type a delivery address for this order only. Load from monday adds the board’s customers to the list (matched by name; country from the OK number).',
    'Material: tick one or more of PVC, Alu and Timber (old “Wood” shows as Timber). Enquiry received is now a date (dd-mm-yy). Planned realisation is replaced by Requested realisation (a date or just a month) and Confirmed realisation date, which opens once the order is accepted; planning and Performance use the confirmed date, else the requested one. Needs migration 0111 — until then the form works without the customer list and the new dates.',
  ] },
  { version: '1.63.0', date: '2026-10-27', changes: [
    'Performance ▸ Result, UoR / IFRS views: trade purchases matched to the sale. Each order’s part of a trade purchase invoice (499.V Handel, split by its KSeF lines as in Sales orders) counts in the month of that order’s first final sales invoice; an order not invoiced yet = a new memo line, trade goods bought, not sold yet. A part not placed on any order stays in its invoice month. Exchange differences stay outside the app (they need the payment dates). No migration.',
  ] },
  { version: '1.62.0', date: '2026-10-27', changes: [
    'Performance ▸ Result, UoR / IFRS views — three more gaps closed. Job costs matched to the sale: a Z job’s material (RW) and the invoices booked to it count in the month of its first final invoice, like its revenue; until then they are work in progress (a memo line, not in the result). The invoices booked to a job are no longer counted again as department invoices.',
    'Stock write-down to net realisable value: the provision is 50 % of the 1–2 y and 100 % of the over-2 y stock at each month end (from the Stock value history; admin can change the % on the line); the month’s cost is the change in the provision, below EBITDA. The provision itself is a memo line.',
    'Accruals: the reps’ commission in the month it is earned (from Sales orders, each rep’s bands); holiday and bonus accruals typed per month (✎), like depreciation — needs migration 0110. Not covered yet: exchange differences, and trade purchases matched to the sale month.',
  ] },
  { version: '1.61.0', date: '2026-10-26', changes: [
    'Order-to-actuals step 3. Production invoices are booked to the Z job: after each monday costs sync, an invoice whose Zlecenie names one Z becomes a cost line of that job — glass suppliers (Stan Szkło, Press Glass, A2 Projekt, Binnglass, N&C, Premier) as Glass, 416 Materials Run and 500 Montaż as Extras, 425 Logistics as Transport. 631 profiles and hardware (Cortizo, Aliplast, Aluprof …) are not booked — they come as RW from Subiekt; 499.V Handel stays on the sales order. A line follows the board, moves when the Z is corrected, and a line typed by hand with the same invoice number is replaced. Locked jobs and invoices naming several Z are left out. No migration.',
    'One budget against actual on both screens: the order window (Sales orders) and the job window (Job costs) show the same table for the order and its Z job — revenue, each cost line of the decided scenario (produce: material RW, glass, transport, extras, labour from the phone …; trade: the vendor purchase from the supplier invoices, transport, other job costs), installation (typed + cost reports paid out), total, profit and margin; budget in amber, actual in green or red under 30 %.',
  ] },
  { version: '1.60.0', date: '2026-10-26', changes: [
    'Job costs: the monday stage of each Z job — the group its item is in on PRODUCTION ACEMARK PL (1 Zamówienia … 5 Zakończone, Magazyn) — as a chip next to the reference in the group’s monday colour, with a stripe of that colour on the row, and a filter by stage. Read with Load from monday, every night at 04:00, and with the ↻ monday stages button. A job matches its item by the monday link, else by its Z number (a Z on the board twice is left out). Needs migration 0109.',
  ] },
  { version: '1.59.0', date: '2026-10-26', changes: [
    'Sales orders ⇄ Job costs, step 2 of the order-to-actuals process. The produce scenario comes from monday: PRODUCTION ACEMARK PL has six new columns — Plan: Materiał, Szyby, Panele, Malowanie, Transport, Inne — and Job costs ▸ Load from monday puts them into the budget line by line (a new Z gets all of them; an existing undecided budget only the lines still empty). The preview shows the planned costs.',
    'The trade scenario comes from the order: the rep’s vendor (a supplier other than Acemark PL), purchase cost and delivery cost become the Z budget’s trade side when the Z is linked — only while that side is empty and the budget undecided; the offer too, from the order’s net, when the budget has none. The order gets a Vendor quote field (a link or a note).',
    'monday links: the order window opens its item on Acemark PL Enquiries; the order’s Production job block and the Job costs window open the Z item on PRODUCTION ACEMARK PL. The links are kept by the Load from monday buttons, also for what was loaded before. Needs migration 0108; without it everything works, just without the links and the vendor quote.',
  ] },
  { version: '1.58.0', date: '2026-10-26', changes: [
    'Production time for a second company, WEM, besides Acemark. Admin ▸ Users: production workers, leads, managers and warehouse workers get a company (Time: Acemark / WEM, under the role; empty = Acemark). Tasks are loaded per company — the same task file, imported while that company is chosen.',
    'Each person sees only their company: on the phone a worker sees and starts only their company’s tasks (and “Bez zadania”, moving an entry to another task, stay within it); in the office a production manager or lead sees only their company’s tasks, entries, workers, rates and export. Admin switches between Acemark and WEM in the Production time title.',
    'WEM hours are kept apart: they are never added as labour to Acemark’s Job costs, even on the same job number. Needs migration 0107; before it, everything stays Acemark as today. No phone update needed.',
  ] },
  { version: '1.57.0', date: '2026-10-26', changes: [
    'Sales orders ⇄ Job costs, step 1 of the order-to-actuals process. The Z number reaches the sales order by itself: Job costs ▸ Load from monday links the orders of the board items named “Z.453 -OK PL203173 …” in the same step, and every night at 04:00 the safe ones are linked again (only an empty Z is filled, as with the Z numbers from monday button, which stays).',
    'The decision comes back to the order: deciding a budget (produce or trade) gives its sales order(s) the supplier (Acemark PL, or the vendor) and the budget cost of the chosen scenario — purchase cost, and transport as the delivery cost; the installation cost stays as the rep typed it. A Z linked later, or typed by hand by finance, takes an already decided budget too.',
    'The order shows its Z job: the Z pill in the list carries the decision (Produce / Trade / Rejected); the order window has a Production job block with the offer, both scenarios and the better one, and Open in Job costs.',
    'Job costs: an empty budget offer is filled from the sales order’s net (save to keep it); when they differ, the budget says what the order has. The job window names its sales order. No migration.',
  ] },
  { version: '1.56.1', date: '2026-10-26', changes: [
    'Production time ▸ change log: a worker moving an entry to another task on the phone (FitAWindow 0.76.3) is listed — the old task crossed out, the new one in bold. The phone may now correct own entries of the last 7 days and move them to another task; a task whose job is locked in Job costs cannot be moved into or out of. Needs migrations 0104 and 0105.',
  ] },
  { version: '1.56.0', date: '2026-10-25', changes: [
    'Fin&Ops ▸ Sales orders: Load from monday (finance, admin) — reads the board Acemark PL Enquiries and compares it with Sales orders by the OK number. A preview lists the OK numbers not in Sales orders yet (ticked; a “created on or after” date narrows them), the ones already there (left alone), the ones on the board more than once — phases and revisions — and names without an OK number (never loaded). Load creates the ticked ones: the name as the order, the customer (My Contacts, CRM Customer or the name), Acemark, the month created, won = Accepted, lost / Dead Enquiries = Lost, otherwise Offer, Produkcja = supplier Acemark PL, the Z number and the sales rep when the board has them. The board has no order value: net stays 0. No migration.',
  ] },
  { version: '1.55.0', date: '2026-10-23', changes: [
    'Fin&Ops ▸ Performance: a Result switch — management sheet (as before), UoR or IFRS (first version, Acemark only). UoR / IFRS: a prepayment counts as revenue in the month of its job’s final invoice (not yet delivered = a memo line); trade sales are revenue with the 499.V Handel purchase invoices as the cost of trade goods; production overheads and every other department’s invoices are costs (leasing as a cost); 631 Materials purchases are left out because materials count as RW. Poza bilans is shown under the result as a memo line and never changes it.',
    'IFRS shows the same numbers as UoR for now (trade as principal, revenue at delivery, IFRS 16 not applied) — the assumptions and what is not covered yet (materials timing, stock write-down, accruals, exchange differences) are written under the result and in the CSV.',
  ] },
  { version: '1.54.1', date: '2026-10-23', changes: [
    'Fin&Ops: a Subiekt sales invoice with no job in its Podtytuł now counts as Sales from Orpiszew, not as Trade from Poland. Before, it was added in Sales and taken out again as “Other income (Trade from Poland)”, so Performance ▸ RESULT came out too low. A Subiekt invoice with an OK (trade) number stays trade; typed and imported invoices keep their producer rule.',
  ] },
  { version: '1.54.0', date: '2026-10-23', changes: [
    'Fin&Ops ▸ Stock value: a new product window — the name with warehouse, supplier and group; tiles for quantity, value, average unit cost and last issue (red when nothing was issued for 6 months); the age bar with its shares; each delivery’s age in the colour of its age bucket. A Cortizo item shows its drawing from the Cortizo catalogue, the reference, description, weight and systems (a profile in no catalogue shows the drawing of its HI version).',
    'Stock value: click an age column (0–90 d … > 2 y) to show only the stock of that age, largest first, in the groups and the products; click it again, or VALUE, for all ages.',
  ] },
  { version: '1.53.0', date: '2026-10-23', changes: [
    'Fin&Ops ▸ Sales orders: budget and actual are kept apart. In the order window the planned costs (purchase, installation, delivery) and the planned realisation month are in an amber BUDGET section, and a Budget | Actual table shows purchase (actual = supplier invoices on monday), installation (actual = typed + cost reports paid out), delivery, total cost and margin. The actual side is green, red when the actual margin is under 30 %.',
    'The list: BUDGET COST and BUDGET MARGIN columns in amber, ACTUAL COST and ACTUAL MARGIN in green or red (under 30 %). The CSV has the budget margin, actual cost and actual margin.',
    'The budget no longer includes the fitters’ paid cost reports — they are actuals and count on the actual side only (before, they were added to the budget’s installation cost too).',
  ] },
  { version: '1.52.0', date: '2026-10-23', changes: [
    'Fin&Ops ▸ Sales orders: Z numbers from monday (finance, admin) — reads the board PRODUCTION ACEMARK PL, where an item like “Z.453 -OK PL203173 -PCW - J035030P” says order OK PL203173 is produced as Z.453. A preview lists the orders with no Z number yet (ticked, filled on Load); the rest is listed and never changed: the order has a different Z, several orders share the OK number, the OK number or the Z is on several board items (phases), the Z is already on another order, or no order has that OK number. With the Z number, Subiekt invoices for that Z attach to the order by themselves. No migration.',
  ] },
  { version: '1.51.4', date: '2026-10-23', changes: [
    'Fin&Ops ▸ Sales: the page description now says the invoices come from Subiekt automatically (every 30 minutes; changed in Subiekt) and that + Add invoice is only for what Subiekt does not have, such as a planned invoice. In English and Polish.',
  ] },
  { version: '1.51.3', date: '2026-10-23', changes: [
    'ACE Scaffolding ▸ Enquiries: Export CSV — downloads the enquiries the filters show (all of them, not only the first page): number, received, site / title, customer, status, price, est. profit, follow-up date and estimator / sales. Semicolons and UTF-8, so Excel opens it with the Polish letters right.',
  ] },
  { version: '1.51.2', date: '2026-10-23', changes: [
    'Fin&Ops \u25b8 Payroll reads the files of the other payroll programs used in 2026: the boxed list (\u201cLista P\u0141AC za: Stycze\u0144 2026\u201d, January) and Varico payslips (\u201cWynagrodzenie za miesi\u0105c kwiecie\u0144 2026\u201d, April \u2014 names turned to surname first to match), the ZUS transfer printed letter by letter, and the PIT-4 period after the NIP type (\u201cN 2 6 M 0 2\u201d). The PIT-4 period may be the month of payment (no warning then).',
  ] },
  { version: '1.51.1', date: '2026-10-23', changes: [
    'Labels: the phone is per company \u2014 choosing WEM or Acemark shows and saves that company\u2019s number; Acemark labels print it (Tel.) under the email when it is set. WEM keeps its number.',
  ] },
  { version: '1.51.0', date: '2026-10-23', changes: [
    'Labels: Acemark labels from a CortizoCad PRODUCTION LIST (LP 0004/10/2026 \u2026) \u2014 each position\u2019s size (B \u00d7 H) and quantity is read, the job line is the order (add the Z number in front); the label has the ACEMARK sp. z o.o. details, \u201cWymiar okna:\u201d, the size in large bold and the order line (the \u201cWZ\u00d3R etykiet - druk Acemark\u201d layout). The file decides WEM or Acemark; it can be switched. Untick Company details for anonymous labels.',
    'Labels (WEM and Acemark): Copies of each label \u2014 2 by default, 1\u20138, set on the screen.',
    'Logistics (Labels, Confirmations) moves from Framework to Acemark PL; the Logistics role belongs to Acemark PL. Acemark Finance now has Logistics too.',
  ] },
  { version: '1.50.0', date: '2026-10-22', changes: [
    'After signing in, the home page (business tiles) shows at once \u2014 it no longer waits for all the Framework jobs and items to load (they load behind it). The same for the Scaffolding pages.',
    'ACE Scaffolding: Actual costs on the job window \u2014 lines with day, erection / dismantle / other, what (own crew, subcontractor, transport, materials / hire-in, licence / permits, other), crew or supplier, description and \u00a3; totals for erection, dismantle, other and the actual cost against the estimate, and price \u2212 actual cost. On imported jobs the monday actual costs stay as the starting point. Reports \u25b8 Job profit uses them. Needs migration 0103.',
  ] },
  { version: '1.49.0', date: '2026-10-22', changes: [
    'ACE Scaffolding, phase 6: Reports (new tab) for any period (this year, last 12 months, last year or dates): the pipeline \u2014 enquiries and quoted value per month, won of decided, average quote, days from enquiry to quote, by source and by estimator / sales person; job profit \u2014 price + hire and extras invoiced on top against the estimated and actual costs, per job with a CSV; income \u2014 requests sent to accounts per month (price stages, hire, other); debtors \u2014 unpaid per customer by days late (not due, 1\u201330, 31\u201360, 61\u201390, over 90); and now \u2014 jobs up, scaffolds on hire, unbilled rent, stock value out on sites.',
    'Overview: switch monday off (admin) \u2014 a checklist (last import, check, tell the team, make the monday boards read-only), then the import stops for good and the office app is the only record; it can be switched back on. No migration.',
  ] },
  { version: '1.48.0', date: '2026-10-22', changes: [
    'ACE Scaffolding, phase 4: the phone app for crews (FitAWindow 0.76.1, over the air). New role Scaffolder (crew): My day \u2014 the visits of their crews; a visit shows the site (maps), the contact (call) and the scaffolds; Done (a dismantle reports the day the hire stops), Handover with the client signing with a finger (the hire starts; the certificate is in the job), delivery / collection notes, and the 7-day inspection with photos. The office and admin see all crews (admin: \u201cACE Scaffolding \u2014 crew screen\u201d on the phone).',
    'Office: Planner \u25b8 Crews \u25b8 Members \u2014 who is in each crew (they see its visits on the phone). The job window lists the inspections (safe / not safe, defects, actions, photos); the Planner shows the 7-day inspections due today and overdue. Needs migrations 0101 and 0102.',
  ] },
  { version: '1.47.0', date: '2026-10-22', changes: [
    'ACE Scaffolding, phase 5: Stock (new tab) for tube & fitting \u2014 a starting catalogue of 36 common items (tubes 4\u201321 ft, boards 4\u201313 ft, doubles, swivels, putlogs, sleeves, joint pins, BRCs, toe board clips, reveal pins, base plates, sole boards, ladders, ladder beams, brick guards, netting, Monarflex, gin wheel, tags) with weight and replacement value, and the Yard + Van 1\u20135 \u2014 all editable (Catalogue, Yard and vans).',
    'Every movement is a numbered note (SN-0001) with a PDF to sign: delivery (yard / van \u2192 site), collection (site \u2192 yard / van; \u201cfill with everything on site\u201d; final collection), transfer (yard \u2194 van), goods in, stocktake (enter the count, the difference is recorded). Stock may go negative until counted. The Stock page shows every item per yard, van and on sites, the sites holding stock (pieces, weight, value) and the recent notes.',
    'Estimated materials per scaffold (scaffold \u25b8 Edit) and a 6-week availability forecast: yard + vans after planned erections and dismantles \u2014 short items in red. Job window: Materials on site with + Delivery / + Collection; after the final collection, what is missing can be written off and charged to the customer at replacement value (a request for invoice). New App access entry: Stock. Needs migration 0100.',
  ] },
  { version: '1.46.0', date: '2026-10-22', changes: [
    'ACE Scaffolding, phase 3: Hire & invoicing (new tab). Rent after the included weeks is charged per day \u2014 weekly rate \u00d7 days \u00f7 7 \u2014 up to and including the day the hire stops: the dismantle day the team confirms (on the scaffold; it starts as the down date and can be changed).',
    'Rent run: choose the day to bill up to (end of last week / month, today), weekly- or monthly-billed jobs, tick and create the requests \u2014 one per job, with a line per scaffold and its days. Each job is billed weekly or monthly (set on the job). Alerts: included hire ending within a week; scaffolds on hire, paying rent, unbilled rent to today.',
    'Requests for invoice to accounts (Xero): draft (lines, retention %, payment terms, customer PO, VAT / CIS note, notes \u2014 changeable) \u2192 sent to accounts (fixed; its days count as billed, never billed twice) \u2192 invoiced (Xero number) \u2192 paid; overdue when unpaid after the payment terms; cancel frees the days again. PDF for accounts. On the job: + Rent request and + Price stage (\u00a3 or %). Retention and payment terms are set on the customer. Needs migration 0099.',
  ] },
  { version: '1.45.0', date: '2026-10-22', changes: [
    'ACE Scaffolding, phase 2 (office): the job window can be edited \u2014 status, erected by, PO number, site contact, notes, and a Before we go up checklist (RAMS, design / TG20, licence, alarm, hoist, access, neighbours, inspections booked) with done / not needed, date and note.',
    'Scaffolds per job: a job made from a won quote gets one scaffold per quote line; more can be added \u2014 a variation / adaption (confirmed in writing by whom, when; adds to the job price). Each scaffold goes booked \u2192 up \u2192 on hire (handover) \u2192 dismantle requested (who asked, logged with the time) \u2192 dismantling \u2192 down, with its dates and when its rent starts (handover + included weeks). The job status follows its scaffolds.',
    'Handover certificate: tick the scaffolds, the client signs on the screen (mouse or finger) \u2014 their hire starts that day; the signed certificate PDF downloads and stays on the job.',
    'Planner (new tab): a week per crew \u2014 erect, adapt, inspect, dismantle, deliver, collect; click an empty cell to plan a visit for a job and its scaffolds. An erect visit marked done puts its scaffolds up; a dismantle visit done takes them down. Crews: our own and the subcontractors (the monday ones are added). Needs migration 0098.',
  ] },
  { version: '1.44.1', date: '2026-10-22', changes: [
    'Scaffolding and Cortizo windows: the forms have a margin from the window edge and lighter labels; empty choices show \u201c\u2014\u201d.',
  ] },
  { version: '1.44.0', date: '2026-10-22', changes: [
    'ACE Scaffolding, phase 1 (office): + New enquiry \u2014 the next ACE number; pick the customer (or type a new one with its contact), its contact and site (or a new address), source, domestic / commercial, private / trade, deadline, estimator, sales person and what is needed.',
    'The enquiry window can be edited: status (a reason when declined or lost), follow-up date and what to do, contact, site, people, dates, scope and notes. Enquiries: a Chase-ups due filter and count, and a Follow up column (red when due).',
    'Quotes: revisions v1, v2\u2026 (a new one copies the last); priced elements \u2014 element, description, price (erect + dismantle + the included hire weeks), its labour part, estimated cost up / down, hire weeks, then rent % a week or a fixed \u00a3 a week; live totals with estimated profit and weekly rent. Quote PDF with the company details and terms. Save and mark sent \u2192 the enquiry is Quote sent with a chase-up in a week; Accepted \u2192 won, Create the job gives it the next ACESC number with the price, hire weeks and rent %; Declined with a reason.',
    'Overview \u25b8 Quote settings (admin): company name, address, phone, email, company and VAT numbers, the default opening text, terms and validity. Needs migration 0097.',
  ] },
  { version: '1.43.1', date: '2026-10-22', changes: [
    'Scaffolding import: an enquiry with a job comes in as Won; a quote left at \u201c4. Quote sent\u201d / \u201c5. Quote seen\u201d more than 6 months after the enquiry as \u201cNo answer (old quote)\u201d \u2014 no longer counted as open (Hot, New, Survey\u2026 stay as set).',
    'Scaffolding import: job number typos (ACECS1498, ACES1592) are read; jobs and enquiries with no ACESC / ACE number on monday get the next free number once; test items and bookings without a number are left out.',
  ] },
  { version: '1.43.0', date: '2026-10-22', changes: [
    'ACE Scaffolding, phase 0: the Scaffolding menu now has Enquiries (ACE numbers: status, price, estimated profit, won rate; open / all / per status, per year, search), Jobs (ACESC numbers: erected by, status, up date, hire weeks and rent %, dismantle request) and Customers (with their contacts and sites \u2014 add and change them).',
    'Overview: counts, the next ACE / ACESC numbers and the one-off import from monday (admin): Check shows what would come in from Estimated Enquiries, Project Sheet and the linked My Contacts; Import brings it in. It can be run again until monday is switched off \u2014 anything changed in the app is kept.',
    'New role Scaffolding office: sees only ACE Scaffolding. Admin \u25b8 Roles \u25b8 App access has the Scaffolding apps (Customers & sites, Enquiries, Jobs) to give other roles view or edit. Needs migrations 0095 and 0096.',
  ] },
  { version: '1.42.0', date: '2026-10-22', changes: [
    'Production \u25b8 Cortizo profiles: stock per colour \u2014 each reference shows its Subiekt stock split by colour (RAL + finish, two-colour profiles such as RAL 7016 TD / 9010 CM, named colours such as Br\u0105zowy anoda), with pieces and metres; a colour filter; the colour in the detail window and in the CSV.',
    'References that are in no imported catalogue (standard Casement 3820 / 3830 / 3850 \u2014 the catalogue has only their HI versions \u2014, MP, pivot, sliding profiles and Cortizo hardware) are now taken from Subiekt: the number becomes the reference, described with the Subiekt name and marked \u201cfrom Subiekt\u201d. A standard profile shows the drawing and systems of its HI version. Filter: Only from Subiekt.',
    'COR-15919, COR-10417, COR-770199 now match the catalogue references written without COR-. Full bars (unit sztanga(6500mm)) count as 6.5 m, and the length in the symbol wins over the name; stock kept in metres counts too.',
    'Subiekt symbols with no reference: a Not Cortizo button (admin, production manager) hides other brands and materials \u2014 one symbol or all starting with the same letters (GN*, FAZE*). Hidden patterns are listed and can be shown again. Needs migration 0094.',
  ] },
  { version: '1.41.0', date: '2026-10-22', changes: [
    'New home page with a tile per ACE Group business \u2014 Framework (UK), Acemark PL (PL) and ACE Scaffolding (UK). Each tile lists its screens; click one to go there. The menu then shows only that business (plus Admin); the home button at the top shows the business you are in and takes you back to the tiles. Users with one business go straight in, as before.',
    'Admin \u25b8 Users: a Businesses column \u2014 tick which businesses each user sees. With nothing ticked the role decides (Polish roles \u2192 Acemark PL, others \u2192 Framework); Admin always sees all. Needs migration 0093.',
    'ACE Scaffolding: first page with the development plan; the scaffolding screens arrive there phase by phase.',
  ] },
  { version: '1.40.2', date: '2026-10-21', changes: [
    'Items: Save details now closes the item window once saved (it used to open the item again). If the save fails, the window stays open with what was typed.',
  ] },
  { version: '1.40.1', date: '2026-10-21', changes: [
    'Items: the column filter lists (Block, Elev, Flat, Floor, Room, Item, Stage, PO, Install status, Team) were cut off by the table when only a few rows were shown \u2014 they now open over the page in full (upwards when there is more room above) and close on scroll.',
  ] },
  { version: '1.40.0', date: '2026-10-21', changes: [
    'Items \u25b8 job list (left): one more level \u2014 customer (name from the customer card, A\u2013Z, with its code and job count) \u2192 Live / Pending / Job done \u2192 job. Each level folds and stays folded in this browser; finished jobs start folded.',
  ] },
  { version: '1.39.1', date: '2026-10-21', changes: [
    'Admin \u25b8 Users: a search box (name, email, role, client or team; several words narrow it down), a role filter and a Show inactive tick, with the count of users shown. Filtering keeps any change being typed in a row.',
  ] },
  { version: '1.39.0', date: '2026-10-21', changes: [
    'Warehouse returns (replaces the Zwroty Power App): what comes back from production to the warehouse, logged on the phone in a new Zwroty tab (Warehouse role) with the same form as the issues \u2014 Z order (required), Subiekt symbol (scan or type), quantity, the location where it goes back, box, note. The phone shows how much of that symbol was issued to the Z order and warns before saving a return larger than what is left.',
    'Office \u25b8 Warehouse issues & returns: a Type column and an issues / returns filter. The Excel export has one sheet per Z order and document \u2014 RW for the issues, PW for the returns \u2014 plus Zu\u017cycie (issued \u2212 returned per Z and symbol) and a sheet with every row. Needs migration 0092; the phone part comes as an update to 0.76.0.',
  ] },
  { version: '1.38.0', date: '2026-10-21', changes: [
    'New: Warehouse issues (replaces the Wydania Power App). New role Warehouse: in the FitAWindow phone app (0.76.0) a Wydania tab \u2014 the Z order, the Subiekt item symbol (scan the QR code or type it; name, unit and stock from the Subiekt stock list), quantity, location (scan or type), box and a note \u2014 and the production time log. Workers see and correct only their own issues until they are exported.',
    'Office \u25b8 Production \u25b8 Warehouse issues: filter by status, Z order, person and dates, select and Export to Excel for the RW in Subiekt \u2014 one sheet per Z order (Symbol, Name, Quantity, Unit; the same symbol added up) and a sheet with every issue. Exported issues get an export number and leave the phones; an export can be downloaded again, and an admin can undo it. Open issues can be corrected or deleted. Access per role in Admin \u25b8 Roles (finance edits by default). Needs migrations 0090 then 0091.',
  ] },
  { version: '1.37.0', date: '2026-10-21', changes: [
    'New role: Production team leader. Logs own time in the phone app like a production worker, and runs Production time in the office app \u2014 tasks (import, add, close, reopen) and everyone\u2019s time entries (correct, add, delete, export the hours) \u2014 but never sees rates or z\u0142 amounts: no Workers and rates tab, no amount column or total, rate and amount empty in the export; the server leaves the rates out of what it sends.',
    'Rates are now their own permission (Production rates): production manager and admin keep everything as before. Needs migrations 0088 then 0089, and the phone update so the team leader sees the time screen.',
  ] },
  { version: '1.36.0', date: '2026-10-20', changes: [
    'Production time \u25b8 Time entries: a From \u2013 to date range instead of month + day (opens on today), with quick buttons Today, This week, This month, Last month. The export covers the chosen range.',
    'Phone app (over-the-air update for 0.75.2): today\u2019s entries in Ostatnie wpisy get clear Zmie\u0144 and Usu\u0144 buttons; Usu\u0144 deletes the worker\u2019s own entry after a confirmation (also from the edit window). Same rules as changing: own entries, today only; it shows in the change log. Needs migration 0087.',
  ] },
  { version: '1.35.1', date: '2026-10-20', changes: [
    'Production time \u25b8 Time entries: opens on today (current month + today\u2019s date). A date box picks any day (switching the month if needed); Whole month and Today buttons next to it.',
    'Production time \u25b8 Tasks: a large Select all shown button above the list (Clear selection when all are ticked).',
    'Fix: on the Tasks screen, ticking a task checkbox could do nothing since 1.35.0 (it clashed with the new rate Save buttons).',
  ] },
  { version: '1.35.0', date: '2026-10-20', changes: [
    'Production time \u25b8 Workers and rates: a rate now has a valid-from date (today by default, can be earlier). Every time entry is priced at the worker\u2019s rate valid on the day it was started, so changing a rate no longer re-prices hours already reported \u2014 in Job costs, the entries list and the export. Each worker shows their rate history; a mistaken change can be removed (the earlier rate applies again).',
    'The default labour rate in Job costs works the same way: a change applies to hours logged from today; earlier hours keep the old default. Needs migration 0086 (it copies today\u2019s rates in as valid since the start, so current figures do not move).',
  ] },
  { version: '1.34.2', date: '2026-10-20', changes: [
    'Sign-in page: the email box no longer comes pre-filled with a fixed address (left over from the first version); it starts empty, and the browser can still offer your own saved login.',
  ] },
  { version: '1.34.1', date: '2026-10-20', changes: [
    'Logistics \u25b8 Labels: the phone under the company details is now a setting on the Labels page (next to Company details), saved as the default for everyone. New default: +48 510 744 727 (was +48 690 126 185).',
  ] },
  { version: '1.34.0', date: '2026-10-20', changes: [
    'Admin \u25b8 Roles: App access. Each Fin&Ops tab (Performance, Costs, Job costs, Sales, Payroll, Stock value) can be set per role to off, view or edit \u2014 e.g. give Production managers Job costs to look at. Changes apply at once (people already signed in get them on reload); a changed setting is highlighted against the role\u2019s standard access.',
    'View means look only: the tab opens with no new / import / load buttons, no typing in the grids and job or invoice windows locked; the server refuses any change. Someone with Performance but not Payroll sees the department totals there, not the names on the payroll list.',
  ] },
  { version: '1.33.0', date: '2026-10-19', changes: [
    'Fin&Ops \u25b8 Payroll: Load accountant\u2019s files. Choose the month\u2019s three PDFs (payroll list, ZUS transfer, PIT-4 transfer); the app reads them, checks the people add up to the list\u2019s totals and that the PIT-4 period matches, and shows the split before anything is saved. Salaries = net to pay per group; taxes = ZUS + PIT-4 split by each group\u2019s share of gross pay. The month is then marked From the accountant\u2019s files and is not typed by hand.',
    'Every person on the list belongs to a group: Office, Sales, Production or Other (employed here but recharged elsewhere, e.g. to the UK \u2014 left out of Payroll). New names are asked for when loading; the People on the payroll list table below the months changes groups for the next load.',
    '+ Lump sum on any month adds an amount on top of a department\u2019s salaries (e.g. pay that is not on the list), with a note; no tax is added for it. Needs migration 0085.',
  ] },
  { version: '1.32.0', date: '2026-10-19', changes: [
    'Fin&Ops \u25b8 Job costs: Load from monday (admin). Reads the board PRODUCTION ACEMARK PL and compares it with Job costs by Z number, showing first what it would do: Z jobs not in Job costs yet are created with their budget filled from the board (Wartosc Zlecenia = offered price net, Godziny zalozone = labour hours \u00d7 the default rate); Z numbers that appear more than once on the board are listed and never loaded; jobs already in Job costs are left alone, and only if you tick them their still-empty budget is filled (never a locked job or a decided budget).',
  ] },
  { version: '1.31.1', date: '2026-10-19', changes: [
    'Production managers can also sign in to the FitAWindow phone app and log their own time there, with the same time screen and rules as production workers (phone app 0.75.1). Their office pages are unchanged. Needs migration 0084.',
  ] },
  { version: '1.31.0', date: '2026-10-19', changes: [
    'Fin&Ops \u25b8 Job costs: a budget per job. In the job window: the price offered to the customer, the expected costs of producing it in Orpiszew (the same cost lines as the actual costs; labour = hours \u00d7 rate) and of buying it in and trading it instead, each with its profit and margin, and which option earns more.',
    'An admin decides: produce, trade or reject (the Z number is dropped); the budget is then frozen and can be reopened by an admin. Once costs come in, the window shows budget vs actual line by line, flagged when actual costs are more than 10 % over.',
    'The job list gets Budget (decision + budgeted margin) and vs budget (actual cost minus budget) columns, and filters for the budget state and for jobs over budget. Needs migration 0083.',
  ] },
  { version: '1.30.1', date: '2026-10-19', changes: [
    'Production time: an imported task is named by its Eksport_Clockify text (e.g. Z_437_cnc_Poz_1_cor_70_ind_ho_012_w1), so workers see which position it is; the short operation (\u201ccnc cor 70 ind HO\u201d) is kept for searching. A task added by hand is named the same way. Tasks loaded earlier are renamed with a one-off SQL.',
  ] },
  { version: '1.30.0', date: '2026-10-18', changes: [
    'Dashboard \u25b8 By job: a search box narrows the job list by address, postcode, job name or code as you type, and each job shows its site address \u2014 click it to open the address in Google Maps (Apple Maps on a Mac or iPhone).',
  ] },
  { version: '1.29.1', date: '2026-10-18', changes: [
    'Admin \u25b8 Users: the page and the users table use the full width of the screen, so all columns are visible without scrolling sideways.',
  ] },
  { version: '1.29.0', date: '2026-10-17', changes: [
    'Fin&Ops \u25b8 Stock value: what the stock in Subiekt is worth (FIFO purchase cost of what is left of each delivery, net PLN) and how old it is \u2014 0\u201390 days, 91\u2013180, 181\u2013365, 1\u20132 years, over 2 years \u2014 by supplier, product group or warehouse, with a bar per group.',
    'Click a group for its products, a product for its deliveries (date, age, quantity, unit cost). \u26a0 marks stock with no issue and no receipt for 6 months; a filter shows only those. Age counts from the original delivery: moving stock between warehouses does not make it new.',
    'A history row is kept every day, so any past day and every month-end can be looked at again. Export CSV, Print / PDF. Reconciled with Subiekt\u2019s \u201cRemanent na dzie\u0144\u201d product by product. Needs migration 0081 and Subiekt agent 1.2.',
  ] },
  { version: '1.28.0', date: '2026-10-17', changes: [
    'Production \u25b8 Cortizo profiles: every reference from the Cortizo Center catalogues \u2014 profiles with their sketch, weight (g/m) and surface, and accessories with colour and type \u2014 with the systems and catalogue pages where it appears.',
    'Next to each reference: its stock in Subiekt nexo (warehouses ACE and PROD, pieces and metres from the bar length in the symbol, with the Subiekt products it was matched to). Matched on the custom field, else the symbol: \u201c2015 RAL 7016 CM 1000 mm\u201d is COR-2015, \u201c15919 RAL 9005 CM 1500 mm\u201d is 15919. Search, filter by system and by stock (in stock / in Subiekt / not in Subiekt), export CSV; products supplied by Cortizo that match no catalogue reference are listed separately.',
    'The Subiekt agent (1.1) also sends the stock of every product; -Explore checks Subiekt\u2019s stock tables first. For admins, Production managers and Logistics. Needs migration 0079 and the catalogue import (tools/cortizo-catalogue).',
  ] },
  { version: '1.27.0', date: '2026-10-17', changes: [
    'Specification parameters: every field of the Emplas order forms and the Building Regulations checks (Parts B, F, K, L, O, Q, planning), each set at the level agreed in the Spec Matrix — Customer, Job, Elevation, Flat, Room type or Item — and inherited by the items below it. The most specific level wins (item > room type > flat > elevation > job > customer).',
    'New item types with their own order form: Door, Casement, Flush Casement, Flush Casement Optima, Patio, Shaped and Bay (Window stays for older items). A Patio is priced and paid as a door.',
    'Job ▸ Spec: set values for the job, an elevation, a flat or a room type (e.g. laminated glass for every kitchen). The customer card has a Specification section for values that go on every PO of that customer. The item window shows its order form with where each value comes from, and the item-level fields can be filled in there.',
    'The PO PDF prints the job-wide specification once at the top, and on each item the values set for its elevation, flat, room type or the item itself. Needs migration 0080.',
  ] },
  { version: '1.25.0', date: '2026-10-15', changes: [
    'Production time: the same task set can be loaded again for an order (every row becomes a task; the import says how many have the same name as an open task, so the manager can close the old set).',
    'A \u201cNow running\u201d box shows who is working on which task and for how long; the page refreshes itself every 20 seconds (not while a dialog is open or you are typing).',
    'Tasks screen: search across job, operation, ID and task name; \u201cHide closed\u201d; checkboxes with select all shown, and Close / Reopen selected.',
    'Admins only: a Change log tab with every change to an entry\u2019s start or end time \u2014 who, from the phone or the office, before and after. Needs migration 0078.',
    'Office sign-in no longer runs out after an hour: the session is renewed automatically, so nobody is logged out in the middle of the day.',
  ] },
  { version: '1.24.0', date: '2026-10-14', changes: [
    'Production time (replaces Clockify). New roles: Production (a worker \u2014 the phone app shows only the time screen: search a job\u2019s tasks, Start, Stop; starting another task stops the running one) and Production manager (office app: Production \u25b8 Production time only).',
    'The manager imports the task list from the task file (columns A\u2013F, as today), adds or closes tasks, corrects or adds time entries, sets each worker\u2019s hourly rate, and exports the entries in the old Clockify layout with rate and amount in PLN.',
    'Job costs: logged hours \u00d7 each worker\u2019s rate (the default labour rate where none is set) are added on top of the job\u2019s labour and hours; the job window shows them. Labour cells of such a job are not typed in the grid. A locked job counts only time started before it was locked. Needs migrations 0076 and 0077, and phone app 0.73.0.',
  ] },
  { version: '1.23.1', date: '2026-10-14', changes: [
    'Purchase invoices: \u201cZlecenie\u201d on monday may now hold the order\u2019s Z number as well as its OK number. Invoices whose PDF has not been read yet say so (they were shown as \u201cNo PDF on the board\u201d); a sync now reads up to 400 PDFs. The list explains why a settlement invoice shows more not placed than its net.',
  ] },
  { version: '1.23.0', date: '2026-10-14', changes: [
    'Fin&Ops \u25b8 Sales orders: actual cost per trade order. Trade purchase invoices on the monday invoice board (499.V Handel, from 2026) are read from their KSeF PDF during the monday costs sync, and each line goes to the order named in its \u201cRef.: OK \u2026\u201d (a line without one takes the order of a line with the same WEB number). Advance invoices and \u201cZaliczka\u201d lines are not a cost; corrections count as the change they make. A PDF is used only when its lines add up to the net on the board.',
    'New columns Actual cost and Actual margin (actual purchase + installation incl. paid cost reports + delivery), and the order window lists the purchase invoices. The new Purchase invoices button (finance) lists what could not be placed; write the OK number in the invoice\u2019s \u201cZlecenie\u201d column on monday and the next sync places it. Needs migration 0075.',
  ] },
  { version: '1.22.2', date: '2026-10-14', changes: [
    'Fin&Ops \u25b8 Job costs: Material Cost (RW) can no longer be typed in the grid, since it now comes from Subiekt. Clicking that cell opens the job, where a material line can still be added or edited by hand. The other cost columns stay editable in the grid.',
  ] },
  { version: '1.22.1', date: '2026-10-13', changes: [
    'Fin&Ops \u25b8 Sales \u25b8 Subiekt: the list of documents to check can be exported to CSV (opens in Excel), with an empty column to note the number to enter in Subiekt.',
  ] },
  { version: '1.22.0', date: '2026-10-13', changes: [
    'Subiekt nexo sync (first version). A small agent on the Subiekt machine sends this year\u2019s sales invoices (FS, FL and their corrections) and material issues (RW) every 30 minutes; it only reads from Subiekt. Sales invoices appear on the Sales tab marked \u201cSubiekt\u201d (a typed invoice with the same number is taken over, not duplicated; euro invoices are converted at the rate on the document) and are changed in Subiekt, not in the app.',
    'Material Cost (RW) in Job costs comes from the RW documents, one line each, replacing a material amount typed or imported before; a job that does not exist yet is created. Locked jobs are never changed.',
    'The job is read from the document\u2019s Podtytu\u0142: a Z number, or an OK order number on a trade invoice. When it cannot be read with certainty nothing is guessed \u2014 Sales \u25b8 Subiekt lists the documents to check; add the number in Subiekt and the next sync places it. Invoices that belong to no job can be ticked \u201cnot a job\u201d. Needs migration 0074 and the agent (tools/subiekt-agent).',
  ] },
  { version: '1.21.1', date: '2026-10-13', changes: [
    'Cost reports: the fitter\u2019s order list is shorter \u2014 only accepted orders whose first payment (counts-from month) or planned realisation month is between 3 months back and 2 months ahead. An order with neither date yet is listed while its offer is that recent.',
  ] },
  { version: '1.21.0', date: '2026-10-13', changes: [
    'New role \u201cAcemark Fitter\u201d: sees only the Cost reports form (extra installation costs on a sales order) and their own reports \u2014 no jobs, items, calendar or anything else, and nothing in the mobile app. Set it in Admin \u25b8 Users. Needs migrations 0072 and 0073.',
  ] },
  { version: '1.20.0', date: '2026-10-13', changes: [
    'Cost reports on sales orders: a fitter reports an extra installation cost (travel allowance, fitting bonus, accommodation, travel / fuel, other) against an accepted order in the new Operations \u25b8 Cost reports tab \u2014 a simple phone-friendly form; the date is saved automatically. The fitter sees only the order number and customer, and their own reports with the status.',
    'Fin&Ops \u25b8 Sales orders: the new Cost reports button lists the reports and shows how many wait for you. The sales rep of the order approves or rejects (with a reason); the accountant then marks the report as paid. Only reports marked as paid are added to the order\u2019s installation cost, on top of the amount typed on the order, and so to its costs and margin. The order window shows the reports and the breakdown. Needs migration 0071.',
  ] },
  { version: '1.19.0', date: '2026-10-13', changes: [
    'Fin&Ops \u25b8 Job costs: the cost columns can be typed straight into the grid \u2014 Material Cost (RW), panels, glass, other extras, painting, transport, customs clearance, labour hours and labour cost. Click a cell, type, Enter to save; Tab saves and moves to the next cell, Esc cancels, an empty cell removes the cost. Hours use the labour rate; a typed labour cost keeps the hours.',
    'A cell that holds several cost lines (for example two invoices) shows their number and opens the job instead, and locked jobs stay read-only. Invoice number, supplier and date are still added in the job window. The Job costs manual describes the new way of entering data.',
  ] },
  { version: '1.18.0', date: '2026-10-13', changes: [
    'Fin&Ops \u25b8 Manuals (Instrukcje): a new last tab with the user manuals, in Polish, with screens from the app \u2014 Koszty zlece\u0144 (Job costs), Sprzeda\u017c (Sales) and Zam\u00f3wienia i prowizja (Sales orders and Commission). Finance and admin see all three; a sales rep sees the orders and commission manual. Click a screenshot to open it full size.',
  ] },
  { version: '1.17.2', date: '2026-10-13', changes: [
    'Fin&Ops \u25b8 Job costs: the Sales field label in the job window is now fully in Polish for users set to Polski (it was half English when the sales came from invoices).',
  ] },
  { version: '1.17.1', date: '2026-10-13', changes: [
    'Fin&Ops: one catalogue of order numbers. The Job field on a sales invoice now suggests the numbers from Sales orders (order codes and Z numbers, each with its customer) and says under the field whether the number typed belongs to a sales order \u2014 or warns that the invoice will not show as paid on any order. On the Sales tab, jobs that are on the orders register carry an \u201corder\u201d tag, and the filter has \u201cLinked to a sales order\u201d / \u201cNot linked to a sales order\u201d.',
    'The same list is offered for the reference of a Job costs record, and the Z number on a sales order suggests the Job costs references \u2014 so the three pages use the same numbers. Typing stays free: existing invoices and jobs such as AKCESORIA keep working.',
  ] },
  { version: '1.17.0', date: '2026-10-13', changes: [
    'New Fin&Ops \u25b8 Sales orders: the sales rep\u2019s register, replacing the workbook \u201cwszystkie zlecenia\u201d. One line per offer or order \u2014 number or name (OK DE203065 \u2026 or Z.330), customer, company, supplier, material, month sent, status (offer / accepted / lost), net value, purchase / installation / delivery costs with margin, planned month, notes. Filters, totals, CSV export and \u201cImport from Excel\u201d for the existing sheet (rows already there are skipped; the check step shows what would be added and compares with the Sales tab).',
    'Payments on an order: invoices from the Sales tab attach to it automatically by its number (or by an invoice number noted on the order), and finance can register cash payments on the order. When an OK order goes into production in Orpiszew, finance adds its Z number \u2014 the order keeps both, and invoices under either belong to it.',
    'New Fin&Ops \u25b8 Commission: month by month, the sales counted (full net value of accepted orders in the month their first payment is booked), the rate reached (0% / 1% / 1.5% / 2% on the whole month), the commission, and how much is missing to each threshold; the current month with a progress bar, orders still waiting for a first payment and open offers. Below it the yearly bonus: company turnover for the year, the tier reached (up to 5% / 10% / 15% of yearly gross pay) and what is missing to the next.',
    'New role \u201cSales rep\u201d: sees only Sales orders and Commission, and only their own orders. Finance (Acemark Finance) and admin see every rep, set the Z number, register payments and import; only admin can delete in bulk. Both screens are available in Polish. Requires migrations 0068_sales_rep_role.sql (run first, on its own) then 0069_fin_orders.sql.',
  ] },
  { version: '1.16.3', date: '2026-10-13', changes: [
    'Fin&Ops \u25b8 Sales (admin only): the same clean-up as on Job costs. Tick a job row to select all its invoices, or open the job and tick single invoices; the box in the header selects everything shown. \u201cDelete selected\u201d removes the ticked invoices; with nothing ticked the button is \u201cDelete all shown\u201d and removes every invoice matching the current filters. You confirm by typing the number of invoices. Job costs are not deleted, but jobs that take their sales from the removed invoices will show no sales (locked jobs keep theirs).',
  ] },
  { version: '1.16.2', date: '2026-10-13', changes: [
    'Fin&Ops \u25b8 Job costs (admin only): delete several records at once to clean the page before loading new data. Tick jobs (or the box in the header for all the jobs shown) and click \u201cDelete selected\u201d; with nothing ticked the button is \u201cDelete all shown\u201d and removes every job matching the current filters \u2014 no filters means all of them. You confirm by typing the number of records; locked jobs are included and counted in the warning. Cost lines go with their job. Sales invoices are not touched.',
  ] },
  { version: '1.16.1', date: '2026-10-13', changes: [
    'Logistics \u25b8 Labels: the sheet now matches the label paper \u2014 8 labels of 103 \u00d7 72 mm, centred on A4. Logo and all text are drawn inside each label with a 5 mm safety margin and cannot print outside it; a long size line shrinks to fit and a long job name wraps within the label. Print at 100% / Actual size, not \u201cFit to page\u201d.',
  ] },
  { version: '1.16.0', date: '2026-10-12', changes: [
    'Items: new \u201cPropose install plan\u2026\u201d. Select the items of a job (all or some), click it in the selection bar and set: start date, the teams to use with each team\u2019s items per day (and optionally the dates a team joins or leaves), top floor down or ground floor up, communal items at the end or filling spare capacity on the flats\u2019 days, keep a flat on one day when it fits, block by block, Saturdays, and days off (UK bank holidays are pre-filled). Calculate shows the proposal day by day \u2014 team, flats, item count, end date per team \u2014 and nothing is saved until you click Apply.',
    'Rules: one team per flat (teams never share a flat, and a flat stays with its team if it takes more than a day); a team\u2019s daily capacity is never exceeded; weekends and days off are skipped; installed, omitted and snag rows are left as they are.',
    'Apply sets only the team and the planned install date on each item (and Install status Scheduled where there was none). Items already on Monday are updated there too \u2014 Fitters and the planned date \u2014 so the morning pull keeps the plan; items not on Monday yet take their date with them when first synced.',
    'New \u201cCalendar PDF\u201d for a job (in the plan window after Apply, and next to the job buttons on Items): the installation calendar, one page per month with each planned day listing its flats by team, followed by a day-by-day list.',
  ] },
  { version: '1.15.0', date: '2026-10-11', changes: [
    'Sync to Monday now also sends the item\u2019s style drawing: the sketch for its Design Code is uploaded to the board\u2019s \u201cDesign Sketch\u201d file column as \u201cStyle <code>.png\u201d. It is sent once per item; if the style is changed later, the new drawing is added on the next sync. Snag rows do not get one. The sync message says when a drawing was sent, or why it could not be (for example no \u201cDesign Sketch\u201d column on the board). Requires migration 0067_style_sketch_pushed.sql \u2014 until it has run, no drawings are sent.',
  ] },
  { version: '1.14.2', date: '2026-10-06', changes: [
    'Security: server settings (board ids, sync times, labour rate, the automatic pull summary, QA checklists) move to a table that cannot be read without the server\u2019s own key. Only the demo quote e-mail address stays in the publicly readable settings table. Works before and after migration 0066_server_config.sql; run that migration after this version is deployed.',
  ] },
  { version: '1.14.1', date: '2026-10-06', changes: [
    'Security: the office site now sends standard browser security headers \u2014 it cannot be embedded inside another website, browsers are told to always use HTTPS, and other sites no longer see page addresses when you follow a link out. No change to how the app looks or works.',
  ] },
  { version: '1.14.0', date: '2026-10-06', changes: [
    'Calendar: each day now shows one coloured number per job instead of a single total, so you can see at a glance which jobs are on a day. A legend under the month lists each job\u2019s colour, name and item count. Hover a number for the job and how many items each team has; \u2713 means all installed, ! means a snag or misfit.',
    'Calendar day list: the heading shows items per team for each job, and every row carries its job colour on the left edge.',
  ] },
  { version: '1.13.4', date: '2026-10-05', changes: [
    'Internal: a full check now runs before every push \u2014 strict type check of the server and the mobile app, the office page check and all rule tests (npm run check). No change to how the app behaves.',
  ] },
  { version: '1.13.3', date: '2026-10-05', changes: [
    'Calendar: fitters and planned install dates are now pulled from Monday automatically every morning (from 05:00 Poland time) for every job linked to a board, so the calendar no longer depends on someone clicking Pull. If the server was asleep or restarting at that time it runs as soon as it is back, once a day. The Calendar shows when the last automatic pull ran; hover it to see any jobs with a problem (no Fitters column, unknown team name). The Sync tab button still pulls on demand.',
    'Fix: items given a planned install date in Monday did not appear in the phone app\u2019s schedule, because they had no install status in the app. The pull now marks an item with a planned date as Scheduled (and clears that if the date is removed); a status recorded by a fitter is never changed.',
    'Sync \u25b8 Pull fitters + dates: when a board has several install dates, the planned one (\u201cPlan Install Date\u201d) is always used for the calendar; \u201cActual Install Date\u201d and \u201cJob Done Date\u201d are never picked.',
  ] },
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
