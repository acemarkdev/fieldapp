import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './src/lib/supabase';
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

  if (!ready) {
    return <View style={[s.fill, s.center]}><ActivityIndicator color={C.magenta} /></View>;
  }

  if (!session) {
    return (<><StatusBar barStyle="light-content" /><LoginScreen /></>);
  }

  return (
    <SafeAreaProvider>
    <SafeAreaView style={s.fill} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <View style={s.topbar}>
        <Text style={s.brand}>ACE<Text style={s.brandB}>GROUP</Text> <Text style={s.field}>Field · v{APP_VERSION}{role ? ` · ${role}` : ''}</Text></Text>
        <TouchableOpacity onPress={() => supabase.auth.signOut()}>
          <Text style={s.signout}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <View style={s.fill}>
        {!job
          ? (itemId
              // A fitter opened an item straight from their schedule (no job context) — Back returns to the schedule.
              ? <ItemDetailScreen id={itemId} role={role} onEditItem={setEditingItem} onBack={() => setItemId(null)} onChanged={() => {}} />
              : (isFitter(role) && !browsingJobs)
                ? <ScheduleScreen teamId={teamId} onOpenItem={(id) => setItemId(id)} onBrowseJobs={() => setBrowsingJobs(true)} />
                : creatingJob
                  ? <NewJobScreen onCancel={() => setCreatingJob(false)} onDone={() => setCreatingJob(false)} />
                  : <JobsScreen onOpen={setJob} onNew={() => setCreatingJob(true)} canNewJob={can(role, 'jobs.manage')} onBack={isFitter(role) ? () => setBrowsingJobs(false) : undefined} />)
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
                : <ItemsScreen job={job} role={role} teamId={teamId} onBack={() => { setJob(null); setItemId(null); setCreating(false); setEditingPending(null); setEditingItem(null); setViewingPlan(false); }} onOpen={setItemId} onNew={() => setCreating(true)} onEditPending={setEditingPending} onPlan={() => setViewingPlan(true)} />}
      </View>
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
});
