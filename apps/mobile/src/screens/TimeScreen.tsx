// Production time (role "production"): pick a task of a job and start the timer; stop it, or start
// another task (that stops the running one). "Moje zadania" keeps the last tasks used for one-tap
// switching, and each of them can get the worker's own name (kept on this phone only). Its first line, "Bez zadania",
// starts the clock without a task — the task is picked later in Moje wpisy (prod_start_free). Entries of the last
// 7 days can be corrected (time, not date, and the task — moved to another one, as in Clockify) and commented,
// today's also deleted; older ones only by the
// production manager in the office app. Start/stop/edit go through the database functions prod_start,
// prod_stop and prod_edit_entry, which stamp and check the time on the server. Polish: production
// works in Orpiszew. WEM tasks made from an order (code + planned quantity) ask the time type at START (Praca /
// Przezbrojenie / Poprawka — prod_start_typed) and the quantity done at STOP (prod_stop_qty) — also when another
// task is started over a running one; each shows "zrobione x / planned" from prod_wem_done.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert, AppState, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useKeyboardPad } from '../lib/useKeyboardPad';
import { C } from '../lib/theme';
import { groupTasks, clock, hoursToday, recentTasks, taskLabel, taskName, isFree, editableToday, editableRecent, shiftWithinDay, atTime, hhmm, editProblem, todayByTask, countToday, sameDay, measured, qtyDefault, parseQty, typeLabel, doneLine, fmtQty, TIME_TYPES, type ProdTask, type TimeEntry, type TimeType } from '../lib/timeLogic';

export default function TimeScreen() {
  const [tasks, setTasks] = useState<ProdTask[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [pickFirst, setPickFirst] = useState(false);   // open the edit sheet on the task list (an entry with no task yet)
  const edit = (e: TimeEntry) => { setPickFirst(isFree(e)); setEditing(e); };
  // Two tabs under the running task: the tasks (with Moje zadania on top) and the worker's own entries.
  const [tab, setTab] = useState<'tasks' | 'entries'>('tasks');
  // The worker's own task names (task id → name), on this phone only — the office and the export keep the real name.
  const [own, setOwn] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<ProdTask | null>(null);
  // WEM: done so far per task (everyone's work entries), and the START / STOP sheet asking the type and the quantity
  const [done, setDone] = useState<Map<string, number>>(new Map());
  const [flow, setFlow] = useState<{ next: ProdTask | 'free' | null } | null>(null);
  useEffect(() => { AsyncStorage.getItem(NAMES_KEY).then((v) => { try { if (v) setOwn(JSON.parse(v) ?? {}); } catch { /* ignore a broken value */ } }).catch(() => {}); }, []);
  const saveName = (id: string, name: string) => setOwn((cur) => {
    const next = { ...cur }; if (name.trim()) next[id] = name.trim().slice(0, 80); else delete next[id];
    AsyncStorage.setItem(NAMES_KEY, JSON.stringify(next)).catch(() => {}); return next;
  });

  const load = useCallback(async () => {
    try {
      // the WEM columns (migrations 0114 / 0115) may not be there yet — then the plain columns
      const tq = (cols: string) => supabase.from('prod_tasks').select(cols).eq('active', true).order('job_ref');
      const eq = (cols: string) => supabase.from('time_entries').select(cols).order('started_at', { ascending: false }).limit(60);
      let [t, e]: any[] = await Promise.all([tq('id,job_ref,operation,alias,export_name,code,position,station,planned_qty,unit'), eq('id,task_id,task_name,job_key,started_at,ended_at,note,time_type,qty_done')]);
      if (t.error) t = await tq('id,job_ref,operation,alias,export_name');
      if (e.error) e = await eq('id,task_id,task_name,job_key,started_at,ended_at,note');
      if (t.error) throw t.error; if (e.error) throw e.error;
      setTasks((t.data as ProdTask[]) ?? []); setEntries((e.data as TimeEntry[]) ?? []);
      if (((t.data as ProdTask[]) ?? []).some((x) => measured(x))) {
        const d = await supabase.rpc('prod_wem_done');
        if (!d.error) setDone(new Map(((d.data as any[]) ?? []).map((r) => [r.task_id, Number(r.done) || 0])));
      }
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
  // A WEM task asks its type at START; the running WEM task asks its quantity first (STOP, or another task started).
  const qtyFirst = measured(runningTask);
  const start = (t: ProdTask) => (measured(t) || qtyFirst ? setFlow({ next: t }) : act(() => supabase.rpc('prod_start', { p_task: t.id })));
  const stop = () => (qtyFirst ? setFlow({ next: null }) : act(() => supabase.rpc('prod_stop')));
  const startFree = () => (qtyFirst ? setFlow({ next: 'free' }) : act(() => supabase.rpc('prod_start_free')));
  const runFlow = async (qty: number | null, type: TimeType | null) => {
    const next = flow?.next ?? null;
    const ok = await act(async () => {
      if (qty !== null) { const r = await supabase.rpc('prod_stop_qty', { p_qty: qty }); if (r.error) return r; }
      if (next === 'free') return supabase.rpc('prod_start_free');
      if (next) return type ? supabase.rpc('prod_start_typed', { p_task: next.id, p_type: type }) : supabase.rpc('prod_start', { p_task: next.id });
      return qty === null ? supabase.rpc('prod_stop') : { error: null };
    });
    if (ok) setFlow(null);
  };
  const runningFree = !!running && isFree(running);
  const freeCount = entries.filter((e) => isFree(e) && editableRecent(e, new Date(now))).length;
  const recent = recentTasks(entries, tasks, 6);
  const groups = groupTasks(tasks, query);
  const today = hoursToday(entries, new Date(now));
  const byTask = todayByTask(entries, new Date(now));
  const nToday = countToday(entries, new Date(now));
  const doneOf = (t: ProdTask) => done.get(t.id) ?? 0;
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
  const taskRow = (t: ProdTask, label: string, renamable = false) => {
    const on = running?.task_id === t.id, today = byTask.get(t.id);
    return (
      <View key={t.id} style={s.row}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text style={[s.op, { marginRight: 0 }, on && { color: C.green, fontWeight: '800' }]} numberOfLines={2}>{label}</Text>
          {measured(t) && <Text style={s.today} numberOfLines={1}>{[t.station, doneLine(t, doneOf(t))].filter(Boolean).join(' · ')}</Text>}
          {!!today && <Text style={s.today}>dziś {short(today)}</Text>}
        </View>
        {renamable && <TouchableOpacity style={s.ren} onPress={() => setRenaming(t)} hitSlop={8} accessibilityLabel="Zmień nazwę"><Text style={s.renT}>✎</Text></TouchableOpacity>}
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
              <Text style={s.task} numberOfLines={2}>{runningTask ? taskName(runningTask, own) : running.task_name}</Text>
              <Text style={s.muted}>{running.time_type ? typeLabel(running.time_type) + ' · ' : ''}od {fmtT(running.started_at)} · dzisiaj {today.toFixed(2).replace('.', ',')} h</Text>
              {runningFree && <TouchableOpacity onPress={() => edit(running)} style={{ marginTop: 4 }}><Text style={s.pickT}>Wybierz zadanie ›</Text></TouchableOpacity>}
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
          {([['tasks', 'Zadania'], ['entries', `Moje wpisy${nToday ? ` (${nToday})` : ''}${freeCount ? ` · ⚠${freeCount}` : ''}`]] as const).map(([k, l]) => (
            <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)} activeOpacity={0.8}><Text style={[s.tabT, tab === k && s.tabTOn]}>{l}</Text></TouchableOpacity>
          ))}
        </View>

        {tab === 'tasks' && <>
        <View style={[s.group, { borderColor: C.purple }]}>
          <Text style={s.job}>Moje zadania</Text>
          {/* first line: start now, pick the task later */}
          <View style={s.row}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={[s.op, { marginRight: 0 }, runningFree && { color: C.green, fontWeight: '800' }]}>⏱ Bez zadania</Text>
              <Text style={s.today}>start teraz, zadanie wybierzesz później</Text>
            </View>
            {runningFree ? <Text style={s.onT}>trwa</Text>
              : <TouchableOpacity style={s.start} onPress={startFree} disabled={busy} activeOpacity={0.85}><Text style={s.startT}>Start</Text></TouchableOpacity>}
          </View>
          {recent.map((t) => taskRow(t, taskName(t, own), true))}
        </View>

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
        {freeCount > 0 && <Text style={s.warnBox}>⚠ {freeCount === 1 ? '1 wpis bez zadania' : `${freeCount} wpisy bez zadania`} — dotknij wpisu i wybierz zadanie (do 7 dni; później przypisuje kierownik produkcji).</Text>}
        {entries.map((e, i) => {
          const can = editableRecent(e, new Date(now));
          const t = e.task_id ? tasks.find((x) => x.id === e.task_id) : undefined;   // only open tasks can be continued
          const head = i === 0 || !sameDay(new Date(e.started_at), new Date(entries[i - 1].started_at));
          return (<View key={e.id}>
            {head && <Text style={[s.small, { marginTop: i ? 16 : 4, marginBottom: 2 }]}>{dayLabel(e.started_at).toUpperCase()}</Text>}
            <TouchableOpacity key={e.id} style={s.entry} onPress={() => (can ? edit(e) : Alert.alert('Starszy wpis', 'Wpisy starsze niż 7 dni zmienia kierownik produkcji.'))} activeOpacity={0.7}>
              <View style={{ flex: 1 }}>
                {isFree(e) ? <Text style={[s.entryT, { color: '#b45309' }]} numberOfLines={1}>Bez zadania — wybierz zadanie</Text>
                  : <Text style={s.entryT} numberOfLines={1}>{t && own[t.id] ? own[t.id] : e.task_name}</Text>}
                <Text style={s.muted}>{new Date(e.started_at).toLocaleDateString('pl-PL')} {fmtT(e.started_at)}–{e.ended_at ? fmtT(e.ended_at) : 'trwa'}{e.ended_at ? ` · ${clock(Date.parse(e.ended_at) - Date.parse(e.started_at))}` : ''}</Text>
                {!!(e.time_type || e.qty_done != null) && <Text style={s.muted}>{[typeLabel(e.time_type), e.qty_done != null ? fmtQty(Number(e.qty_done)) + ' szt.' : (e.ended_at && e.time_type ? 'bez ilości' : '')].filter(Boolean).join(' · ')}</Text>}
                {!!e.note && <Text style={s.note} numberOfLines={2}>„{e.note}”</Text>}
              </View>
              {/* Last 7 days: change (today also delete, inside the edit window) + start the same task again. Older: start again only. */}
              <View style={{ flexDirection: 'row', gap: 6, paddingLeft: 8, alignItems: 'center' }}>
                {can && <TouchableOpacity style={s.eBtn} onPress={() => edit(e)}><Text style={s.eBtnT}>{isFree(e) ? 'Wybierz' : 'Zmień'}</Text></TouchableOpacity>}
                {t && running?.task_id !== t.id
                  ? <TouchableOpacity style={[s.start, { paddingHorizontal: 12, paddingVertical: 7 }]} onPress={() => start(t)} disabled={busy} activeOpacity={0.85}><Text style={[s.startT, { fontSize: 14 }]}>▶ Start</Text></TouchableOpacity>
                  : running?.task_id === t?.id && t ? <Text style={s.onT}>trwa</Text>
                  : !can ? <Text style={[s.edit, { color: C.muted }]}>🔒</Text> : null}
              </View>
            </TouchableOpacity>
          </View>);
        })}
        </>}
      </ScrollView>
      {editing && <EditEntry entry={editing} wem={!!editing.time_type || measured(tasks.find((x) => x.id === editing.task_id))} pickFirst={pickFirst} tasks={tasks} recent={recent} own={own} label={(() => { const t = tasks.find((x) => x.id === editing.task_id); return t ? taskName(t, own) : editing.task_name ?? ''; })()}
        onClose={() => setEditing(null)}
        onDelete={editableToday(editing, new Date(now)) ? () => editing && removeEntry(editing) : null}
        onSave={async (startD, endD, note, taskId, wemType, wemQty) => {
          // p_task only when the task changes (the 5-parameter version needs migration 0105)
          const args: Record<string, any> = { p_entry: editing.id, p_start: startD.toISOString(), p_end: endD ? endD.toISOString() : null, p_note: note };
          if (taskId) args.p_task = taskId;
          const changedWem = wemType !== (editing.time_type ?? null) || (wemQty !== null && wemQty !== (editing.qty_done == null ? null : Number(editing.qty_done)));
          const ok = await act(async () => {
            const r = await supabase.rpc('prod_edit_entry', args); if (r.error || !changedWem) return r;
            return supabase.rpc('prod_edit_wem', { p_entry: editing.id, p_type: wemType, p_qty: editing.ended_at ? wemQty : null });
          });
          if (ok) setEditing(null);
        }} />}
      {flow && <WemFlow next={flow.next} running={qtyFirst ? running : null} runningTask={qtyFirst ? runningTask ?? null : null} doneOf={doneOf} own={own} busy={busy}
        onClose={() => setFlow(null)} onConfirm={runFlow} />}
      {renaming && <RenameTask task={renaming} current={own[renaming.id] ?? ''} onClose={() => setRenaming(null)} onSave={(name) => { saveName(renaming.id, name); setRenaming(null); }} />}
    </View>
  );
}

/** The server's messages are in English; the workers read Polish. */
function plError(err: any): string {
  const m = String(err?.message ?? err).replace(/^.*?: /, '');
  const map: Record<string, string> = {
    "Only today's entries can be changed here — ask the production manager.": 'Usuwać można tylko dzisiejsze wpisy — starsze zmienia kierownik produkcji.',
    'Only entries of the last 7 days can be changed here — ask the production manager.': 'Zmieniać można wpisy z ostatnich 7 dni — starsze zmienia kierownik produkcji.',
    'The comment can have at most 100 characters.': 'Komentarz może mieć najwyżej 100 znaków.',
    'The start must stay on the same day.': 'Początek musi zostać tego samego dnia.',
    'The end must stay on the same day.': 'Koniec musi zostać tego samego dnia.',
    'The start cannot be in the future.': 'Początek nie może być w przyszłości.',
    'The end cannot be in the future.': 'Koniec nie może być w przyszłości.',
    'The end is before the start.': 'Koniec jest przed początkiem.',
    'Stop the task before changing its end.': 'Zatrzymaj zadanie, zanim zmienisz jego koniec.',
    "This entry's job is locked in Job costs — ask the production manager.": 'Zlecenie tego wpisu jest zamknięte w kosztach — zmianę robi kierownik produkcji.',
    "The chosen task's job is locked in Job costs — ask the production manager.": 'Zlecenie wybranego zadania jest zamknięte w kosztach — zmianę robi kierownik produkcji.',
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

function EditEntry({ entry, wem, label, tasks, recent, own, pickFirst, onClose, onSave, onDelete }: { entry: TimeEntry; wem: boolean; label: string; pickFirst: boolean; tasks: ProdTask[]; recent: ProdTask[]; own: Record<string, string>; onClose: () => void; onSave: (start: Date, end: Date | null, note: string, taskId: string | null, type: TimeType | null, qty: number | null) => void; onDelete: (() => void) | null }) {
  // WEM: the time type and (once stopped) the quantity done
  const [wType, setWType] = useState<TimeType | null>(entry.time_type ?? null);
  const [qtyText, setQtyText] = useState(entry.qty_done == null ? '' : String(entry.qty_done).replace('.', ','));
  const qty = parseQty(qtyText);
  const running = !entry.ended_at;
  const kb = useKeyboardPad();
  // the task: the entry can be moved to another open task (the server checks it and the Job costs locks)
  const [taskId, setTaskId] = useState<string | null>(entry.task_id);
  const [picking, setPicking] = useState(pickFirst);
  const [q, setQ] = useState('');
  const chosen = taskId ? tasks.find((x) => x.id === taskId) : undefined;
  const moved = !!taskId && taskId !== entry.task_id;
  const choices = q.trim() ? groupTasks(tasks, q).flatMap((g) => g.tasks).slice(0, 40) : recent;
  const [start, setStart] = useState(new Date(entry.started_at));
  const [end, setEnd] = useState<Date | null>(entry.ended_at ? new Date(entry.ended_at) : null);
  const [startText, setStartText] = useState(hhmm(new Date(entry.started_at)));
  const [endText, setEndText] = useState(entry.ended_at ? hhmm(new Date(entry.ended_at)) : '');
  const [note, setNote] = useState(entry.note ?? '');
  const problem = editProblem(start, end, running, new Date(), note) ?? (wem && !running && (qty === null || !wType) ? 'Wybierz rodzaj czasu i wpisz ilość wykonaną.' : null);
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
        <View style={[s.sheet, kb > 0 && { paddingBottom: 30 + kb }]}>
          <Text style={s.muted}>{new Date(entry.started_at).toLocaleDateString('pl-PL')} — data się nie zmienia</Text>
          <Text style={[s.small, { marginTop: 10 }]}>ZADANIE</Text>
          <TouchableOpacity style={s.pickBox} onPress={() => { setPicking((v) => !v); setQ(''); }} activeOpacity={0.8}>
            <Text style={[s.task, { flex: 1 }]} numberOfLines={2}>{chosen ? taskName(chosen, own) : label}</Text>
            <Text style={s.pickT}>{picking ? 'Zamknij' : 'Zmień zadanie'}</Text>
          </TouchableOpacity>
          {moved && !picking && <Text style={s.muted}>było: {label}</Text>}
          {picking ? (<>
            <TextInput style={[s.search, { marginTop: 8, marginBottom: 6 }]} placeholder="Szukaj: numer zlecenia lub operacja" placeholderTextColor={C.muted} value={q} onChangeText={setQ} autoCorrect={false} autoFocus />
            {!q.trim() && <Text style={[s.small, { marginBottom: 2 }]}>MOJE ZADANIA</Text>}
            <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled">
              {choices.map((t) => (
                <TouchableOpacity key={t.id} style={s.pickRow} onPress={() => { setTaskId(t.id); setPicking(false); setQ(''); }}>
                  <Text style={[s.op, t.id === taskId && { color: C.green, fontWeight: '800' }]} numberOfLines={2}>{taskName(t, own)}</Text>
                  {t.id === taskId && <Text style={s.onT}>✓</Text>}
                </TouchableOpacity>
              ))}
              {choices.length === 0 && <Text style={[s.muted, { paddingVertical: 10 }]}>{q.trim() ? 'Brak zadań dla tego wyszukiwania.' : 'Wpisz numer zlecenia lub operację.'}</Text>}
            </ScrollView>
          </>) : (<>
          <TimeField title="POCZĄTEK" d={start} text={startText} setD={setStart} setText={setStartText} />
          {running ? <Text style={[s.muted, { marginTop: 12 }]}>Zadanie trwa — koniec ustawia przycisk STOP.</Text>
            : <TimeField title="KONIEC" d={end ?? start} text={endText} setD={(x) => setEnd(x)} setText={setEndText} />}
          {wem && <>
            <Text style={[s.small, { marginTop: 14 }]}>RODZAJ CZASU</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
              {TIME_TYPES.map(([k, l]) => <TouchableOpacity key={k} style={[s.chip, wType === k && s.chipOn]} onPress={() => setWType(k)}><Text style={[s.chipT, wType === k && s.chipTOn]}>{l}</Text></TouchableOpacity>)}
            </View>
            {!running && <><Text style={[s.small, { marginTop: 12 }]}>ILOŚĆ WYKONANA</Text>
              <TextInput style={s.qtyIn} value={qtyText} onChangeText={setQtyText} keyboardType="decimal-pad" maxLength={8} /></>}
          </>}
          <Text style={[s.small, { marginTop: 14 }]}>KOMENTARZ ({note.length}/100)</Text>
          <TextInput style={s.noteIn} value={note} onChangeText={setNote} maxLength={100} placeholder="np. przerwa na naprawę maszyny" placeholderTextColor={C.muted} multiline />
          </>)}
          {!!problem && !picking && <Text style={s.err}>{problem}</Text>}
          {!picking && <>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <TouchableOpacity style={[s.btn, { backgroundColor: C.soft }]} onPress={onClose}><Text style={[s.btnT, { color: C.ink }]}>Anuluj</Text></TouchableOpacity>
            <TouchableOpacity style={[s.btn, !!problem && { opacity: 0.4 }]} disabled={!!problem} onPress={() => onSave(start, running ? null : end, note.trim(), moved ? taskId : null, wem ? wType : (entry.time_type ?? null), wem && !running ? qty : null)}><Text style={s.btnT}>Zapisz</Text></TouchableOpacity>
          </View>
          {onDelete ? <TouchableOpacity style={s.delLink} onPress={onDelete}><Text style={s.delLinkT}>Usuń ten wpis</Text></TouchableOpacity>
            : <Text style={[s.muted, { textAlign: 'center', marginTop: 14 }]}>Wpis z poprzedniego dnia — usunąć go może kierownik produkcji.</Text>}
          </>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** WEM START / STOP sheet. First the quantity done on the running WEM task (STOP, or another task started over
 *  it): work — prefilled with what is left of the plan, setup — 0, rework — typed. Then, when the next task is a WEM
 *  task, its time type: three big buttons. */
function WemFlow({ next, running, runningTask, doneOf, own, busy, onClose, onConfirm }: { next: ProdTask | 'free' | null; running: TimeEntry | null; runningTask: ProdTask | null; doneOf: (t: ProdTask) => number; own: Record<string, string>; busy: boolean; onClose: () => void; onConfirm: (qty: number | null, type: TimeType | null) => void }) {
  const kb = useKeyboardPad();
  const askQty = !!running && !!runningTask, askType = !!next && next !== 'free' && measured(next);
  const [qtyText, setQtyText] = useState(askQty ? qtyDefault(running!.time_type, runningTask!.planned_qty, doneOf(runningTask!)) : '');
  const qty = parseQty(qtyText);
  const go = (type: TimeType | null) => { if (askQty && qty === null) return; onConfirm(askQty ? qty : null, type); };
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
        <View style={[s.sheet, kb > 0 && { paddingBottom: 30 + kb }]}>
          {askQty && <>
            <Text style={s.small}>{next ? 'NAJPIERW ZAKOŃCZ' : 'STOP'}</Text>
            <Text style={[s.task, { marginTop: 4 }]} numberOfLines={2}>{taskName(runningTask!, own)}</Text>
            <Text style={s.muted}>{[typeLabel(running!.time_type), doneLine(runningTask!, doneOf(runningTask!))].filter(Boolean).join(' · ')}</Text>
            <Text style={[s.small, { marginTop: 12 }]}>ILOŚĆ WYKONANA{runningTask!.unit ? ' (' + runningTask!.unit + ')' : ''}{running!.time_type === 'rework' ? ' — POPRAWIONE SZTUKI' : ''}</Text>
            <TextInput style={s.qtyIn} value={qtyText} onChangeText={setQtyText} keyboardType="decimal-pad" maxLength={8} autoFocus={!askType} selectTextOnFocus />
            {qty === null && <Text style={s.err}>Wpisz ilość (0, jeśli nic nie zrobiono).</Text>}
          </>}
          {askType ? <>
            <Text style={[s.small, { marginTop: askQty ? 16 : 0 }]}>START — RODZAJ CZASU</Text>
            <Text style={[s.task, { marginTop: 4 }]} numberOfLines={2}>{taskName(next as ProdTask, own)}</Text>
            <Text style={s.muted}>{[(next as ProdTask).station, doneLine(next as ProdTask, doneOf(next as ProdTask))].filter(Boolean).join(' · ')}</Text>
            {TIME_TYPES.map(([k, l]) => (
              <TouchableOpacity key={k} style={[s.typeBtn, k === 'work' && { backgroundColor: C.purple }, (busy || (askQty && qty === null)) && { opacity: 0.4 }]} disabled={busy || (askQty && qty === null)} onPress={() => go(k)} activeOpacity={0.85}>
                <Text style={[s.typeBtnT, k === 'work' && { color: C.white }]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </> : (
            <TouchableOpacity style={[s.btn, { marginTop: 16, flex: 0 }, (busy || qty === null) && { opacity: 0.4 }]} disabled={busy || qty === null} onPress={() => go(null)}>
              <Text style={s.btnT}>{next === 'free' ? 'Zapisz i start bez zadania' : next ? 'Zapisz i start' : 'Zapisz i STOP'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.delLink} onPress={onClose}><Text style={[s.delLinkT, { color: C.muted }]}>Anuluj</Text></TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const NAMES_KEY = 'prodTaskNames.v1';

/** The worker's own name for a task in Moje zadania — on this phone only. Empty = back to the real name. */
function RenameTask({ task, current, onClose, onSave }: { task: ProdTask; current: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(current || taskLabel(task));
  const kb = useKeyboardPad();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
        <View style={[s.sheet, kb > 0 && { paddingBottom: 30 + kb }]}>
          <Text style={s.task}>Nazwa zadania</Text>
          <Text style={s.muted}>Tylko na tym telefonie — biuro i eksport widzą: {taskLabel(task)}</Text>
          <TextInput style={[s.noteIn, { minHeight: 0, fontSize: 17 }]} value={name} onChangeText={setName} maxLength={80} autoFocus selectTextOnFocus placeholder={taskLabel(task)} placeholderTextColor={C.muted} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <TouchableOpacity style={[s.btn, { backgroundColor: C.soft }]} onPress={onClose}><Text style={[s.btnT, { color: C.ink }]}>Anuluj</Text></TouchableOpacity>
            <TouchableOpacity style={s.btn} onPress={() => onSave(name.trim() === taskLabel(task) ? '' : name)}><Text style={s.btnT}>Zapisz</Text></TouchableOpacity>
          </View>
          {!!current && <TouchableOpacity style={s.delLink} onPress={() => onSave('')}><Text style={[s.delLinkT, { color: C.purple }]}>Przywróć nazwę: {taskLabel(task)}</Text></TouchableOpacity>}
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
  eBtnT: { color: C.purple, fontWeight: '800', fontSize: 13 },
  delLink: { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  ren: { paddingHorizontal: 10, paddingVertical: 6, marginRight: 4 },
  warnBox: { backgroundColor: '#fff7ed', color: '#9a3412', borderRadius: 10, padding: 10, marginBottom: 8, fontSize: 13 },
  pickBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
  pickT: { color: C.purple, fontWeight: '800', fontSize: 14 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.soft },
  renT: { fontSize: 18, color: C.purple, fontWeight: '800' },
  delLinkT: { color: C.magenta, fontWeight: '800', fontSize: 15 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: C.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 30 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  step: { backgroundColor: C.soft, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, minWidth: 48, alignItems: 'center' },
  stepT: { fontSize: 15, fontWeight: '800', color: C.purple },
  // the quantity done (WEM): its own height — timeIn's flex: 1 collapses it to a sliver in a column on Android
  qtyIn: { height: 60, marginTop: 6, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 0, paddingHorizontal: 12, fontSize: 26, fontWeight: '800', textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false, color: C.ink },
  timeIn: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 9, fontSize: 20, fontWeight: '800', textAlign: 'center', color: C.ink },
  noteIn: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, fontSize: 15, color: C.ink, minHeight: 60, marginTop: 6 },
  err: { color: '#dc2626', marginTop: 10 },
  btn: { flex: 1, backgroundColor: C.purple, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  btnT: { color: C.white, fontSize: 16, fontWeight: '800' },
  typeBtn: { marginTop: 10, borderRadius: 12, paddingVertical: 16, alignItems: 'center', backgroundColor: C.soft },
  typeBtnT: { fontSize: 18, fontWeight: '800', color: C.purple },
  chip: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  chipOn: { backgroundColor: C.purple, borderColor: C.purple },
  chipT: { fontSize: 14, fontWeight: '700', color: C.ink },
  chipTOn: { color: C.white },
});
