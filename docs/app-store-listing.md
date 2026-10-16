# FitAWindow — App Store listing (iOS)

Everything to paste into App Store Connect. Public listing, iPhone + iPad.

## App information
- **Name:** FitAWindow  (must be unique on the App Store; if taken: "FitAWindow – ACE Field")
- **Subtitle (30):** Survey, install & production
- **Bundle ID:** uk.co.acegroup.field
- **SKU:** ace-field
- **Primary category:** Business · **Secondary:** Productivity
- **Content rights:** no third-party content
- **Age rating:** answer "None" to every question → 4+
- **Privacy Policy URL:** https://office.acemark.com.pl/privacy
- **Support URL:** https://office.acemark.com.pl/support
- **Copyright:** 2026 ACE Group

## Version 0.74.0
**Promotional text (170):**
The field app of ACE Group and Acemark: survey windows and doors, record installations with photos, and log production time — in sync with the office.

**Description:**
FitAWindow is the field and production app used by ACE Group and Acemark teams to deliver window and door projects.

Surveyors
• Create items room by room with measurements, styles and notes
• Map elevations and floors, and pin items on floor plans
• Take survey photos and attach them to each item

Fitters
• See your installation schedule by day or month
• Mark items installed, delayed or with a snag — with before and after photos
• Find every item of a flat across all your jobs

Production
• Pick a job's task and start the timer; switch tasks with one tap
• Correct today's times and add a comment
• Hours flow straight into job costs in the office system

Everything syncs with the ACE office system. The app is for our staff and contractors — accounts are created by our office. Anyone can explore the built-in demo with sample data.

**Keywords (100):** windows,doors,installation,survey,fitter,construction,glazing,snag,measure,production,timesheet

**What's New:** First release on the App Store.

## App Review information
- **Sign-in required:** yes. **Demo account:** not needed — use the built-in demo.
- **Notes for the reviewer:**
  FitAWindow is a business app for the employees and contractors of ACE Group / Acemark; their accounts are created by the company in its office system, so there is no sign-up. To review all features without an account: on the sign-in screen enter any email address in the Email field and tap "Explore the demo" (below the Sign in button). The demo uses sample jobs and items, works fully offline from the company's data, and resets when you leave. Camera and photo library are used only when the user adds a photo to an item. Sign in with Microsoft is the company's work-account (Microsoft Entra ID) login for its staff.
- **Contact:** your name, phone and email.

## App Privacy ("nutrition label")
Data collected — all **linked to the user**, **not used for tracking**:
| Type | Purpose |
| --- | --- |
| Contact Info ▸ Name | App Functionality |
| Contact Info ▸ Email Address | App Functionality; (demo/quote requests) Other — "Developer's sales contact" → choose *Product Personalization: no*, *Analytics: no* — pick **App Functionality** only |
| Contact Info ▸ Phone Number | App Functionality (only if entered in a quote request) |
| User Content ▸ Photos or Videos | App Functionality |
| User Content ▸ Other User Content | App Functionality (notes, measurements, comments) |
| Identifiers ▸ User ID | App Functionality |
Not collected: location, health, financial info, contacts, browsing/search history, purchases, usage data, diagnostics. No tracking.

## Screenshots (required)
- iPhone 6.9" — 1320 × 2868 (e.g. iPhone 16/17 Pro Max), 3–10 images
- iPad 13" — 2064 × 2752, 3–10 images
Suggested set (demo mode): sign-in · jobs list · items of a job · item detail with photo · plan with pins · fitter schedule · production time screen.

## Build and upload (run in apps/mobile)
1. `npx eas-cli build --platform ios --profile production` — log in with the Apple ID of the developer account (2-factor code), pick the team, and let EAS create the bundle ID, distribution certificate and provisioning profile.
2. `npx eas-cli submit --platform ios --profile production` — pick the build; EAS creates the app in App Store Connect if it doesn't exist (asks for the name, language, SKU) and uploads it. It appears in TestFlight after Apple's processing (10–30 min).
3. App Store Connect ▸ the app ▸ fill everything above, add the screenshots, choose the build, **Add for Review** ▸ **Submit**.
