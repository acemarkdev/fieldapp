import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, AppState, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { C, INSTALL_LABEL, STAGE_LABEL } from '../lib/theme';
import { getPending, flushAll, cacheGet, cacheSet, type Pending } from '../lib/offline';
import { can, isFitter } from '../lib/permissions';
import type { Job } from './JobsScreen';

interface Item {
  id: string; full_code: string | null; room_code: string | null; item_code: string | null;
  stage: string; install_status: string | null; kind: string | null; monday_item_id: string | null;
  team_id: string | null;
}

export default function ItemsScreen({ job, role, teamId, onBack, onOpen, onNew, onEditPending }: {
  job: Job; role?: string | null; teamId?: string | null; onBack: () => void; onOpen: (id: string) => void; onNew: () => void; onEditPending: (p: Pending) => void;
}) {
  const canCreate = can(role, 'items.create');
  const fitterView = isFitter(role); // fitters see only their team's ready-to-fit items
  const [items, setItems] = useState<Item[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    await flushAll(); // push anything queued while offline (items + photos)
    try {
      const { data, error } = await supabase
        .from('survey_items')
        .select('id,full_code,room_code,item_code,stage,install_status,kind,monday_item_id,team_id')
        .eq('job_id', job.id).order('full_code');
      if (error) throw error;
      setItems((data as Item[]) ?? []);
      setOffline(false);
      cacheSet('items_' + job.id, data);
    } catch {
      const c = await cacheGet<Item[]>('items_' + job.id);
      setItems(c ?? []);
      setOffline(true);
    }
    setPending(await getPending(job.id));
    setLoading(false);
  }, [job.id]);

  useEffect(() => { load(); }, [load]);

  // Re-try the queue whenever the app comes back to the foreground (e.g. signal returns).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    const r = await flushAll();
    setSyncing(false);
    await load();
    if (r.error) Alert.alert('Sync problem', r.error);
    else if (r.remaining > 0) Alert.alert('Still offline', `${r.remaining} item(s) still waiting — no connection yet.`);
    else if (r.synced > 0) Alert.alert('Synced', `${r.synced} item(s) uploaded.`);
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <View style={s.hrow}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.back}>‹ Jobs</Text>
          </TouchableOpacity>
          {canCreate ? (
            <TouchableOpacity onPress={onNew} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.newBtn}>{role === 'scanner' ? '+ Scan' : '+ New'}</Text>
            </TouchableOpacity>
          ) : <View />}
        </View>
        <Text style={s.htitle}>{job.client_code}.{job.job_code}</Text>
        <Text style={s.hname}>{job.name}</Text>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={C.magenta} /></View>
      ) : (
        <FlatList
          data={fitterView ? items.filter((i) => !!i.install_status && !!teamId && i.team_id === teamId) : items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.magenta} />}
          ListHeaderComponent={
            <View>
              {fitterView && !teamId && <Text style={s.banner}>You're not assigned to a team yet. Ask the office to set your team so your items appear here.</Text>}
              {offline && <Text style={s.banner}>Offline — showing saved data. New items are queued.</Text>}
              {pending.length > 0 && (
                <View style={s.pendingBox}>
                  <View style={s.pendingHead}>
                    <Text style={s.pendingTitle}>{pending.length} waiting to sync</Text>
                    <TouchableOpacity onPress={syncNow} disabled={syncing}>
                      <Text style={s.syncNow}>{syncing ? 'Syncing…' : 'Sync now'}</Text>
                    </TouchableOpacity>
                  </View>
                  {pending.map((p) => (
                    <TouchableOpacity key={p.localId} style={s.pendRow} activeOpacity={0.6} onPress={() => onEditPending(p)}>
                      <Text style={s.pendCode}>{p.full_code}</Text>
                      <Text style={s.pendTag}>edit ›</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          }
          ListEmptyComponent={<Text style={s.empty}>{offline ? 'Offline and nothing cached yet.' : fitterView ? (teamId ? 'No items are ready for your team to fit on this job yet.' : '') : 'No items on this job yet.'}</Text>}
          renderItem={({ item }) => {
            const isSnag = item.kind === 'snag';
            const st = item.install_status ? INSTALL_LABEL[item.install_status] ?? item.install_status : null;
            return (
              <TouchableOpacity style={[s.card, isSnag && s.cardSnag]} onPress={() => onOpen(item.id)} activeOpacity={0.7}>
                <View style={s.cardTop}>
                  <Text style={s.code}>{item.full_code}</Text>
                  {isSnag && <Text style={s.snag}>SNAG</Text>}
                </View>
                <Text style={s.meta}>
                  {(item.room_code || '—')} · {(item.item_code || '—')} · {STAGE_LABEL[item.stage] ?? item.stage}
                </Text>
                <View style={s.tags}>
                  {item.monday_item_id
                    ? <Text style={[s.tag, s.tagGreen]}>on Monday</Text>
                    : <Text style={[s.tag, s.tagGrey]}>saved · not on Monday</Text>}
                  {st && <Text style={[s.tag, s.tagAmber]}>{st}</Text>}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: C.purple, paddingTop: 8, paddingBottom: 14, paddingHorizontal: 16 },
  hrow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  back: { color: '#cfc9ea', fontSize: 14, fontWeight: '600' },
  newBtn: { color: '#fff', fontSize: 14, fontWeight: '800' },
  htitle: { color: '#fff', fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hname: { color: '#cfc9ea', fontSize: 13, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: { backgroundColor: C.amberSoft, color: C.amber, fontWeight: '700', fontSize: 12, padding: 10, borderRadius: 10, marginBottom: 10 },
  pendingBox: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#f3d19a', borderRadius: 14, padding: 12, marginBottom: 12 },
  pendingHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  pendingTitle: { fontSize: 13, fontWeight: '800', color: C.amber },
  syncNow: { fontSize: 13, fontWeight: '800', color: C.magenta },
  pendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#f7ecd8' },
  pendCode: { fontSize: 12.5, fontWeight: '600', color: C.ink, flexShrink: 1 },
  pendTag: { fontSize: 10, fontWeight: '800', color: C.amber, backgroundColor: C.amberSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
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
