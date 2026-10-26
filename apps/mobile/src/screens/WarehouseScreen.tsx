// Warehouse (role "warehouse"): three tabs — Wydania (what was issued from the warehouse for a Z order),
// Zwroty (what came back from production: the same form, booked as PW instead of RW) and Czas pracy
// (the production time screen). A return shows how much of the symbol was issued to that Z and warns when
// more comes back than went out (wh_balance). An issue: the Z order, the Subiekt item symbol (scan the
// QR code or type it; suggestions and the name / unit / stock come from the Subiekt stock list), the
// quantity, the location (scan or type), box and a note. The worker's own issues stay listed — and can
// be changed or deleted — until the office exports them to Excel for the RW in Subiekt; then they
// leave the phone. Writes go only through wh_save_issue / wh_delete_issue. Polish: the warehouse is in Orpiszew.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert, AppState, Modal } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import TimeScreen from './TimeScreen';
import { zRef, parseQty, formProblem, scanned, jobChoices, qtyLabel, forJob, type WhIssue, type WhItem, type WhForm } from '../lib/whLogic';
import { useKeyboardPad } from '../lib/useKeyboardPad';

export default function WarehouseScreen() {
  const [tab, setTab] = useState<'issue' | 'return' | 'time'>('issue');
  return (
    <View style={s.fill}>
      <View style={[s.tabs, { marginHorizontal: 12, marginTop: 10 }]}>
        {([['issue', 'Wydania'], ['return', 'Zwroty'], ['time', 'Czas pracy']] as const).map(([k, l]) => (
          <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)} activeOpacity={0.8}><Text style={[s.tabT, tab === k && s.tabTOn]}>{l}</Text></TouchableOpacity>
        ))}
      </View>
      {tab === 'time' ? <TimeScreen /> : <Issues key={tab} kind={tab} />}
    </View>
  );
}

const EMPTY: WhForm = { job: '', symbol: '', qty: '', location: '', box: '', note: '' };

function Issues({ kind }: { kind: 'issue' | 'return' }) {
  const ret = kind === 'return';
  const [mine, setMine] = useState<WhIssue[]>([]);
  const [jobs, setJobs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<WhForm>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [item, setItem] = useState<WhItem | null>(null);        // the item matching the symbol exactly
  const [hints, setHints] = useState<WhItem[]>([]);              // suggestions while typing the symbol
  const [scan, setScan] = useState<null | 'symbol' | 'location'>(null);
  const [bal, setBal] = useState<{ issued: number; returned: number; unit: string | null } | null>(null);   // returns: what went out to this Z
  const qtyRef = useRef<TextInput>(null);
  const [showAll, setShowAll] = useState(false);   // the list follows the typed Z unless "pokaż wszystkie"
  useEffect(() => { setShowAll(false); }, [form.job]);
  const kb = useKeyboardPad();
  const set = (k: keyof WhForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    try {
      const [i, j] = await Promise.all([
        supabase.from('wh_issues').select('id,kind,job_ref,symbol,name,unit,qty,location,box,note,created_at').is('exported_at', null).order('created_at', { ascending: false }),
        supabase.rpc('wh_jobs'),
      ]);
      if (i.error) throw i.error;
      setMine(((i.data as any[]) ?? []).filter((r) => (r.kind ?? 'issue') === kind).map((r) => ({ ...r, qty: Number(r.qty) })));
      if (!j.error) setJobs(((j.data as any[]) ?? []).map((r) => r.job_ref));
    } catch { Alert.alert('Brak połączenia', 'Nie udało się wczytać wydań. Sprawdź internet i przeciągnij w dół, aby odświeżyć.'); }
    setLoading(false);
  }, [kind]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); }); return () => sub.remove(); }, [load]);

  // Look the symbol up in the Subiekt stock list (a short pause after typing).
  useEffect(() => {
    const q = form.symbol.trim();
    if (q.length < 2) { setHints([]); setItem(null); return; }
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('wh_items', { p_query: q });
      if (error) return;
      const rows = ((data as any[]) ?? []).map((r) => ({ ...r, stock: r.stock == null ? null : Number(r.stock) })) as WhItem[];
      const exact = rows.find((r) => r.symbol.toUpperCase() === q.toUpperCase()) ?? null;
      setItem(exact); setHints(exact ? [] : rows.slice(0, 6));
    }, 300);
    return () => clearTimeout(t);
  }, [form.symbol]);

  // A return: how much of this symbol the app recorded as issued to (and already returned from) this Z.
  useEffect(() => {
    if (!ret) return;
    const job = zRef(form.job), sym = form.symbol.trim();
    if (!job || sym.length < 2) { setBal(null); return; }
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('wh_balance', { p_job: job, p_symbol: sym });
      const r = !error && Array.isArray(data) ? data[0] : null;
      setBal(r ? { issued: Number(r.issued) || 0, returned: Number(r.returned) || 0, unit: r.unit ?? null } : null);
    }, 300);
    return () => clearTimeout(t);
  }, [ret, form.job, form.symbol]);
  const over = (() => {   // more coming back than went out (the row being edited does not count against itself)
    if (!ret || !bal) return null;
    const q = parseQty(form.qty); if (q === null) return null;
    const self = editing ? mine.find((m) => m.id === editing)?.qty ?? 0 : 0;
    const left = Math.round((bal.issued - bal.returned + self) * 1000) / 1000;
    return q > left ? left : null;
  })();

  const save = async () => {
    const problem = formProblem(form); if (problem) { Alert.alert('Brakuje danych', problem); return; }
    if (over !== null) {
      const goOn = await new Promise<boolean>((res) => Alert.alert('Więcej niż wydano', `${zRef(form.job)}: wydano ${qtyLabel(bal?.issued ?? 0, bal?.unit ?? item?.unit ?? null)}, już zwrócono ${qtyLabel(bal?.returned ?? 0, bal?.unit ?? item?.unit ?? null)} — a zwracasz ${qtyLabel(parseQty(form.qty) ?? 0, bal?.unit ?? item?.unit ?? null)}. Zapisać mimo to?`, [{ text: 'Popraw', style: 'cancel', onPress: () => res(false) }, { text: 'Zapisz', onPress: () => res(true) }]));
      if (!goOn) return;
    }
    if (busy) return; setBusy(true);
    const { error } = await supabase.rpc('wh_save_issue', { p_id: editing, p_job: zRef(form.job), p_symbol: form.symbol.trim(), p_qty: parseQty(form.qty),
      p_location: form.location.trim(), p_box: form.box.trim(), p_note: form.note.trim(), p_kind: kind });
    setBusy(false);
    if (error) { Alert.alert('Nie udało się', plError(error)); return; }
    // The next issue is usually for the same order and shelf: keep the Z and the location.
    setForm((f) => ({ ...EMPTY, job: zRef(f.job), location: f.location })); setEditing(null); setItem(null);
    load();
  };
  const startEdit = (r: WhIssue) => {
    setEditing(r.id);
    setForm({ job: r.job_ref, symbol: r.symbol, qty: String(r.qty).replace('.', ','), location: r.location ?? '', box: r.box ?? '', note: r.note ?? '' });
  };
  const remove = (r: WhIssue) => Alert.alert(ret ? 'Usunąć zwrot?' : 'Usunąć wydanie?', `${r.job_ref} · ${r.symbol} · ${qtyLabel(r.qty, r.unit)}`, [
    { text: 'Anuluj', style: 'cancel' },
    { text: 'Usuń', style: 'destructive', onPress: async () => {
      const { error } = await supabase.rpc('wh_delete_issue', { p_id: r.id });
      if (error) { Alert.alert('Nie udało się', plError(error)); return; }
      if (editing === r.id) { setEditing(null); setForm(EMPTY); }
      load();
    } },
  ]);
  const step = (d: number) => { const n = parseQty(form.qty) ?? 0; const x = Math.max(0, Math.round((n + d) * 1000) / 1000); set('qty', x ? String(x).replace('.', ',') : ''); };

  if (loading) return <View style={[s.fill, s.center]}><ActivityIndicator color={C.magenta} /></View>;
  const chips = jobChoices(mine, jobs, form.job);
  const fj = forJob(mine, form.job), list = showAll || !fj.job ? mine : fj.rows;
  return (
    <>
      <ScrollView style={s.fill} contentContainerStyle={{ padding: 12, paddingBottom: 40 + kb }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <View style={s.card}>
          <Text style={s.title}>{editing ? (ret ? 'Zmień zwrot' : 'Zmień wydanie') : (ret ? 'Nowy zwrot z produkcji' : 'Nowe wydanie')}</Text>

          <Text style={s.label}>ZLECENIE</Text>
          <TextInput style={s.input} value={form.job} onChangeText={(v) => set('job', v)} placeholder="np. Z.437" placeholderTextColor={C.muted} autoCapitalize="characters" autoCorrect={false} onBlur={() => set('job', zRef(form.job))} />
          {chips.length > 0 && (
            <View style={s.chips}>
              {chips.map((j) => <TouchableOpacity key={j} style={[s.chip, zRef(form.job) === j && s.chipOn]} onPress={() => set('job', j)}><Text style={[s.chipT, zRef(form.job) === j && s.chipTOn]}>{j}</Text></TouchableOpacity>)}
            </View>
          )}

          <Text style={s.label}>SYMBOL TOWARU</Text>
          <View style={s.row}>
            <TextInput style={[s.input, { flex: 1 }]} value={form.symbol} onChangeText={(v) => set('symbol', v)} placeholder="zeskanuj lub wpisz" placeholderTextColor={C.muted} autoCapitalize="characters" autoCorrect={false} />
            <TouchableOpacity style={s.scanBtn} onPress={() => setScan('symbol')}><Text style={s.scanT}>Skanuj</Text></TouchableOpacity>
          </View>
          {item ? <Text style={s.found}>{item.name ?? item.symbol}{item.unit ? ` · ${item.unit}` : ''}{item.stock != null ? ` · w magazynie: ${qtyLabel(item.stock, item.unit)}` : ''}</Text>
            : form.symbol.trim().length >= 2 && hints.length === 0 ? <Text style={s.warn}>Nie ma tego symbolu na liście stanów Subiekta — sprawdź, czy jest poprawny.</Text> : null}
          {hints.map((h) => (
            <TouchableOpacity key={h.symbol} style={s.hint} onPress={() => { set('symbol', h.symbol); setTimeout(() => qtyRef.current?.focus(), 50); }}>
              <Text style={s.hintS}>{h.symbol}</Text><Text style={s.hintN} numberOfLines={1}>{h.name ?? ''}{h.stock != null ? ` · ${qtyLabel(h.stock, h.unit)}` : ''}</Text>
            </TouchableOpacity>
          ))}

          {ret && bal && (bal.issued > 0 || bal.returned > 0) && <Text style={s.found}>Wydano na {zRef(form.job)}: {qtyLabel(bal.issued, bal.unit)}{bal.returned ? ` · już zwrócono: ${qtyLabel(bal.returned, bal.unit)}` : ''}</Text>}
          {ret && bal && bal.issued === 0 && bal.returned === 0 && form.symbol.trim().length >= 2 && <Text style={s.warn}>Aplikacja nie ma wydania tego towaru na {zRef(form.job)}.</Text>}
          <Text style={s.label}>ILOŚĆ{item?.unit ? ` (${item.unit})` : ''}</Text>
          <View style={s.row}>
            <TouchableOpacity style={s.step} onPress={() => step(-1)}><Text style={s.stepT}>−</Text></TouchableOpacity>
            <TextInput ref={qtyRef} style={[s.input, s.qty]} value={form.qty} onChangeText={(v) => set('qty', v)} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.muted} />
            <TouchableOpacity style={s.step} onPress={() => step(1)}><Text style={s.stepT}>+</Text></TouchableOpacity>
          </View>

          {over !== null && <Text style={s.warn}>Zwracasz więcej, niż wydano na to zlecenie (zostało {qtyLabel(Math.max(0, over), bal?.unit ?? null)}).</Text>}
          <Text style={s.label}>{ret ? 'LOKALIZACJA (GDZIE ODKŁADASZ)' : 'LOKALIZACJA'}</Text>
          <View style={s.row}>
            <TextInput style={[s.input, { flex: 1 }]} value={form.location} onChangeText={(v) => set('location', v)} placeholder="np. A-01" placeholderTextColor={C.muted} autoCapitalize="characters" autoCorrect={false} />
            <TouchableOpacity style={s.scanBtn} onPress={() => setScan('location')}><Text style={s.scanT}>Skanuj</Text></TouchableOpacity>
          </View>

          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>BOX</Text>
              <TextInput style={s.input} value={form.box} onChangeText={(v) => set('box', v)} placeholderTextColor={C.muted} autoCorrect={false} />
            </View>
          </View>
          <Text style={s.label}>UWAGI</Text>
          <TextInput style={[s.input, { minHeight: 44 }]} value={form.note} onChangeText={(v) => set('note', v)} maxLength={300} multiline placeholderTextColor={C.muted} />

          <View style={[s.row, { marginTop: 14 }]}>
            {editing && <TouchableOpacity style={[s.btn, { backgroundColor: C.soft }]} onPress={() => { setEditing(null); setForm(EMPTY); }}><Text style={[s.btnT, { color: C.ink }]}>Anuluj</Text></TouchableOpacity>}
            <TouchableOpacity style={[s.btn, busy && { opacity: 0.5 }]} onPress={save} disabled={busy}><Text style={s.btnT}>{busy ? '…' : editing ? 'Zapisz zmiany' : ret ? 'Zapisz zwrot' : 'Zapisz wydanie'}</Text></TouchableOpacity>
          </View>
        </View>

        <Text style={s.section}>{ret ? 'Moje zwroty do eksportu' : 'Moje wydania do eksportu'}{fj.job && !showAll ? ` — ${fj.job}` : ''} ({fj.job && !showAll ? `${list.length} z ${mine.length}` : mine.length})</Text>
        {fj.job && mine.length > 0 && (
          <TouchableOpacity onPress={() => setShowAll((v) => !v)} style={{ paddingVertical: 4 }}><Text style={s.link}>{showAll ? `Pokaż tylko ${fj.job}` : 'Pokaż wszystkie zlecenia'}</Text></TouchableOpacity>
        )}
        {fj.job && !showAll && list.length === 0 && mine.length > 0 && <Text style={[s.muted, { textAlign: 'center', marginTop: 8 }]}>{ret ? `Brak zwrotów na ${fj.job}.` : `Brak wydań na ${fj.job}.`}</Text>}
        {mine.length === 0 && <Text style={[s.muted, { textAlign: 'center', marginTop: 8 }]}>{ret ? 'Brak — zapisane zwroty pojawią się tutaj, dopóki biuro ich nie wyeksportuje.' : 'Brak — zapisane wydania pojawią się tutaj, dopóki biuro ich nie wyeksportuje.'}</Text>}
        {list.map((r) => (
          <View key={r.id} style={[s.entry, editing === r.id && { backgroundColor: C.soft }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.entryT} numberOfLines={1}><Text style={{ fontWeight: '800' }}>{r.job_ref}</Text> · {r.symbol} · {qtyLabel(r.qty, r.unit)}</Text>
              <Text style={s.muted} numberOfLines={1}>{r.name ?? 'brak na liście stanów'}{r.location ? ` · ${r.location}` : ''}{r.box ? ` · box ${r.box}` : ''}</Text>
              {!!r.note && <Text style={s.note} numberOfLines={2}>„{r.note}”</Text>}
            </View>
            <View style={{ flexDirection: 'row', gap: 6, paddingLeft: 8 }}>
              <TouchableOpacity style={s.eBtn} onPress={() => startEdit(r)}><Text style={s.eBtnT}>Zmień</Text></TouchableOpacity>
              <TouchableOpacity style={[s.eBtn, { borderColor: C.magenta }]} onPress={() => remove(r)}><Text style={[s.eBtnT, { color: C.magenta }]}>Usuń</Text></TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
      {scan && <Scanner field={scan} onClose={() => setScan(null)} onCode={(code) => {
        const v = scanned(code, scan); set(scan, v); setScan(null);
        if (scan === 'symbol') setTimeout(() => qtyRef.current?.focus(), 300);
      }} />}
    </>
  );
}

/** Full-screen camera that reads one QR / bar code and closes. */
function Scanner({ field, onClose, onCode }: { field: 'symbol' | 'location'; onClose: () => void; onCode: (code: string) => void }) {
  const [perm, requestPerm] = useCameraPermissions();
  const done = useRef(false);
  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) requestPerm(); }, [perm, requestPerm]);
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={[s.fill, { backgroundColor: '#000' }]}>
        {perm?.granted ? (
          <CameraView style={s.fill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8', 'datamatrix'] }}
            onBarcodeScanned={(r) => { if (done.current || !r?.data) return; done.current = true; onCode(r.data); }} />
        ) : (
          <View style={[s.fill, s.center, { padding: 24 }]}>
            <Text style={{ color: '#fff', textAlign: 'center', fontSize: 16 }}>{perm && !perm.canAskAgain ? 'Brak dostępu do aparatu. Włącz go w ustawieniach telefonu dla FitAWindow.' : 'Potrzebny jest dostęp do aparatu, aby skanować kody.'}</Text>
          </View>
        )}
        <View style={s.scanBar}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{field === 'symbol' ? 'Skanuj kod towaru' : 'Skanuj kod lokalizacji'}</Text>
          <TouchableOpacity style={[s.btn, { flex: 0, paddingHorizontal: 22, backgroundColor: C.magenta }]} onPress={onClose}><Text style={s.btnT}>Zamknij</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/** The server's messages are in English; the warehouse reads Polish. */
function plError(err: any): string {
  const m = String(err?.message ?? err).replace(/^.*?: /, '');
  const map: Record<string, string> = {
    'Enter the Z order.': 'Podaj zlecenie Z.', 'Enter or scan the item symbol.': 'Zeskanuj lub wpisz symbol towaru.', 'Enter the quantity.': 'Podaj ilość.',
    'A field is too long.': 'Któreś pole jest za długie.', 'Issue not found.': 'Nie znaleziono wydania.',
    'Already exported — ask the office to change it.': 'To wydanie jest już wyeksportowane — zmiany robi biuro.', 'Not allowed.': 'Brak uprawnień.',
  };
  return map[m] ?? m;
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: C.soft, borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabOn: { backgroundColor: C.white, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabT: { fontSize: 15, fontWeight: '700', color: C.muted },
  tabTOn: { color: C.purple, fontWeight: '800' },
  card: { backgroundColor: C.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line },
  title: { fontSize: 17, fontWeight: '800', color: C.ink, marginBottom: 2 },
  label: { fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 1, marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink, backgroundColor: C.white },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: C.white },
  chipOn: { borderColor: C.purple, backgroundColor: C.purple },
  chipT: { color: C.ink, fontWeight: '700' },
  chipTOn: { color: C.white },
  scanBtn: { backgroundColor: C.purple, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  scanT: { color: C.white, fontWeight: '800', fontSize: 15 },
  found: { color: '#15803d', fontWeight: '700', marginTop: 6 },
  warn: { color: '#b45309', marginTop: 6 },
  hint: { flexDirection: 'row', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.soft },
  hintS: { fontWeight: '800', color: C.purple },
  hintN: { flex: 1, color: C.ink },
  step: { backgroundColor: C.soft, borderRadius: 10, width: 52, paddingVertical: 10, alignItems: 'center' },
  stepT: { fontSize: 22, fontWeight: '800', color: C.purple },
  qty: { flex: 1, textAlign: 'center', fontSize: 22, fontWeight: '800' },
  btn: { flex: 1, backgroundColor: C.purple, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnT: { color: C.white, fontSize: 16, fontWeight: '800' },
  section: { fontSize: 15, fontWeight: '800', color: C.purple, marginTop: 18, marginBottom: 4 },
  link: { color: C.purple, fontWeight: '700', textDecorationLine: 'underline' },
  muted: { fontSize: 12, color: C.muted, marginTop: 2 },
  entry: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.line },
  entryT: { fontSize: 14, color: C.ink },
  note: { fontSize: 12, color: C.ink, fontStyle: 'italic', marginTop: 2 },
  eBtn: { borderWidth: 1, borderColor: C.purple, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 11 },
  eBtnT: { color: C.purple, fontWeight: '800', fontSize: 13 },
  scanBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingBottom: 40, backgroundColor: 'rgba(0,0,0,0.6)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
