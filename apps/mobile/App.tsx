import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar, ActivityIndicator } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './src/lib/supabase';
import { C } from './src/lib/theme';
import LoginScreen from './src/screens/LoginScreen';
import JobsScreen, { Job } from './src/screens/JobsScreen';
import ItemsScreen from './src/screens/ItemsScreen';
import ItemDetailScreen from './src/screens/ItemDetailScreen';
import { APP_VERSION } from './src/lib/version';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return <View style={[s.fill, s.center]}><ActivityIndicator color={C.magenta} /></View>;
  }

  if (!session) {
    return (<><StatusBar barStyle="light-content" /><LoginScreen /></>);
  }

  return (
    <SafeAreaView style={s.fill}>
      <StatusBar barStyle="light-content" />
      <View style={s.topbar}>
        <Text style={s.brand}>ACE<Text style={s.brandB}>GROUP</Text> <Text style={s.field}>Field · v{APP_VERSION}</Text></Text>
        <TouchableOpacity onPress={() => supabase.auth.signOut()}>
          <Text style={s.signout}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <View style={s.fill}>
        {!job
          ? <JobsScreen onOpen={setJob} />
          : itemId
            ? <ItemDetailScreen id={itemId} onBack={() => setItemId(null)} onChanged={() => {}} />
            : <ItemsScreen job={job} onBack={() => { setJob(null); setItemId(null); }} onOpen={setItemId} />}
      </View>
    </SafeAreaView>
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
