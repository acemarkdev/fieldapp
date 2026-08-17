import { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';

export default function NewJobScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [client, setClient] = useState('');
  const [jobCode, setJobCode] = useState('');
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      // tenant + a sensible default client code (usually the same across jobs)
      const { data: jobs } = await supabase.from('jobs').select('tenant_id,client_code').limit(1);
      if (jobs && jobs[0]) { setTenantId(jobs[0].tenant_id); setClient(jobs[0].client_code); return; }
      const { data: au } = await supabase.from('app_users').select('tenant_id').limit(1).maybeSingle();
      if (au) setTenantId((au as any).tenant_id);
    })();
  }, []);

  const code = `${client.trim().toUpperCase()}${jobCode.trim() ? '.' + jobCode.trim().toUpperCase() : ''}`;

  async function create() {
    setError('');
    const c = client.trim().toUpperCase();
    const j = jobCode.trim().toUpperCase();
    const nm = name.trim();
    if (!c || !j) { setError('Client code and Job code are required.'); return; }
    if (!nm) { setError('Job name is required.'); return; }
    if (!tenantId) { setError('Could not read your tenant — are you online?'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('jobs').insert({
        tenant_id: tenantId, client_code: c, job_code: j, name: nm, site_address: addr.trim() || null, active: true,
      });
      setSaving(false);
      if (error) { setError((error as any).code === '23505' ? `Job ${c}.${j} already exists.` : error.message); return; }
      onDone();
    } catch (e: any) {
      setSaving(false);
      setError('Couldn’t reach the server — creating a job needs a connection.');
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={s.header}>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.back}>‹ Cancel</Text>
        </TouchableOpacity>
        <Text style={s.htitle}>New job</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={s.codeBox}><Text style={s.codeText}>{code || 'CLIENT.JOB'}</Text></View>

        <Field label="Client code *" ph="AXS" v={client} on={setClient} auto />
        <Field label="Job code *" ph="LAB" v={jobCode} on={setJobCode} auto />
        <Field label="Job name *" ph="Laburnum Road, Waterlooville" v={name} on={setName} />
        <Field label="Site address" ph="(optional)" v={addr} on={setAddr} multiline />

        <Text style={s.note}>The Monday board is linked later in the office app.</Text>

        {!!error && <Text style={s.error}>{error}</Text>}
        <TouchableOpacity style={[s.save, saving && { opacity: 0.6 }]} onPress={create} disabled={saving} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Create job</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, ph, v, on, auto, multiline }: { label: string; ph?: string; v: string; on: (t: string) => void; auto?: boolean; multiline?: boolean }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, multiline && { height: 64, textAlignVertical: 'top' }]}
        placeholder={ph} placeholderTextColor="#9a97ad" value={v} onChangeText={on}
        autoCapitalize={auto ? 'characters' : 'sentences'} autoCorrect={false} multiline={!!multiline}
      />
    </View>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: C.purple, paddingTop: 8, paddingBottom: 14, paddingHorizontal: 16 },
  back: { color: '#cfc9ea', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  htitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  codeBox: { backgroundColor: C.soft, borderRadius: 11, padding: 13, marginBottom: 6 },
  codeText: { color: C.purple, fontSize: 15, fontWeight: '800' },
  field: { marginTop: 12 },
  label: { fontSize: 12, fontWeight: '700', color: C.muted, marginBottom: 5 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink, backgroundColor: '#fff' },
  note: { fontSize: 12, color: C.muted, marginTop: 14 },
  error: { color: '#dc2626', fontSize: 13, marginTop: 16 },
  save: { backgroundColor: C.magenta, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
