import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { C, INSTALL_LABEL, STAGE_LABEL } from '../lib/theme';
import type { Job } from './JobsScreen';

interface Item {
  id: string; full_code: string | null; room_code: string | null; item_code: string | null;
  stage: string; install_status: string | null; kind: string | null; monday_item_id: string | null;
}

export default function ItemsScreen({ job, onBack }: { job: Job; onBack: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const { data, error } = await supabase
      .from('survey_items')
      .select('id,full_code,room_code,item_code,stage,install_status,kind,monday_item_id')
      .eq('job_id', job.id).order('full_code');
    if (error) setError(error.message);
    setItems((data as Item[]) ?? []);
    setLoading(false);
  }, [job.id]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.back}>‹ Jobs</Text>
        </TouchableOpacity>
        <Text style={s.htitle}>{job.client_code}.{job.job_code}</Text>
        <Text style={s.hname}>{job.name}</Text>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={C.magenta} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.magenta} />}
          ListEmptyComponent={<Text style={s.empty}>{error || 'No items on this job yet.'}</Text>}
          renderItem={({ item }) => {
            const isSnag = item.kind === 'snag';
            const st = item.install_status ? INSTALL_LABEL[item.install_status] ?? item.install_status : null;
            return (
              <View style={[s.card, isSnag && s.cardSnag]}>
                <View style={s.cardTop}>
                  <Text style={s.code}>{item.full_code}</Text>
                  {isSnag && <Text style={s.snag}>SNAG</Text>}
                </View>
                <Text style={s.meta}>
                  {(item.room_code || '—')} · {(item.item_code || '—')} · {STAGE_LABEL[item.stage] ?? item.stage}
                </Text>
                <View style={s.tags}>
                  {item.monday_item_id
                    ? <Text style={[s.tag, s.tagGreen]}>synced</Text>
                    : <Text style={[s.tag, s.tagGrey]}>local</Text>}
                  {st && <Text style={[s.tag, s.tagAmber]}>{st}</Text>}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: C.purple, paddingTop: 8, paddingBottom: 14, paddingHorizontal: 16 },
  back: { color: '#cfc9ea', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  htitle: { color: '#fff', fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hname: { color: '#cfc9ea', fontSize: 13, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardSnag: { borderColor: '#f6c9e0' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { fontSize: 13, fontWeight: '700', color: C.ink, flexShrink: 1 },
  snag: { fontSize: 10, fontWeight: '800', color: '#fff', backgroundColor: C.magenta, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  meta: { fontSize: 12, color: C.muted, marginTop: 5 },
  tags: { flexDirection: 'row', gap: 6, marginTop: 8 },
  tag: { fontSize: 10, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  tagGreen: { backgroundColor: C.greenSoft, color: C.green },
  tagGrey: { backgroundColor: C.soft, color: C.muted },
  tagAmber: { backgroundColor: C.amberSoft, color: C.amber },
  empty: { color: C.muted, textAlign: 'center', marginTop: 30 },
});
