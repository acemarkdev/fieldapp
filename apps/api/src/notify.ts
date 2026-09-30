// Best-effort notifications for PO approvals. Two optional channels:
//   • Email  — via Resend's HTTP API (no npm dep). Needs env RESEND_API_KEY + a from address
//              (env PO_EMAIL_FROM or app_config 'po_email_from'); silently skips if unset.
//   • Teams  — an Incoming Webhook URL in env TEAMS_PO_WEBHOOK; skips if unset. Kept out of
//              app_config on purpose: that table is anon-readable, and the URL is a secret.
// Failures never throw into the request path — they're logged and swallowed.
import { getConfig } from './store';

async function baseUrl(): Promise<string> {
  return (process.env.APP_BASE_URL || (await getConfig('app_base_url')) || '').replace(/\/+$/, '');
}

export async function sendEmail(to: string[], subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const recipients = to.filter(Boolean);
  if (!key || !recipients.length) return;
  const from = process.env.PO_EMAIL_FROM || (await getConfig('po_email_from')) || 'ACE Office <noreply@acegroup-uk.com>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, html }),
    });
    if (!r.ok) console.error('Resend email failed:', r.status, await r.text().catch(() => ''));
  } catch (e) { console.error('Resend email error:', e); }
}

// Adaptive Card wrapped in a message — accepted by both Teams Workflows webhooks (the
// current way) and legacy Incoming Webhook connectors. The old MessageCard format only
// works with the legacy connectors, which Microsoft is retiring.
function teamsMessage(title: string, lines: string[], linkUrl?: string) {
  const facts = lines.map((l) => { const i = l.indexOf(':'); return i > 0 ? { title: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : { title: '', value: l }; });
  const content: any = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
    body: [
      { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
      { type: 'FactSet', facts },
    ],
  };
  if (linkUrl) content.actions = [{ type: 'Action.OpenUrl', title: 'Open in ACE Office', url: linkUrl }];
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content }] };
}

async function postTeams(url: string, payload: unknown, label: string): Promise<void> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) console.error(`${label} failed:`, r.status, await r.text().catch(() => ''));
  } catch (e) { console.error(`${label} error:`, e); }
}

// Channel post — env TEAMS_PO_WEBHOOK.
export async function sendTeams(title: string, lines: string[], linkUrl?: string): Promise<void> {
  const url = process.env.TEAMS_PO_WEBHOOK;
  if (!url) return;
  await postTeams(url, teamsMessage(title, lines, linkUrl), 'Teams webhook');
}

// Personal message — env TEAMS_PO_DM_WEBHOOK, a Teams Workflow that posts the card as the
// Flow bot in a 1:1 chat with `recipient` (their Microsoft sign-in email). One POST per person.
// Setup: docs/teams-po-notifications.md.
export async function sendTeamsDm(emails: string[], title: string, lines: string[], linkUrl?: string): Promise<void> {
  const url = process.env.TEAMS_PO_DM_WEBHOOK;
  const recipients = [...new Set(emails.map((e) => (e || '').trim().toLowerCase()).filter(Boolean))];
  if (!url || !recipients.length) return;
  const msg = teamsMessage(title, lines, linkUrl);
  await Promise.all(recipients.map((recipient) => postTeams(url, { ...msg, recipient }, `Teams DM to ${recipient}`)));
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
const listHtml = (lines: string[]) => '<ul>' + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>';

// Deep link straight to the PO — the office page opens /?po=<id> after sign-in.
const poLink = (base: string, id: string) => (base && id ? `${base}/?po=${encodeURIComponent(id)}` : undefined);

const money = (p: number, cur: string) => (({ GBP: '£', PLN: 'zł', EUR: '€', USD: '$' } as any)[cur] || '') + ((p || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A new PO request needs approval → tell the approvers.
export async function notifyPoSubmitted(req: any, approverEmails: string[], costCentre: string | null, supplier: string | null): Promise<void> {
  const link = poLink(await baseUrl(), req.id);
  const lines = [
    `Number: ${req.number}`, `Title: ${req.title}`, `Amount: ${money(req.amount_pennies, req.currency)}`,
    `Cost centre: ${costCentre || '—'}`, `Supplier: ${supplier || '—'}`, `Requested by: ${req.requestor_name || '—'}`,
  ];
  await Promise.all([
    sendTeams('PO request needs approval (≥£2k): ' + req.number, lines, link),
    sendTeamsDm(approverEmails, 'PO request needs your approval (≥£2k): ' + req.number, lines, link),
    sendEmail(approverEmails,
      `PO approval needed: ${req.number} — ${money(req.amount_pennies, req.currency)}`,
      `<p>A purchase-order request needs approval.</p>${listHtml(lines)}${link ? `<p><a href="${link}">Open in ACE Office</a></p>` : ''}`),
  ]);
}

// A PO request was approved/rejected → tell the requestor.
export async function notifyPoDecision(req: any, decision: 'approved' | 'rejected', decidedBy: string | null, requestorEmail: string | null, comment: string | null = null): Promise<void> {
  const link = poLink(await baseUrl(), req.id);
  const word = decision === 'approved' ? 'APPROVED' : 'REJECTED';
  const lines = [`Number: ${req.number}`, `Title: ${req.title}`, `Amount: ${money(req.amount_pennies, req.currency)}`, `Decision: ${word}`, `By: ${decidedBy || '—'}`];
  if (comment) lines.push(`${decision === 'rejected' ? 'Reason' : 'Comment'}: ${comment}`);
  await Promise.all([
    sendTeams(`PO ${req.number} ${word}`, lines, link),
    requestorEmail ? sendTeamsDm([requestorEmail], `Your PO request ${req.number} was ${decision}`, lines, link) : Promise.resolve(),
    requestorEmail ? sendEmail([requestorEmail], `Your PO request ${req.number} was ${decision}`,
      `<p>Your purchase-order request has been <b>${word}</b>.</p>${listHtml(lines)}${link ? `<p><a href="${link}">Open in ACE Office</a></p>` : ''}`) : Promise.resolve(),
  ]);
}
