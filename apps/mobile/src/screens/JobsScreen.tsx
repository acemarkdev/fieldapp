import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';

export interface Job { id: string; client_code: string; job_code: string; name: string; }

export default function JobsScreen({ onOpen }: { onOpen: (job: Job) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const { data, error } = await supabase
      .from('jobs').select('id,client_code,job_code,name').eq('active', true).order('job_code');
    if (error) setError(error.message);
    setJobs((data as Job[]) ?? []);
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
      ListHeaderComponent={<Text style={s.h}>Jobs</Text>}
      ListEmptyComponent={<Text style={s.empty}>{error || 'No jobs yet.'}</Text>}
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
  h: { fontSize: 22, fontWeight: '800', color: C.purple, marginBottom: 12 },
  row: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16, marginBottom: 10 },
  code: { fontSize: 15, fontWeight: '800', color: C.purple, fontVariant: ['tabular-nums'] },
  name: { fontSize: 13, color: C.muted, marginTop: 3 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 30 },
});
