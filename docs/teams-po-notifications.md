# Teams & email notifications for PO approvals

The office app notifies people about PO requests of **£2,000+**:

| Event | Channel post | Personal Teams message | Email |
|---|---|---|---|
| Request raised (≥ £2k) | ✓ | every active **admin** (approver pool) | every active admin |
| Approved / rejected | ✓ | the **requestor** (with the reason) | the requestor |

Each channel is optional and switches on when its server environment variable is set on
Render (**service → Environment → Add Environment Variable → Save changes**). Set them on
`ace-office-test` and `ace-office-prod` separately. **PO requests → Notifications** in the app
shows which are on, and holds the *From* email and the *App base URL* (needed for the
"Open in ACE Office" button — `https://office.acemark.com.pl` on prod).

| Variable | What it is |
|---|---|
| `TEAMS_PO_WEBHOOK` | Webhook URL of a Workflow that posts to a channel |
| `TEAMS_PO_DM_WEBHOOK` | Webhook URL of a Workflow that sends personal (1:1) messages |
| `RESEND_API_KEY` | Resend API key (`re_…`) for email |

Treat all three as secrets: anyone with a webhook URL can post through it. Never store them in
`app_config` — that table is readable with the public anon key.

---

## 1. Channel post — `TEAMS_PO_WEBHOOK`

1. In Teams, on the channel → **⋯ → Workflows**.
2. Pick **"Send webhook alerts to a channel"**, name it (e.g. *PO approvals*), confirm team +
   channel → **Add workflow**.
3. Copy the URL it shows → Render variable `TEAMS_PO_WEBHOOK`.

## 2. Personal messages — `TEAMS_PO_DM_WEBHOOK`

The app POSTs **one request per person**, shaped like this:

```json
{
  "type": "message",
  "recipient": "antek@acegroup-uk.com",
  "attachments": [
    { "contentType": "application/vnd.microsoft.card.adaptive", "content": { "type": "AdaptiveCard", "...": "..." } }
  ]
}
```

The workflow takes `recipient` and the card and posts it as the Flow bot. Build it once:

1. Teams → **Workflows** app (left bar, or **⋯ → Workflows**) → **+ New flow** →
   **Create from blank**. Use a **shared/service account** if you have one — the flow runs as
   whoever creates it and stops if that account is removed.
2. **Trigger:** search **"When a Teams webhook request is received"**. Set
   **Who can trigger the flow** = **Anyone**.
3. **+ New step → "Post card in a chat or channel"** (Microsoft Teams), and set:
   - **Post as:** `Flow bot`
   - **Post in:** `Chat with Flow bot`
   - **Recipient:** switch to the expression tab (*fx*) and enter
     `triggerBody()?['recipient']`
   - **Adaptive Card:** expression
     `first(triggerBody()?['attachments'])?['content']`
4. **Save.** Open the trigger step again and **copy the HTTP URL** it now shows →
   Render variable `TEAMS_PO_DM_WEBHOOK`.

**Test it:** raise a £2k+ PO — each admin gets a chat from *Workflows* with the card and an
**Open in ACE Office** button. Then approve/reject it — the requestor gets one too.

### Things to know
- **Emails must match.** The email on the user in the app (**Admin → Users**) must be the
  person's Microsoft sign-in (UPN). If they differ, that person's message fails.
- **Same organisation only** — guests / external users can't be messaged this way.
- Messages arrive from **Workflows**, not "ACE Office" (a custom Teams bot would change that;
  bigger setup).
- If the card field rejects the expression as an object, wrap it: `string(first(triggerBody()?['attachments'])?['content'])`.

## 3. Email — `RESEND_API_KEY`

1. Sign up at resend.com → **Domains → Add domain** (e.g. `acegroup-uk.com`), add the DNS
   records it shows (SPF/DKIM TXT + MX), **Verify**.
2. **API Keys → Create API key** (Sending access) → Render variable `RESEND_API_KEY`.
3. In the app, **PO requests → Notifications**: *From* e.g. `ACE Office <noreply@acegroup-uk.com>`
   (must be on the verified domain).

## Troubleshooting

Render → the service → **Logs**, search for:
- `Teams webhook failed` — channel post rejected (URL wrong/deleted).
- `Teams DM to <email> failed` — personal message rejected; usually the email isn't that
  person's Teams sign-in, or the workflow is off. Also check the flow's **run history** in
  the Workflows app — it shows the exact error per run.
- `Resend email failed` — key wrong or domain not verified.
