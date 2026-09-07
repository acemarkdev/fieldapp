import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, Alert, Modal, TextInput, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { supabase, setDemoMode } from './src/lib/supabase';
import { resetDemoDb } from './src/lib/demoClient';
import { recordLead, openQuoteEmail, getLeadsEmail } from './src/lib/demoLeads';
import { C } from './src/lib/theme';
import LoginScreen from './src/screens/LoginScreen';
import JobsScreen, { Job } from './src/screens/JobsScreen';
import ItemsScreen from './src/screens/ItemsScreen';
import ItemDetailScreen from './src/screens/ItemDetailScreen';
import NewItemScreen from './src/screens/NewItemScreen';
import NewJobScreen from './src/screens/NewJobScreen';
import PlanScreen from './src/screens/PlanScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import { APP_VERSION } from './src/lib/version';
import type { Pending } from './src/lib/offline';
import { can, isFitter } from './src/lib/permissions';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingPending, setEditingPending] = useState<Pending | null>(null);
  const [editingItem, setEditingItem] = useState<any | null>(null); // surveyor adding spec to a saved item
  const [viewingPlan, setViewingPlan] = useState(false);
  const [creatingJob, setCreatingJob] = useState(false);
  const [browsingJobs, setBrowsingJobs] = useState(false); // fitter: chose to browse jobs instead of the schedule
  const [demo, setDemo] = useState(false);
  const [demoEmail, setDemoEmail] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load the signed-in user's role so we can hide actions they aren't allowed to use.
  useEffect(() => {
    if (!session) { setRole(null); setTeamId(null); return; }
    let cancelled = false;
    (async () => {
      // Link this auth identity to its app_users row (by email) if it isn't already —
      // otherwise RLS hides the user's own row and the role loads as null.
      try { await supabase.rpc('link_current_user'); } catch { /* older DB without the fn */ }
      const { data } = await supabase.from('app_users').select('role,team_id').eq('auth_user_id', session.user.id).maybeSingle();
      if (cancelled) return;
      const row = data as { role?: string; team_id?: string | null } | null;
      setRole(row?.role ?? null);
      setTeamId(row?.team_id ?? null);
    })();
    return () => { cancelled = true; };
  }, [session]);

  function resetNav() { setJob(null); setItemId(null); setCreating(false); setEditingPending(null); setEditingItem(null); setViewingPlan(false); setCreatingJob(false); setBrowsingJobs(false); }
  function enterDemo(email: string) { resetDemoDb(); setDemoMode(true); resetNav(); setRole('admin'); setTeamId('demo-team-a'); setDemo(true); setDemoEmail(email); recordLead(email, 'demo_started'); }
  function exitDemo() { setDemoMode(false); setDemo(false); setDemoEmail(null); resetNav(); setRole(null); setTeamId(null); }
  function demoBlock(what: string) { Alert.alert('Demo mode', what + ' is disabled in the demo — explore and edit the sample data, or tap \u201CRequest a quote\u201D.'); }

  if (!ready) {
    return <View style={[s.fill, s.center]}><ActivityIndicator color={C.magenta} /></View>;
  }

  if (!session && !demo) {
    return (<><StatusBar barStyle="light-content" /><LoginScreen onDemo={enterDemo} /></>);
  }

  return (
    <SafeAreaProvider>
    <SafeAreaView style={s.fill} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <View style={s.topbar}>
        <Text style={s.brand}>ACE<Text style={s.brandB}>GROUP</Text> <Text style={s.field}>Field · v{APP_VERSION}{role ? ` · ${role}` : ''}</Text></Text>
        <TouchableOpacity onPress={() => (demo ? exitDemo() : supabase.auth.signOut())}>
          <Text style={s.signout}>{demo ? 'Exit demo' : 'Sign out'}</Text>
        </TouchableOpacity>
      </View>
      {demo && (
        <View style={s.demoBar}>
          <Text style={s.demoBarText}>DEMO · sample data, resets when you exit</Text>
          <TouchableOpacity style={s.quoteBtn} onPress={() => setQuoting(true)} activeOpacity={0.85}>
            <Text style={s.quoteBtnText}>Request a quote</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={s.fill}>
        {!job
          ? (itemId
              // A fitter opened an item straight from their schedule (no job context) — Back returns to the schedule.
              ? <ItemDetailScreen id={itemId} role={role} onEditItem={setEditingItem} onBack={() => setItemId(null)} onChanged={() => {}} />
              : (isFitter(role) && !browsingJobs)
                ? <ScheduleScreen teamId={teamId} onOpenItem={(id) => setItemId(id)} onBrowseJobs={() => setBrowsingJobs(true)} />
                : creatingJob
                  ? <NewJobScreen onCancel={() => setCreatingJob(false)} onDone={() => setCreatingJob(false)} />
                  : <JobsScreen onOpen={setJob} onNew={() => (demo ? demoBlock('Creating jobs') : setCreatingJob(true))} canNewJob={can(role, 'jobs.manage')} onBack={isFitter(role) ? () => setBrowsingJobs(false) : undefined} />)
          : editingPending
            ? <NewItemScreen key={editingPending.localId} job={job} role={role} editing={editingPending} onCancel={() => setEditingPending(null)} onDone={() => setEditingPending(null)} />
            : creating
              ? <NewItemScreen job={job} role={role} onCancel={() => setCreating(false)} onDone={() => setCreating(false)} />
              : editingItem
                ? <NewItemScreen key={editingItem.id} job={job} role={role} existingItem={editingItem} onCancel={() => setEditingItem(null)} onDone={() => { setEditingItem(null); setItemId(null); }} />
              : viewingPlan && !itemId
                ? <PlanScreen job={job} role={role} onBack={() => setViewingPlan(false)} onOpenItem={(id) => setItemId(id)} />
              : itemId
                ? <ItemDetailScreen id={itemId} role={role} onEditItem={setEditingItem} onBack={() => setItemId(null)} onChanged={() => {}} />
                : <ItemsScreen job={job} role={role} teamId={teamId} onBack={() => { setJob(null); setItemId(null); setCreating(false); setEditingPending(null); setEditingItem(null); setViewingPlan(false); }} onOpen={setItemId} onNew={() => (demo ? demoBlock('Creating items') : setCreating(true))} onEditPending={setEditingPending} onPlan={() => setViewingPlan(true)} />}
      </View>
      {quoting && <QuoteModal email={demoEmail || ''} onClose={() => setQuoting(false)} />}
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  topbar: { backgroundColor: C.purple, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  brand: { color: '#fff', fontSize: 17, fontWeight: '800' },
  brandB: { color: '#ff8fc8' },
  field: { color: '#cfc9ea', fontSize: 12, fontWeight: '500' },
  signout: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
  demoBar: { backgroundColor: C.magenta, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8 },
  demoBarText: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 },
  quoteBtn: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  quoteBtnText: { color: C.magenta, fontSize: 12, fontWeight: '800' },
});


function QuoteModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    const extra = { name, company, phone, message };
    try { await recordLead(email, 'quote', extra); } catch { /* ignore */ }
    let to: string | undefined; try { to = await getLeadsEmail(); } catch { /* use default */ }
    openQuoteEmail(email, extra, to);
    setSending(false);
    onClose();
    Alert.alert('Thanks!', 'Your details were sent to our team. We’ll be in touch shortly.');
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={q.backdrop}>
        <View style={q.card}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={q.title}>Request a quote</Text>
            <Text style={q.sub}>Tell us a bit about you and we’ll get back to you.</Text>
            <Text style={q.label}>Email</Text>
            <TextInput style={[q.input, q.readonly]} value={email} editable={false} />
            <Text style={q.label}>Name</Text>
            <TextInput style={q.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor="#9a97ad" />
            <Text style={q.label}>Company</Text>
            <TextInput style={q.input} value={company} onChangeText={setCompany} placeholder="Company" placeholderTextColor="#9a97ad" />
            <Text style={q.label}>Phone</Text>
            <TextInput style={q.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Phone (optional)" placeholderTextColor="#9a97ad" />
            <Text style={q.label}>What are you looking for?</Text>
            <TextInput style={[q.input, q.multiline]} value={message} onChangeText={setMessage} multiline placeholder="A few words about your project" placeholderTextColor="#9a97ad" />
            <TouchableOpacity style={q.send} onPress={send} disabled={sending} activeOpacity={0.85}>
              {sending ? <ActivityIndicator color="#fff" /> : <Text style={q.sendText}>Send</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={q.cancel} onPress={onClose} activeOpacity={0.85}>
              <Text style={q.cancelText}>Not now</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const q = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(31,26,61,0.5)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, maxHeight: '88%' },
  title: { fontSize: 19, fontWeight: '800', color: C.purple },
  sub: { fontSize: 13, color: C.muted, marginTop: 4, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '700', color: C.ink, marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: C.ink },
  readonly: { backgroundColor: '#f6f5fb', color: C.muted },
  multiline: { height: 90, textAlignVertical: 'top' },
  send: { backgroundColor: C.magenta, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  sendText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  cancel: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cancelText: { color: C.muted, fontWeight: '700', fontSize: 14 },
});
