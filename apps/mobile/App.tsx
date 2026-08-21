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
import { APP_VERSION } from './src/lib/version';
import type { Pending } from './src/lib/offline';
import { can } from './src/lib/permissions';

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
  const [creatingJob, setCreatingJob] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load the signed-in user's role so we can hide actions they aren't allowed to use.
  useEffect(() => {
    if (!session) { setRole(null); setTeamId(null); return; }
    supabase.from('app_users').select('role,team_id').eq('auth_user_id', session.user.id).maybeSingle()
      .then(({ data }) => {
        const row = data as { role?: string; team_id?: string | null } | null;
        setRole(row?.role ?? null);
        setTeamId(row?.team_id ?? null);
      });
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
        <Text style={s.brand}>ACE<Text style={s.brandB}>GROUP</Text> <Text style={s.field}>Field · v{APP_VERSION}</Text></Text>
        <TouchableOpacity onPress={() => supabase.auth.signOut()}>
          <Text style={s.signout}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <View style={s.fill}>
        {!job
          ? (creatingJob
              ? <NewJobScreen onCancel={() => setCreatingJob(false)} onDone={() => setCreatingJob(false)} />
              : <JobsScreen onOpen={setJob} onNew={() => setCreatingJob(true)} canNewJob={can(role, 'jobs.manage')} />)
          : editingPending
            ? <NewItemScreen key={editingPending.localId} job={job} role={role} editing={editingPending} onCancel={() => setEditingPending(null)} onDone={() => setEditingPending(null)} />
            : creating
              ? <NewItemScreen job={job} role={role} onCancel={() => setCreating(false)} onDone={() => setCreating(false)} />
              : editingItem
                ? <NewItemScreen key={editingItem.id} job={job} role={role} existingItem={editingItem} onCancel={() => setEditingItem(null)} onDone={() => { setEditingItem(null); setItemId(null); }} />
              : itemId
                ? <ItemDetailScreen id={itemId} role={role} onEditItem={setEditingItem} onBack={() => setItemId(null)} onChanged={() => {}} />
                : <ItemsScreen job={job} role={role} teamId={teamId} onBack={() => { setJob(null); setItemId(null); setCreating(false); setEditingPending(null); setEditingItem(null); }} onOpen={setItemId} onNew={() => setCreating(true)} onEditPending={setEditingPending} />}
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
