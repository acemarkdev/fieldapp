import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { cacheGet, cacheSet } from '../lib/offline';

export interface Job { id: string; tenant_id: string; client_code: string; job_code: string; name: string; }

export default function JobsScreen({ onOpen, onNew, canNewJob = true, onBack }: { onOpen: (job: Job) => void; onNew: () => void; canNewJob?: boolean; onBack?: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('jobs').select('id,tenant_id,client_code,job_code,name').eq('active', true).order('job_code');
      if (error) throw error;
      setJobs((data as Job[]) ?? []);
      setOffline(false);
      cacheSet('jobs', data);
    } catch {
      const c = await cacheGet<Job[]>('jobs');   // offline: fall back to the last cached list
      setJobs(c ?? []);
      setOffline(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={s.center}><ActivityIndicator color={C.magenta} /></View>;

  return (
    <FlatList
      data={jobs}
      keyExtractor={(j) => j.id}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.magenta} />}
      ListHeaderComponent={
        <View>
          {onBack && (
            <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.back}>‹ Schedule</Text>
            </TouchableOpacity>
          )}
          <View style={s.hrow}>
            <Text style={s.h}>Jobs</Text>
            {canNewJob && (
              <TouchableOpacity onPress={onNew} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.newBtn}>+ New job</Text>
              </TouchableOpacity>
            )}
          </View>
          {offline && <Text style={s.offline}>Offline — showing your last saved jobs</Text>}
        </View>
      }
      ListEmptyComponent={<Text style={s.empty}>{offline ? 'Offline and no cached jobs yet.' : 'No jobs yet.'}</Text>}
      renderItem={({ item }) => (
        <TouchableOpacity style={s.row} onPress={() => onOpen(item)} activeOpacity={0.7}>
          <Text style={s.code}>{item.client_code}.{item.job_code}</Text>
          <Text style={s.name}>{item.name}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { color: C.magenta, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  hrow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  h: { fontSize: 22, fontWeight: '800', color: C.purple },
  newBtn: { color: C.magenta, fontSize: 15, fontWeight: '800' },
  offline: { fontSize: 12, color: C.amber, marginBottom: 12, fontWeight: '600' },
  row: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16, marginBottom: 10 },
  code: { fontSize: 15, fontWeight: '800', color: C.purple, fontVariant: ['tabular-nums'] },
  name: { fontSize: 13, color: C.muted, marginTop: 3 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 30 },
});
