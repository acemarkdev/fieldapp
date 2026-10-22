# ACE Scaffolding — development plan (high level)

*Drafted 2026-10-22. Based on the three ACE Scaffolding monday boards (Estimated Enquiries 1630857450, Project
Sheet 1594702968, Commercial / Large Projects 4236833503) and research into how UK scaffolding contractors and
their software (Avontus Quantify, SMART Scaffolder, Strikesoft, Scafflinq…) run hire, operations and stock.*

## 1. What the business runs on today (monday)

| Board | Size | What it holds |
|---|---|---|
| **Estimated Enquiries** | ~3,800 | Enquiry → estimate (ACE4018…). Status ladder: 1 New → 1.1 Waiting access / 1.2 Awaiting details or site meeting → 2 Survey required → 3 Quote required → 3.1 Draft → 4 Quote sent → 5 Seen, pending → 5.1 Hot → **6.1 Won / 6.2 Declined** (+ loss reasons: too pricey, went elsewhere, client unsuccessful…). Source, domestic/commercial, private/trade, surveyor, estimator, salesperson. **Total scaffolding price, est. costs up, est. costs down, est. profit, m².** Subitems: Customer docs, Survey, Quote, Chase up. |
| **Project Sheet** | ~2,200 | Job (ACESC2009…) linked to its enquiry. **Erecting company** (ACE Scaff or subcontractors JMS / DW / LPD / SSB / Street / Cross / BOB). Status: To be rented → Being rented → Still up → Ready for dismantle → Part dismantled → Down (+ Commercial). Up/down timeline, operatives, **initial hire weeks, rent % per week, rent per week = price × %, rent to charge = whole weeks × weekly rent**, dismantle request date, dismantle date. Est. vs actual cost up/down, actual profit. Handover certificate, RAMS. 15-step checklist subitems (install booked → RAMS → alarm / inspections / licences / hoists / design → erected → handover → invoice → dismantle request → paid → dismantle booked → dismantled → client review) and **"Rental Invoice" subitems per billed period**. |
| **Commercial / Large Projects** | 64 | Per site (group): priced **elements** — each elevation's independent scaffold, fan protection, Monarflex sheeting, roof-edge protection, birdcage, pavement licence; **adaptions** as their own group. Per element: cost, **% chargeable per week, rental terms (e.g. 20 weeks)**, **staged invoices 1st–4th with % invoiced (20 / 50 / 100%)**, rent due, rent charged up to, dismantle request, dismantled, invoice number, paid. |

**The hire rule in use:** price includes erect + dismantle + an initial hire of N weeks. After that, rent is charged
**per whole week at a % of the element's price** (e.g. 4%) until the dismantle request. Commercial elements are
invoiced in stages and each element runs its own clock.

**What is missing:** stock (what is in the yard, on which site, booked for next weeks, coming back from
dismantles), a reliable rent-due engine (today dates and % are typed by hand), inspections, digital handovers,
and one place for the whole job.

## 2. What we learned from the market (summary)

- Initial hire period varies (2–12 weeks; domestic shorter) → **a field per quote / element**, never a constant.
- **Hire clock starts at the handover certificate**, not at the start of erection.
- **Off-hire is a written, timestamped request**; billing stops by the contract's notice rule. Keep request date ≠ strike date.
- The industry's biggest leak is **unbilled extension weeks** → alerts at the end of the included period + automatic extension invoice lines.
- **Alterations / variations** must be confirmed in writing, priced, and re-inspected / re-handed-over.
- **Inspections** are statutory (Work at Height Regs 2005): before first use, then **at least every 7 days**, after bad weather and after alterations; reports kept on site.
- **Tax:** keep **labour (erect / dismantle) and hire on separate invoice lines** — CIS applies to the construction operation, the VAT **domestic reverse charge** applies to erect / dismantle for CIS-registered trade customers but not to pure hire or homeowners. Intra-group (ACE) supplies → accountant to confirm.
- **Commercial contracts:** monthly payment applications, payment notices, **retention** (often 5%, half released at completion).
- **Stock:** firms track per component (tubes by length, boards, fittings, base plates, system parts); good systems allow **negative site balances** reconciled later and **charge losses**; smaller firms estimate a BOM per scaffold. Losses of 15–20% of stock sent out are reported before stock control.
- Software is split between stock / hire systems (Quantify, Windows) and inspection apps (SMART, Scafflinq) → re-keying. **One system for job + hire + inspection + stock, office + phone, is a real gap** — and fits our existing apps.

## 3. Solution shape

Built into the existing ACE office app + FitAWindow phone app (same stack: Node office server, Supabase,
Expo), as a **separate business** (its own customers, jobs, users and numbering), reusing what exists: users &
roles, App access per role, monday import tooling, PDFs, Excel export, Fin&Ops reporting, phone scanning (QR),
time logging.

**Core records:** Customer (domestic / trade / principal contractor / ACE company; CIS & VAT-DRC status) · Contact ·
Site (address, access, licences with expiry) · **Enquiry** · **Quote** with **Elements** · **Job / Contract** ·
**Scaffold** (one per element that is put up; tag no., elevation, lifts, TG20 sheet / design ref, estimated BOM) ·
**Hire line** (per scaffold: included weeks, weekly rate or %, hire start = handover, billed-to, off-hire request,
end) · Variation / Adaption · Handover · Inspection · Dismantle · Visit (erect / adapt / inspect / dismantle /
deliver / collect) · Crew (own or subcontractor) · Operative (CISRS card, expiry) · **Stock item / Location /
Movement / Delivery & collection note** · Invoice / Payment application.

**Scaffold lifecycle:** quoted → booked → erecting → **handed over (on hire)** → (adapting) → **dismantle requested** → dismantling → down → closed. Blocked "do not use" when an inspection is overdue.

## 4. Phases (each one ships and is used before the next)

| # | Phase | Main deliverables | Office / phone | Size* |
|---|---|---|---|---|
| **0** | **Foundations** | Business set-up (separate data, numbering ACE#### / ACESC####), roles (scaff office, estimator, sales, supervisor, scaffolder, subcontract crew, accounts), customers / contacts / sites, monday import of enquiries + projects (read-only history). | Office | 2–3 wk |
| **1** | **CRM: leads, enquiries, quotes** | Enquiry pipeline with today's statuses and loss reasons; follow-up / chase-up reminders; survey on the phone (photos, measurements, notes); **quote builder with elements** (type, description, price, est. cost up / down, initial hire weeks, weekly rate or %, labour vs hire split); quote PDF; won → job. | Office + phone (survey) | 3–4 wk |
| **2** | **Jobs & contracts** | Job from the won quote, elements → scaffolds; job checklist (RAMS, alarm, licence, hoist, design / TG20 ref); **erect / dismantle planner** (calendar, own crews and subcontractors, visit sheets); **digital handover** (signed, photos, PDF → starts hire); **variations / adaptions**; **dismantle request** (who, when — timestamped); job board (still up, ready for dismantle, down). | Office + phone | 3–4 wk |
| **3** | **Hire & invoicing engine** (the core) | Per scaffold: rent due date = handover + included weeks; **weekly / monthly rent run** proposing invoice lines for every scaffold past its included period up to its off-hire date; **staged invoicing** for commercial elements (20 / 50 / 100% or custom); payment applications with **retention**; CIS & VAT-DRC handling via labour / hire lines; paid / not paid, credit control; "rent due this week / overdue" dashboard; invoices exported to the accounting system. | Office | 4–5 wk |
| **4** | **Phone field app** (alongside 2–3) | Crew day list (erect, adapt, inspect, dismantle, deliver, collect); **handover with client signature**; **7-day inspection register** with weather / alteration inspections, defects + photos, Scafftag-style PDF, overdue alerts; dismantle done; CISRS card register; time on job (reuses production time). | Phone | 3–4 wk |
| **5** | **Stock** | Catalogue (tubes by length, boards, fittings, base plates, ladders, system components); locations: **yard(s), sites, vehicles**; **delivery / collection notes** on the phone (scan or count, signature); **estimated BOM per scaffold** from the quote (template by type / m² / lifts) → **availability forecast by week**: in yard − booked for upcoming erections + coming back from booked dismantles; reconciliation at dismantle, losses / damage charged to the customer; stocktake. | Office + phone | 5–6 wk |
| **6** | **Reporting & cut-over** | Job profit (est. vs actual: costs up / down, subcontractors, hire income); pipeline conversion & sources; utilisation & rent income; overdue rent and debtors; monday switched to read-only. | Office | 2 wk |

\* Indicative build time at the pace of the recent modules; phases 2 and 4 can overlap. **First useful release
(phases 0–1): about 5–7 weeks; hire billing live (0–3): about 3–4 months; full scope with stock: about 5–6 months.**

## 5. Key rules to agree before phase 3

1. **When does hire start** — handover date (market practice) or the first erection day (today's "Timeline Up" start)?
2. **When does it stop** — dismantle request date, a notice period after it, or the dismantle date?
3. **Whole weeks only** (today: rounded down) or part weeks? Billing **weekly or monthly** in arrears?
4. Weekly rate as **% of element price** (today) or a fixed £/week per quote — or both?
5. Default staged-invoice schedule for commercial jobs and for domestic (deposit / balance?).
6. Retention, payment terms, CIS and VAT-DRC treatment per customer type — confirmed with the accountant.

## 6. Decisions needed from you (before phase 0)

- **Separate business in the same app** (own customers, jobs, users; one login can work in both) — or a fully separate tenant?
- **Accounting system** for ACE Scaffolding invoices (Xero / QuickBooks / Sage / Subiekt?) — the invoice export / sync depends on it.
- **Subcontract crews** (JMS, DW, LPD…): do they use the phone app (handover, dismantle, delivery notes), and how are they paid (per job / per m²)?
- **Stock:** tube & fitting, a system scaffold (Layher / Haki / Cuplok…), or both; how many yards and vehicles.
- **monday:** import history only, or keep monday in parallel during the switch-over?

## 7. Risks

- Billing rules differ per contract → every rule is a field on the quote / element, defaults per customer type.
- Stock accuracy depends on discipline at delivery / collection → start with the estimated BOM and make the phone notes fast (scan, presets per scaffold type).
- Tax treatment (CIS / DRC / intra-group) → sign-off by the accountant before invoices go live.
- Data migration quality (free-text dates and % in monday) → import as history, rebuild live jobs from today's state.
