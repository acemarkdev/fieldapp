# Microsoft (Entra / Azure AD) SSO — setup

The app already has the "Sign in with Microsoft" button wired. It's hidden until you
turn it on and configure the provider. Three places to touch: Azure, Supabase, `.env`.

## 1. Register the app in Azure (Entra ID)
1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name it (e.g. "ACE Office"). Supported account types: choose **Single tenant** (just your org) unless you need external orgs.
3. **Redirect URI** → platform **Web** →
   `https://<YOUR-PROJECT>.supabase.co/auth/v1/callback`
   (same host as your `SUPABASE_URL`).
4. Register. Copy the **Application (client) ID** and the **Directory (tenant) ID**.
5. **Certificates & secrets** → **New client secret** → copy the secret **Value** (not the ID).
6. **API permissions** → ensure delegated **email**, **openid**, **profile** (usually there by default) → Grant admin consent.

## 2. Enable the Azure provider in Supabase
1. Supabase dashboard → **Authentication → Providers → Azure** → enable.
2. Paste the **Application (client) ID** and **client secret**.
3. **Azure Tenant URL**: `https://login.microsoftonline.com/<Directory (tenant) ID>`.
4. Save. Confirm the callback shown matches the Redirect URI you set in Azure.
5. Authentication → **URL Configuration** → add your app's origin (e.g. `http://localhost:3000`,
   and your future production URL) to **Redirect URLs**.

## 3. Turn it on in the app
In `.env`:
```
AZURE_SSO_ENABLED=true
```
Restart the office server. The **Sign in with Microsoft** button now appears on the login screen.

## How it behaves
- The button sends the user to Microsoft, then back with a Supabase session.
- The server links that Microsoft identity to the matching **app_users** row **by email**,
  so roles/tenancy are unchanged — a user must already exist in the **Users** tab (same email).
  If there's no matching account, sign-in is refused with a clear message.
- Password login still works; SSO and password both resolve to the same person by email.

## Troubleshooting

### `Error getting user email from external provider`
Sign-in succeeded at Microsoft, but Azure didn't return an email claim. Fix on the Azure side:

1. **App registration → Token configuration → Add optional claim** → token type **ID** →
   tick **email** → Add. When prompted "Some of these claims require Microsoft Graph
   permissions", tick the box to **turn on the Graph email permission** and confirm.
2. **App registration → API permissions** → make sure these delegated Microsoft Graph
   permissions exist: **openid**, **profile**, **email**, **User.Read** → then
   **Grant admin consent** for your tenant.
3. Make sure the signing-in user actually has an email/UPN set on their Entra profile.
   Brand-new or mailbox-less accounts can lack a usable email.
4. Retry. (The app now also requests the `email` scope explicitly.)

### Button doesn't appear
`AZURE_SSO_ENABLED=true` must be set and the server restarted. It's injected at page load.

### Redirects to the wrong place / "redirect not allowed"
Add your exact app origin (e.g. `http://localhost:3000`) to Supabase → Authentication →
**URL Configuration → Redirect URLs**, and confirm the Azure Redirect URI is the Supabase
`/auth/v1/callback` URL (not your app URL).

## Notes
- OAuth (Microsoft/Google) is on Supabase's free tier. Full SAML is a paid feature; only needed
  if a customer mandates it.
- To also allow Google later, enable the Google provider the same way and add a second button
  (`provider=google`).
