// Lead capture for the demo: stores the prospect's details in the `demo_leads` table (via the
// real anon client, allowed by an insert-only RLS policy) AND offers a prefilled sales email.
import { Linking } from 'react-native';
import { realSupabase } from './supabase';
import { APP_VERSION } from './version';

export const SALES_EMAIL = 'sales@acegroup-uk.com';

// The destination email is configurable from the office app (app_config.demo_leads_email);
// fall back to the built-in default if unset or unreachable.
export async function getLeadsEmail(): Promise<string> {
  try {
    const { data } = await realSupabase.from('app_config').select('value').eq('key', 'demo_leads_email').maybeSingle();
    const v = (data as any)?.value;
    return (v && String(v).trim()) || SALES_EMAIL;
  } catch { return SALES_EMAIL; }
}

export type LeadKind = 'demo_started' | 'quote';
export interface LeadExtra { name?: string; company?: string; phone?: string; message?: string }

// Fire-and-forget: never block or crash the UI if the insert fails (offline, policy, etc.).
export async function recordLead(email: string, kind: LeadKind, extra: LeadExtra = {}): Promise<void> {
  try {
    await realSupabase.from('demo_leads').insert({
      email: (email || '').trim() || null,
      kind,
      name: extra.name?.trim() || null,
      company: extra.company?.trim() || null,
      phone: extra.phone?.trim() || null,
      message: extra.message?.trim() || null,
      app_version: APP_VERSION,
    });
  } catch { /* ignore — capturing a lead must never break the demo */ }
}

export function openQuoteEmail(email: string, extra: LeadExtra = {}, to: string = SALES_EMAIL): void {
  const subject = encodeURIComponent('ACE Field — quote request');
  const body = encodeURIComponent(
    `I tried the ACE Field demo and would like a quote.\n\n` +
    `Email: ${email || ''}\nName: ${extra.name || ''}\nCompany: ${extra.company || ''}\nPhone: ${extra.phone || ''}\n\n` +
    `${extra.message || ''}`,
  );
  Linking.openURL(`mailto:${to || SALES_EMAIL}?subject=${subject}&body=${body}`).catch(() => { /* no mail app */ });
}
