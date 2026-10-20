// Production time (role "production"): pick a task of a job and start the timer; stop it, or start
// another task (that stops the running one). "Moje zadania" keeps the last tasks used for one-tap
// switching. Today's entries can be corrected (time, not date) and commented; older ones only by the
// production manager in the office app. Start/stop/edit go through the database functions prod_start,
// prod_stop and prod_edit_entry, which stamp and check the time on the server. Polish: production
// works in Orpiszew.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert, AppState, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { groupTasks, clock, hoursToday, recentTasks, taskLabel, editableToday, shiftWithinDay, atTime, hhmm, editProblem, todayByTask, countToday, sameDay, type ProdTask, type TimeEntry } from '../lib/timeLogic';

export default function TimeScreen() {
  const [tasks, setTasks] = useState<ProdTask[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  // Two tabs under the running task: the tasks (with Moje zadania on top) and the worker's own entries.
  const [tab, setTab] = useState<'tasks' | 'entries'>('tasks');

  const load = useCallback(async () => {
    try {
      const [t, e] = await Promise.all([
        supabase.from('prod_tasks').select('id,job_ref,operation,alias,export_name').eq('active', true).order('job_ref'),
        supabase.from('time_entries').select('id,task_id,task_name,started_at,ended_at,note').order('started_at', { ascending: false }).limit(60),
      ]);
      if (t.error) throw t.error; if (e.error) throw e.error;
      setTasks((t.data as ProdTask[]) ?? []); setEntries((e.data as TimeEntry[]) ?? []);
    } catch { Alert.alert('Brak połączenia', 'Nie udało się wczytać zadań. Sprawdź internet i przeciągnij w dół, aby odświeżyć.'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); }); return () => sub.remove(); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const running = entries.find((e) => !e.ended_at) ?? null;
  const runningTask = running ? tasks.find((t) => t.id === running.task_id) : null;
  const act = async (fn: () => PromiseLike<{ error: any }>) => {
    if (busy) return false; setBusy(true);
    let ok = true;
    try { const { error } = await fn(); if (error) throw error; await load(); }
    catch (err: any) { ok = false; Alert.alert('Nie udało się', plError(err)); }
    setBusy(false); return ok;
  };
  const start = (t: ProdTask) => act(() => supabase.rpc('prod_start', { p_task: t.id }));
  const stop = () => act(() => supabase.rpc('prod_stop'));
  const recent = recentTasks(entries, tasks, 6);
  const groups = groupTasks(tasks, query);
  const today = hoursToday(entries, new Date(now));
  const byTask = todayByTask(entries, new Date(now));
  const nToday = countToday(entries, new Date(now));
  const short = (ms: number) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const dayLabel = (iso: string) => { const d = new Date(iso), n = new Date(now), y = new Date(n); y.setDate(n.getDate() - 1); return sameDay(d, n) ? 'Dziś' : sameDay(d, y) ? 'Wczoraj' : d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }); };
  // Delete one of today's own entries (prod_delete_entry checks the same on the server and logs it).
  const removeEntry = (e: TimeEntry) => Alert.alert('Usunąć wpis?',
    `${e.task_name ?? ''}\n${fmtT(e.started_at)}–${e.ended_at ? fmtT(e.ended_at) : 'trwa'}${e.ended_at ? '' : '\nZadanie zostanie zatrzymane i usunięte.'}`,
    [{ text: 'Anuluj', style: 'cancel' }, { text: 'Usuń', style: 'destructive', onPress: async () => {
      const ok = await act(() => supabase.rpc('prod_delete_entry', { p_entry: e.id }));
      if (ok) setEditing(null);
    } }]);
  const fmtT = (iso: string) => hhmm(new Date(iso));

  // a plain function, not a component: the clock re-renders every second and must not remount the rows
  const taskRow = (t: ProdTask, label: string) => {
    const on = running?.task_id === t.id, done = byTask.get(t.id);
    return (
      <View key={t.id} style={s.row}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text style={[s.op, { marginRight: 0 }, on && { color: C.green, fontWeight: '800' }]} numberOfLines={2}>{label}</Text>
          {!!done && <Text style={s.today}>dziś {short(done)}</Text>}
        </View>
        {on ? <Text style={s.onT}>trwa</Text>
          : <TouchableOpacity style={s.start} onPress={() => start(t)} disabled={busy} activeOpacity={0.85}><Text style={s.startT}>Start</Text></TouchableOpacity>}
      </View>
    );
  };

  if (loading) return <View style={[s.fill, s.center]}><ActivityIndicator color={C.magenta} /></View>;
  return (
    <View style={s.fill}>
      <ScrollView style={s.fill} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        {/* the running task: compact, so the task lists start high on the screen */}
        <View style={[s.card, running ? s.cardOn : null]}>
          <View style={{ flex: 1 }}>
            {running ? (<>
              <Text style={s.task} numberOfLines={2}>{runningTask ? taskLabel(runningTask) : running.task_name}</Text>
              <Text style={s.muted}>od {fmtT(running.started_at)} · dzisiaj {today.toFixed(2).replace('.', ',')} h</Text>
            </>) : (<>
              <Text style={s.small}>NIC NIE TRWA</Text>
              <Text style={s.muted}>dzisiaj {today.toFixed(2).replace('.', ',')} h</Text>
            </>)}
          </View>
          {running && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.big}>{clock(now - Date.parse(running.started_at))}</Text>
              <TouchableOpacity style={s.stop} onPress={stop} disabled={busy} activeOpacity={0.85}><Text style={s.stopT}>{busy ? '…' : 'STOP'}</Text></TouchableOpacity>
            </View>
          )}
        </View>

        <View style={s.tabs}>
          {([['tasks', 'Zadania'], ['entries', `Moje wpisy${nToday ? ` (${nToday})` : ''}`]] as const).map(([k, l]) => (
            <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)} activeOpacity={0.8}><Text style={[s.tabT, tab === k && s.tabTOn]}>{l}</Text></TouchableOpacity>
          ))}
        </View>

        {tab === 'tasks' && <>
        {recent.length > 0 && (
          <View style={[s.group, { borderColor: C.purple }]}>
            <Text style={s.job}>Moje zadania</Text>
            {recent.map((t) => taskRow(t, taskLabel(t)))}
          </View>
        )}

        <TextInput style={s.search} placeholder="Szukaj: numer zlecenia lub operacja" placeholderTextColor={C.muted} value={query} onChangeText={setQuery} autoCorrect={false} />
        {groups.length === 0 && <Text style={[s.muted, { textAlign: 'center', marginTop: 20 }]}>{tasks.length ? 'Brak zadań dla tego wyszukiwania.' : 'Brak zadań — kierownik produkcji musi je wczytać.'}</Text>}
        {groups.map((g) => (
          <View key={g.job} style={s.group}>
            <Text style={s.job}>{g.job}</Text>
            {g.tasks.map((t) => taskRow(t, t.operation))}
          </View>
        ))}

        </>}

        {tab === 'entries' && <>
        {entries.length === 0 && <Text style={[s.muted, { textAlign: 'center', marginTop: 20 }]}>Brak wpisów — uruchom zadanie w zakładce Zadania.</Text>}
        {entries.map((e, i) => {
          const can = editableToday(e, new Date(now));
          const t = e.task_id ? tasks.find((x) => x.id === e.task_id) : undefined;   // only open tasks can be continued
          const head = i === 0 || !sameDay(new Date(e.started_at), new Date(entries[i - 1].started_at));
          return (<View key={e.id}>
            {head && <Text style={[s.small, { marginTop: i ? 16 : 4, marginBottom: 2 }]}>{dayLabel(e.started_at).toUpperCase()}</Text>}
            <TouchableOpacity key={e.id} style={s.entry} onPress={() => (can ? setEditing(e) : Alert.alert('Starszy wpis', 'Wpisy z poprzednich dni zmienia kierownik produkcji.'))} activeOpacity={0.7}>
              <View style={{ flex: 1 }}>
                <Text style={s.entryT} numberOfLines={1}>{e.task_name}</Text>
                <Text style={s.muted}>{new Date(e.started_at).toLocaleDateString('pl-PL')} {fmtT(e.started_at)}–{e.ended_at ? fmtT(e.ended_at) : 'trwa'}{e.ended_at ? ` · ${clock(Date.parse(e.ended_at) - Date.parse(e.started_at))}` : ''}</Text>
                {!!e.note && <Text style={s.note} numberOfLines={2}>„{e.note}”</Text>}
              </View>
              {can ? (
                <View style={{ flexDirection: 'row', gap: 6, paddingLeft: 8 }}>
                  <TouchableOpacity style={s.eBtn} onPress={() => setEditing(e)}><Text style={s.eBtnT}>Zmień</Text></TouchableOpacity>
                  <TouchableOpacity style={[s.eBtn, s.eDel]} onPress={() => removeEntry(e)}><Text style={[s.eBtnT, { color: C.magenta }]}>Usuń</Text></TouchableOpacity>
                </View>
              ) : t && running?.task_id !== t.id ? (
                <TouchableOpacity style={[s.start, { marginLeft: 8, paddingHorizontal: 12 }]} onPress={() => start(t)} disabled={busy} activeOpacity={0.85}><Text style={[s.startT, { fontSize: 14 }]}>Kontynuuj</Text></TouchableOpacity>
              ) : <Text style={[s.edit, { color: C.muted }]}>🔒</Text>}
            </TouchableOpacity>
          </View>);
        })}
        </>}
      </ScrollView>
      {editing && <EditEntry entry={editing} label={(() => { const t = tasks.find((x) => x.id === editing.task_id); return t ? taskLabel(t) : editing.task_name ?? ''; })()}
        onClose={() => setEditing(null)}
        onDelete={() => editing && removeEntry(editing)}
        onSave={async (startD, endD, note) => {
          const ok = await act(() => supabase.rpc('prod_edit_entry', { p_entry: editing.id, p_start: startD.toISOString(), p_end: endD ? endD.toISOString() : null, p_note: note }));
          if (ok) setEditing(null);
        }} />}
    </View>
  );
}

/** The server's messages are in English; the workers read Polish. */
function plError(err: any): string {
  const m = String(err?.message ?? err).replace(/^.*?: /, '');
  const map: Record<string, string> = {
    "Only today's entries can be changed here — ask the production manager.": 'Zmieniać można tylko dzisiejsze wpisy — starsze zmienia kierownik produkcji.',
    'The comment can have at most 100 characters.': 'Komentarz może mieć najwyżej 100 znaków.',
    'The start must stay on the same day.': 'Początek musi zostać tego samego dnia.',
    'The end must stay on the same day.': 'Koniec musi zostać tego samego dnia.',
    'The start cannot be in the future.': 'Początek nie może być w przyszłości.',
    'The end cannot be in the future.': 'Koniec nie może być w przyszłości.',
    'The end is before the start.': 'Koniec jest przed początkiem.',
    'Stop the task before changing its end.': 'Zatrzymaj zadanie, zanim zmienisz jego koniec.',
    'Task not found.': 'Nie znaleziono zadania.', 'Entry not found.': 'Nie znaleziono wpisu.', 'Not allowed.': 'Brak uprawnień.',
  };
  return map[m] ?? m;
}

// Defined outside EditEntry: a component created inside a render remounts on every keystroke and the
// time field would lose focus after each digit.
function TimeField({ title, d, text, setD, setText }: { title: string; d: Date; text: string; setD: (x: Date) => void; setText: (x: string) => void }) {
  const step = (m: number) => { const x = shiftWithinDay(d, m); setD(x); setText(hhmm(x)); };
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={s.small}>{title}</Text>
      <View style={s.timeRow}>
        {[-15, -1].map((m) => <TouchableOpacity key={m} style={s.step} onPress={() => step(m)}><Text style={s.stepT}>{m}</Text></TouchableOpacity>)}
        <TextInput style={s.timeIn} value={text} keyboardType="numbers-and-punctuation" maxLength={5}
          onChangeText={(v) => { setText(v); const x = atTime(d, v); if (x) setD(x); }} />
        {[1, 15].map((m) => <TouchableOpacity key={m} style={s.step} onPress={() => step(m)}><Text style={s.stepT}>+{m}</Text></TouchableOpacity>)}
      </View>
    </View>
  );
}

function EditEntry({ entry, label, onClose, onSave, onDelete }: { entry: TimeEntry; label: string; onClose: () => void; onSave: (start: Date, end: Date | null, note: string) => void; onDelete: () => void }) {
  const running = !entry.ended_at;
  const [start, setStart] = useState(new Date(entry.started_at));
  const [end, setEnd] = useState<Date | null>(entry.ended_at ? new Date(entry.ended_at) : null);
  const [startText, setStartText] = useState(hhmm(new Date(entry.started_at)));
  const [endText, setEndText] = useState(entry.ended_at ? hhmm(new Date(entry.ended_at)) : '');
  const [note, setNote] = useState(entry.note ?? '');
  const problem = editProblem(start, end, running, new Date(), note);
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
        <View style={s.sheet}>
          <Text style={s.task}>{label}</Text>
          <Text style={s.muted}>{new Date(entry.started_at).toLocaleDateString('pl-PL')} — data się nie zmienia</Text>
          <TimeField title="POCZĄTEK" d={start} text={startText} setD={setStart} setText={setStartText} />
          {running ? <Text style={[s.muted, { marginTop: 12 }]}>Zadanie trwa — koniec ustawia przycisk STOP.</Text>
            : <TimeField title="KONIEC" d={end ?? start} text={endText} setD={(x) => setEnd(x)} setText={setEndText} />}
          <Text style={[s.small, { marginTop: 14 }]}>KOMENTARZ ({note.length}/100)</Text>
          <TextInput style={s.noteIn} value={note} onChangeText={setNote} maxLength={100} placeholder="np. przerwa na naprawę maszyny" placeholderTextColor={C.muted} multiline />
          {!!problem && <Text style={s.err}>{problem}</Text>}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <TouchableOpacity style={[s.btn, { backgroundColor: C.soft }]} onPress={onClose}><Text style={[s.btnT, { color: C.ink }]}>Anuluj</Text></TouchableOpacity>
            <TouchableOpacity style={[s.btn, !!problem && { opacity: 0.4 }]} disabled={!!problem} onPress={() => onSave(start, running ? null : end, note.trim())}><Text style={s.btnT}>Zapisz</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={s.delLink} onPress={onDelete}><Text style={s.delLinkT}>Usuń ten wpis</Text></TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  cardOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  small: { fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 1 },
  big: { fontSize: 24, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  task: { fontSize: 15, fontWeight: '800', color: C.ink },
  muted: { fontSize: 12, color: C.muted, marginTop: 2 },
  stop: { marginTop: 6, backgroundColor: C.magenta, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 22 },
  stopT: { color: C.white, fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  search: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16, color: C.ink, marginBottom: 10 },
  group: { backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 10 },
  job: { fontSize: 15, fontWeight: '800', color: C.purple, marginVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderTopWidth: 1, borderTopColor: C.soft },
  op: { flex: 1, fontSize: 15, color: C.ink, marginRight: 10 },
  start: { backgroundColor: C.purple, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 18 },
  startT: { color: C.white, fontSize: 15, fontWeight: '800' },
  onT: { color: C.green, fontWeight: '800', paddingHorizontal: 12 },
  entry: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  entryT: { fontSize: 14, color: C.ink, fontWeight: '600' },
  note: { fontSize: 12, color: C.ink, fontStyle: 'italic', marginTop: 2 },
  edit: { color: C.purple, fontWeight: '800', paddingLeft: 10 },
  today: { fontSize: 12, color: C.muted, marginTop: 1 },
  tabs: { flexDirection: 'row', backgroundColor: C.soft, borderRadius: 12, padding: 4, marginBottom: 10, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabOn: { backgroundColor: C.white, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabT: { fontSize: 15, fontWeight: '700', color: C.muted },
  tabTOn: { color: C.purple, fontWeight: '800' },
  eBtn: { borderWidth: 1, borderColor: C.purple, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 11 },
  eDel: { borderColor: C.magenta },
  eBtnT: { color: C.purple, fontWeight: '800', fontSize: 13 },
  delLink: { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  delLinkT: { color: C.magenta, fontWeight: '800', fontSize: 15 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: C.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 30 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  step: { backgroundColor: C.soft, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, minWidth: 48, alignItems: 'center' },
  stepT: { fontSize: 15, fontWeight: '800', color: C.purple },
  timeIn: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 9, fontSize: 20, fontWeight: '800', textAlign: 'center', color: C.ink },
  noteIn: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, fontSize: 15, color: C.ink, minHeight: 60, marginTop: 6 },
  err: { color: '#dc2626', marginTop: 10 },
  btn: { flex: 1, backgroundColor: C.purple, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  btnT: { color: C.white, fontSize: 16, fontWeight: '800' },
});
