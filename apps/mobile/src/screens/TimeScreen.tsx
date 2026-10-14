// Production time (role "production"): pick a task of a job and start the timer; stop it, or start
// another task (that stops the running one). Start/stop go through the database functions
// prod_start / prod_stop, which stamp the time on the server. Polish: production works in Orpiszew.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert, AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { groupTasks, clock, hoursToday, type ProdTask, type TimeEntry } from '../lib/timeLogic';

export default function TimeScreen() {
  const [tasks, setTasks] = useState<ProdTask[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [t, e] = await Promise.all([
        supabase.from('prod_tasks').select('id,job_ref,operation,alias,export_name').eq('active', true).order('job_ref'),
        supabase.from('time_entries').select('id,task_id,task_name,started_at,ended_at').order('started_at', { ascending: false }).limit(40),
      ]);
      if (t.error) throw t.error; if (e.error) throw e.error;
      setTasks((t.data as ProdTask[]) ?? []); setEntries((e.data as TimeEntry[]) ?? []);
    } catch (err: any) { Alert.alert('Brak połączenia', 'Nie udało się wczytać zadań. Sprawdź internet i przeciągnij w dół, aby odświeżyć.'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); }); return () => sub.remove(); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const running = entries.find((e) => !e.ended_at) ?? null;
  const runningTask = running ? tasks.find((t) => t.id === running.task_id) : null;
  const act = async (fn: () => PromiseLike<{ error: any }>) => {
    if (busy) return; setBusy(true);
    try { const { error } = await fn(); if (error) throw error; await load(); }
    catch (err: any) { Alert.alert('Nie udało się', String(err?.message ?? err).replace(/^.*?: /, '')); }
    setBusy(false);
  };
  const start = (t: ProdTask) => act(() => supabase.rpc('prod_start', { p_task: t.id }));
  const stop = () => act(() => supabase.rpc('prod_stop'));
  const groups = groupTasks(tasks, query);
  const today = hoursToday(entries, new Date(now));
  const fmtT = (iso: string) => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

  if (loading) return <View style={[s.fill, s.center]}><ActivityIndicator color={C.magenta} /></View>;
  return (
    <ScrollView style={s.fill} contentContainerStyle={{ padding: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <View style={[s.card, running ? s.cardOn : null]}>
        {running ? (<>
          <Text style={s.small}>TRWA</Text>
          <Text style={s.big}>{clock(now - Date.parse(running.started_at))}</Text>
          <Text style={s.task}>{runningTask ? `${runningTask.job_ref} · ${runningTask.operation}` : running.task_name}</Text>
          <Text style={s.muted}>od {fmtT(running.started_at)}</Text>
          <TouchableOpacity style={s.stop} onPress={stop} disabled={busy} activeOpacity={0.85}><Text style={s.stopT}>{busy ? '…' : 'STOP'}</Text></TouchableOpacity>
        </>) : (<>
          <Text style={s.small}>NIC NIE TRWA</Text>
          <Text style={s.muted}>Wybierz zadanie poniżej i naciśnij Start.</Text>
        </>)}
        <Text style={[s.muted, { marginTop: 10 }]}>Dzisiaj: {today.toFixed(2).replace('.', ',')} h</Text>
      </View>

      <TextInput style={s.search} placeholder="Szukaj: numer zlecenia lub operacja" placeholderTextColor={C.muted} value={query} onChangeText={setQuery} autoCorrect={false} />
      {groups.length === 0 && <Text style={[s.muted, { textAlign: 'center', marginTop: 20 }]}>{tasks.length ? 'Brak zadań dla tego wyszukiwania.' : 'Brak zadań — kierownik produkcji musi je wczytać.'}</Text>}
      {groups.map((g) => (
        <View key={g.job} style={s.group}>
          <Text style={s.job}>{g.job}</Text>
          {g.tasks.map((t) => {
            const on = running?.task_id === t.id;
            return (
              <View key={t.id} style={s.row}>
                <Text style={[s.op, on && { color: C.green, fontWeight: '800' }]} numberOfLines={2}>{t.operation}</Text>
                {on ? <Text style={s.onT}>trwa</Text>
                  : <TouchableOpacity style={s.start} onPress={() => start(t)} disabled={busy} activeOpacity={0.85}><Text style={s.startT}>Start</Text></TouchableOpacity>}
              </View>
            );
          })}
        </View>
      ))}

      {entries.filter((e) => e.ended_at).length > 0 && <Text style={[s.job, { marginTop: 18 }]}>Ostatnie wpisy</Text>}
      {entries.filter((e) => e.ended_at).slice(0, 15).map((e) => (
        <View key={e.id} style={s.entry}>
          <Text style={s.entryT} numberOfLines={1}>{e.task_name}</Text>
          <Text style={s.muted}>{new Date(e.started_at).toLocaleDateString('pl-PL')} {fmtT(e.started_at)}–{fmtT(e.ended_at!)} · {clock(Date.parse(e.ended_at!) - Date.parse(e.started_at))}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.white, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: C.line, alignItems: 'center', marginBottom: 14 },
  cardOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  small: { fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 1 },
  big: { fontSize: 44, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'], marginVertical: 4 },
  task: { fontSize: 16, fontWeight: '700', color: C.ink, textAlign: 'center' },
  muted: { fontSize: 13, color: C.muted },
  stop: { marginTop: 14, backgroundColor: C.magenta, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 50 },
  stopT: { color: C.white, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  search: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.ink, marginBottom: 12 },
  group: { backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 10 },
  job: { fontSize: 15, fontWeight: '800', color: C.purple, marginVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.soft },
  op: { flex: 1, fontSize: 15, color: C.ink, marginRight: 10 },
  start: { backgroundColor: C.purple, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  startT: { color: C.white, fontSize: 15, fontWeight: '800' },
  onT: { color: C.green, fontWeight: '800', paddingHorizontal: 12 },
  entry: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  entryT: { fontSize: 14, color: C.ink, fontWeight: '600' },
});
