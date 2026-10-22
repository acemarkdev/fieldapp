// ACE Scaffolding crews (role "scaffolder"; also the scaffolding office and admin): the day's visits of my crews
// (or all crews), and the 7-day inspections due. A visit opens the job: the site (tap for maps), the contact (tap to
// call), the scaffolds and their status, and what to do there —
//   · Done (a dismantle reports the day the hire stops — the dismantle day the team confirms),
//   · Handover: tick the scaffolds, the client signs with a finger → the hire starts, the certificate is made,
//   · Delivery / collection note: quantities per item (a collection can fill in everything on site),
//   · Inspect: safe or not, defects, what was done, photos.
// Everything goes to the office server (/api/scaf/crew/…), which applies the same rules as the office.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert, Linking, Platform, PanResponder } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { officeUrl, isoDay, addDays, dayLabel, signaturePath, segments, canHandOver, mapsUrl, VISIT_LABEL, SCAFFOLD_LABEL, type Pt } from '../lib/crewLogic';

const BASE = officeUrl(process.env.EXPO_PUBLIC_OFFICE_URL, process.env.EXPO_PUBLIC_SUPABASE_URL);
async function call(path: string, method = 'GET', body?: unknown): Promise<any> {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + (data?.session?.access_token ?? ''), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let d: any = {}; try { d = await r.json(); } catch { /* empty */ }
  if (!r.ok || d.ok === false) throw new Error(d.error || 'The office server did not answer (' + r.status + ').');
  return d;
}
const today = () => isoDay(new Date());
const VC: Record<string, string> = { erect: C.purple, adapt: '#7e3b8a', inspect: '#0f766e', dismantle: '#b42318', deliver: C.amber, collect: C.muted };

type View_ = { k: 'list' } | { k: 'visit'; v: any } | { k: 'done'; v: any } | { k: 'handover'; v: any } | { k: 'note'; v: any; kind: 'delivery' | 'collection' } | { k: 'inspect'; job: any; scaffolds: any[]; pre?: string[] };

export default function CrewScreen() {
  const [tab, setTab] = useState<'day' | 'insp'>('day');
  const [view, setView] = useState<View_>({ k: 'list' });
  const [reload, setReload] = useState(0);
  const back = (refresh = true) => { setView({ k: 'list' }); if (refresh) setReload((x) => x + 1); };
  if (view.k === 'visit') return <Visit v={view.v} go={setView} back={back} />;
  if (view.k === 'done') return <Done v={view.v} back={back} />;
  if (view.k === 'handover') return <Handover v={view.v} back={back} />;
  if (view.k === 'note') return <Note v={view.v} kind={view.kind} back={back} />;
  if (view.k === 'inspect') return <Inspect job={view.job} scaffolds={view.scaffolds} pre={view.pre} back={back} />;
  return (
    <View style={s.fill}>
      <View style={[s.tabs, { marginHorizontal: 12, marginTop: 10 }]}>
        {([['day', 'My day'], ['insp', 'Inspections due']] as const).map(([k, l]) => (
          <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)} activeOpacity={0.8}><Text style={[s.tabT, tab === k && s.tabTOn]}>{l}</Text></TouchableOpacity>
        ))}
      </View>
      {tab === 'day' ? <Day key={reload} go={setView} /> : <Due key={reload} go={setView} />}
    </View>
  );
}

function Day({ go }: { go: (v: View_) => void }) {
  const [d, setD] = useState(today());
  const [all, setAll] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setData(await call('/api/scaf/crew/day?day=' + d + (all ? '&all=1' : ''))); } catch (e: any) { setData({ error: e.message }); } setLoading(false); }, [d, all]);
  useEffect(() => { load(); }, [load]);
  return (
    <ScrollView style={s.fill} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <TouchableOpacity style={s.navBtn} onPress={() => setD(addDays(d, -1))}><Text style={s.navT}>‹</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setD(today())}><Text style={s.dayT}>{dayLabel(d, today())}</Text></TouchableOpacity>
        <TouchableOpacity style={s.navBtn} onPress={() => setD(addDays(d, 1))}><Text style={s.navT}>›</Text></TouchableOpacity>
      </View>
      {data?.canAll ? (
        <View style={[s.chips, { justifyContent: 'center' }]}>
          {[[false, 'My crews'], [true, 'All crews']].map(([v, l]) => (
            <TouchableOpacity key={String(v)} style={[s.chip, all === v && s.chipOn]} onPress={() => setAll(v as boolean)}><Text style={[s.chipT, all === v && s.chipTOn]}>{l as string}</Text></TouchableOpacity>
          ))}
        </View>
      ) : null}
      {data?.error ? <Text style={s.warn}>{data.error}</Text> : null}
      {data && !data.error && !all && !data.crews?.length ? <Text style={s.muted}>You are not in a crew yet — the office adds you (Planner ▸ Crews).</Text> : null}
      {data && !data.error && data.crews?.length && !all ? <Text style={[s.muted, { textAlign: 'center' }]}>{data.crews.map((c: any) => c.name).join(', ')}</Text> : null}
      {data?.visits?.length === 0 && !loading ? <Text style={[s.muted, { textAlign: 'center', marginTop: 20 }]}>Nothing planned.</Text> : null}
      {(data?.visits ?? []).map((v: any) => (
        <TouchableOpacity key={v.id} style={[s.card, { marginTop: 10, borderLeftWidth: 5, borderLeftColor: VC[v.kind] ?? C.purple, opacity: v.status === 'done' ? 0.6 : 1 }]} onPress={() => go({ k: 'visit', v })} activeOpacity={0.85}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={[s.kind, { color: VC[v.kind] ?? C.purple }]}>{VISIT_LABEL[v.kind] ?? v.kind}{v.days > 1 ? ` · ${v.days} days` : ''}</Text>
            <Text style={s.muted}>{v.status === 'done' ? 'Done' : v.crew ?? ''}</Text>
          </View>
          <Text style={s.title}>ACESC{v.job.number} · {v.job.title}</Text>
          {v.job.site ? <Text style={s.entryT}>{v.job.site.address}</Text> : null}
          {v.job.customer ? <Text style={s.muted}>{v.job.customer.name}</Text> : null}
          {v.notes ? <Text style={s.note}>{v.notes}</Text> : null}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function Due({ go }: { go: (v: View_) => void }) {
  const [due, setDue] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setDue((await call('/api/scaf/crew/inspections-due')).due); setErr(''); } catch (e: any) { setErr(e.message); } setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const byJob = new Map<string, any[]>(); for (const x of due ?? []) (byJob.get(x.job.id) ?? byJob.set(x.job.id, []).get(x.job.id)!).push(x);
  return (
    <ScrollView style={s.fill} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={s.muted}>Scaffolds in use need an inspection before first use and at least every 7 days (Work at Height Regulations 2005). Due today or tomorrow, overdue first.</Text>
      {err ? <Text style={s.warn}>{err}</Text> : null}
      {due?.length === 0 ? <Text style={[s.muted, { textAlign: 'center', marginTop: 20 }]}>Nothing due.</Text> : null}
      {[...byJob.values()].map((list) => { const j = list[0].job; return (
        <TouchableOpacity key={j.id} style={[s.card, { marginTop: 10 }]} activeOpacity={0.85} onPress={() => go({ k: 'inspect', job: j, scaffolds: list, pre: list.map((x) => x.id) })}>
          <Text style={s.title}>ACESC{j.number} · {j.title}</Text>
          {j.site ? <Text style={s.entryT}>{j.site.address}</Text> : null}
          {list.map((x) => <Text key={x.id} style={[s.muted, x.overdue > 0 && { color: '#b42318', fontWeight: '700' }]}>{x.element ?? 'Scaffold'}{x.tag ? ' · ' + x.tag : ''} — {x.overdue > 0 ? `${x.overdue} day(s) overdue` : x.overdue === 0 ? 'due today' : 'due tomorrow'}{x.last ? ` (last ${x.last.slice(8, 10)}/${x.last.slice(5, 7)})` : ' (never)'}</Text>)}
        </TouchableOpacity>); })}
    </ScrollView>
  );
}

function Header({ title, back }: { title: string; back: () => void }) {
  return (<View style={[s.row, { padding: 12, paddingBottom: 4 }]}><TouchableOpacity onPress={back}><Text style={s.back}>‹ Back</Text></TouchableOpacity><Text style={[s.title, { flex: 1, marginLeft: 10 }]} numberOfLines={1}>{title}</Text></View>);
}

function Visit({ v, go, back }: { v: any; go: (x: View_) => void; back: (r?: boolean) => void }) {
  const j = v.job, sc: any[] = j.scaffolds ?? [], inVisit = new Set<string>(v.scaffold_ids ?? []);
  const addr = j.site ? [j.site.address, j.site.postcode && !String(j.site.address).includes(j.site.postcode) ? j.site.postcode : ''].filter(Boolean).join(', ') : '';
  const contact = j.contact ?? (j.customer?.phone ? { name: j.customer.name, phone: j.customer.phone } : null);
  return (
    <View style={s.fill}>
      <Header title={`${VISIT_LABEL[v.kind] ?? v.kind} · ACESC${j.number}`} back={() => back(false)} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
        <View style={s.card}>
          <Text style={s.title}>{j.title}</Text>
          {j.customer ? <Text style={s.muted}>{j.customer.name}</Text> : null}
          {addr ? <TouchableOpacity onPress={() => Linking.openURL(mapsUrl(addr, Platform.OS === 'ios'))}><Text style={s.link}>{addr}</Text></TouchableOpacity> : null}
          {j.site?.access_notes ? <Text style={s.note}>Access: {j.site.access_notes}</Text> : null}
          {contact?.phone ? <TouchableOpacity onPress={() => Linking.openURL('tel:' + String(contact.phone).replace(/\s+/g, ''))}><Text style={s.link}>{contact.name} · {contact.phone}</Text></TouchableOpacity> : null}
          {v.notes ? <Text style={s.note}>{v.notes}</Text> : null}
          {j.notes ? <Text style={s.note}>{j.notes}</Text> : null}
        </View>
        <Text style={s.section}>Scaffolds</Text>
        {sc.map((x) => (
          <View key={x.id} style={[s.entry, inVisit.has(x.id) && { backgroundColor: C.soft }]}>
            <View style={{ flex: 1 }}><Text style={s.entryT}>{x.element ?? 'Scaffold'}{x.tag ? ' · ' + x.tag : ''}</Text>{x.description ? <Text style={s.muted}>{x.description}</Text> : null}</View>
            <Text style={s.muted}>{SCAFFOLD_LABEL[x.status] ?? x.status}</Text>
          </View>
        ))}
        {!sc.length ? <Text style={s.muted}>No scaffolds on this job in the office app.</Text> : null}
        <View style={{ gap: 10, marginTop: 18 }}>
          {v.status !== 'done' ? <TouchableOpacity style={s.btn} onPress={() => go({ k: 'done', v })}><Text style={s.btnT}>{v.kind === 'dismantle' ? 'Dismantled — done' : 'Done'}</Text></TouchableOpacity> : <Text style={[s.found, { textAlign: 'center' }]}>This visit is done.</Text>}
          {sc.some((x) => canHandOver(x.status)) ? <TouchableOpacity style={[s.btn, { backgroundColor: C.green }]} onPress={() => go({ k: 'handover', v })}><Text style={s.btnT}>Handover — client signs</Text></TouchableOpacity> : null}
          <View style={s.row}>
            <TouchableOpacity style={[s.btn, s.btnLine]} onPress={() => go({ k: 'note', v, kind: 'delivery' })}><Text style={[s.btnT, { color: C.purple }]}>Delivery note</Text></TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnLine]} onPress={() => go({ k: 'note', v, kind: 'collection' })}><Text style={[s.btnT, { color: C.purple }]}>Collection note</Text></TouchableOpacity>
          </View>
          {sc.some((x) => ['on_hire', 'dismantle_requested', 'dismantling'].includes(x.status)) ? <TouchableOpacity style={[s.btn, s.btnLine]} onPress={() => go({ k: 'inspect', job: j, scaffolds: sc.filter((x) => ['on_hire', 'dismantle_requested', 'dismantling'].includes(x.status)) })}><Text style={[s.btnT, { color: C.purple }]}>Inspection</Text></TouchableOpacity> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Done({ v, back }: { v: any; back: (r?: boolean) => void }) {
  const [notes, setNotes] = useState('');
  const [stop, setStop] = useState(today());
  const [busy, setBusy] = useState(false);
  const dism = v.kind === 'dismantle';
  async function save() {
    if (dism && !/^\d{4}-\d{2}-\d{2}$/.test(stop)) { Alert.alert('The day the hire stops', 'As YYYY-MM-DD.'); return; }
    setBusy(true);
    try { await call('/api/scaf/crew/visits/' + v.id + '/done', 'POST', { notes, hire_stop_on: dism ? stop : undefined }); back(); }
    catch (e: any) { Alert.alert('Not saved', e.message); }
    setBusy(false);
  }
  return (
    <View style={s.fill}>
      <Header title={`${VISIT_LABEL[v.kind] ?? v.kind} done · ACESC${v.job.number}`} back={() => back(false)} />
      <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
        {dism ? (<>
          <Text style={s.label}>HIRE STOPS ON (THE DISMANTLE DAY WE CONFIRM)</Text>
          <View style={s.chips}>{[0, -1, -2].map((n) => { const d = addDays(today(), n); return (<TouchableOpacity key={d} style={[s.chip, stop === d && s.chipOn]} onPress={() => setStop(d)}><Text style={[s.chipT, stop === d && s.chipTOn]}>{dayLabel(d, today())}</Text></TouchableOpacity>); })}</View>
          <TextInput style={[s.input, { marginTop: 8 }]} value={stop} onChangeText={setStop} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          <Text style={s.muted}>If we were late, put the day it was planned for; if the customer delayed it, the day we could start.</Text>
        </>) : null}
        <Text style={s.label}>NOTES</Text>
        <TextInput style={[s.input, { minHeight: 80 }]} value={notes} onChangeText={setNotes} multiline placeholder="Anything the office should know" />
        <TouchableOpacity style={[s.btn, { marginTop: 18 }]} onPress={save} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Save — done</Text>}</TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function SignaturePad({ onChange, onDrawing }: { onChange: (sig: string | null) => void; onDrawing: (on: boolean) => void }) {
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const size = useRef({ w: 300, h: 160 });
  const cur = useRef<Pt[]>([]);
  const all = useRef<Pt[][]>([]);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onStartShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { onDrawing(true); cur.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }]; all.current = [...all.current, cur.current]; setStrokes([...all.current]); },
    onPanResponderMove: (e) => { cur.current.push({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }); setStrokes([...all.current]); },
    onPanResponderRelease: () => { onDrawing(false); onChange(signaturePath(all.current, size.current.w, size.current.h)); },
  })).current;
  return (
    <View>
      <View style={s.sig} {...pan.panHandlers} onLayout={(e) => { size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}>
        {strokes.flatMap((st, i) => segments(st).map((g, k) => (
          <View key={i + '-' + k} pointerEvents="none" style={{ position: 'absolute', left: g.cx - g.len / 2, top: g.cy - 1.4, width: g.len, height: 2.8, borderRadius: 1.4, backgroundColor: C.ink, transform: [{ rotate: g.deg + 'deg' }] }} />
        )))}
        {!strokes.length ? <Text style={[s.muted, { position: 'absolute', alignSelf: 'center', top: 70 }]} pointerEvents="none">Sign here with a finger</Text> : null}
      </View>
      <TouchableOpacity onPress={() => { all.current = []; setStrokes([]); onChange(null); }}><Text style={[s.link, { marginTop: 6 }]}>Clear</Text></TouchableOpacity>
    </View>
  );
}

function Handover({ v, back }: { v: any; back: (r?: boolean) => void }) {
  const cands = (v.job.scaffolds ?? []).filter((x: any) => canHandOver(x.status));
  const [ticked, setTicked] = useState<string[]>(cands.filter((x: any) => (v.scaffold_ids ?? []).includes(x.id) || x.status === 'erecting').map((x: any) => x.id));
  const [client, setClient] = useState(v.job.contact?.name ?? '');
  const [ace, setAce] = useState('');
  const [load, setLoad] = useState('');
  const [notes, setNotes] = useState('');
  const [sig, setSig] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!ticked.length) { Alert.alert('Handover', 'Tick the scaffolds handed over.'); return; }
    if (!client.trim()) { Alert.alert('Handover', 'Who received it for the client?'); return; }
    if (!sig) { Alert.alert('Handover', 'The client signs in the box.'); return; }
    setBusy(true);
    try { await call('/api/scaf/crew/jobs/' + v.job.id + '/handover', 'POST', { day: today(), scaffold_ids: ticked, client_name: client, ace_person: ace, max_load: load, notes, signature: sig }); Alert.alert('Handed over', 'The hire starts today. The certificate is in the office app.'); back(); }
    catch (e: any) { Alert.alert('Not saved', e.message); }
    setBusy(false);
  }
  return (
    <View style={s.fill}>
      <Header title={`Handover · ACESC${v.job.number}`} back={() => back(false)} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" scrollEnabled={!drawing}>
        <Text style={s.label}>SCAFFOLDS HANDED OVER</Text>
        {cands.map((x: any) => { const on = ticked.includes(x.id); return (
          <TouchableOpacity key={x.id} style={[s.entry, on && { backgroundColor: C.greenSoft }]} onPress={() => setTicked(on ? ticked.filter((i) => i !== x.id) : [...ticked, x.id])}>
            <Text style={[s.check, on && { color: C.green }]}>{on ? '☑' : '☐'}</Text><Text style={[s.entryT, { flex: 1 }]}>{x.element ?? 'Scaffold'}{x.tag ? ' · ' + x.tag : ''}</Text>
          </TouchableOpacity>); })}
        <Text style={s.label}>RECEIVED FOR THE CLIENT BY</Text><TextInput style={s.input} value={client} onChangeText={setClient} />
        <Text style={s.label}>HANDED OVER BY (ACE)</Text><TextInput style={s.input} value={ace} onChangeText={setAce} />
        <Text style={s.label}>DUTY / LOADING</Text><TextInput style={s.input} value={load} onChangeText={setLoad} placeholder="e.g. General purpose, 2.0 kN/m²" />
        <Text style={s.label}>NOTES</Text><TextInput style={s.input} value={notes} onChangeText={setNotes} />
        <Text style={s.label}>CLIENT SIGNATURE</Text>
        <SignaturePad onChange={setSig} onDrawing={setDrawing} />
        <Text style={s.muted}>The scaffolding is handed over complete and safe to use; it is inspected at least every 7 days; it must not be altered by anyone but ACE Scaffolding; the hire starts today.</Text>
        <TouchableOpacity style={[s.btn, { marginTop: 18, backgroundColor: C.green }]} onPress={save} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Save handover</Text>}</TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Note({ v, kind, back }: { v: any; kind: 'delivery' | 'collection'; back: (r?: boolean) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [locs, setLocs] = useState<any[]>([]);
  const [loc, setLoc] = useState<string>('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [onSite, setOnSite] = useState<Record<string, number>>({});
  const [signed, setSigned] = useState('');
  const [driver, setDriver] = useState('');
  const [final, setFinal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => {
    try {
      const d = await call('/api/scaf/crew/items'); setItems(d.items); setLocs(d.locations); setLoc((d.locations.find((l: any) => l.kind === 'van') ?? d.locations[0])?.id ?? '');
      if (kind === 'collection') { const st = await call('/api/scaf/crew/jobs/' + v.job.id + '/stock'); const m: Record<string, number> = {}; for (const x of st.onSite) m[x.item_id] = x.qty; setOnSite(m); }
    } catch (e: any) { Alert.alert('No connection', e.message); }
    setLoading(false);
  })(); }, [kind, v.job.id]);
  async function save() {
    const lines = Object.entries(qty).map(([item_id, q]) => ({ item_id, qty: Number(String(q).replace(',', '.')) })).filter((l) => l.qty > 0);
    if (!lines.length) { Alert.alert('Note', 'Enter the quantities.'); return; }
    if (!loc) { Alert.alert('Note', kind === 'delivery' ? 'Which van or yard did it come from?' : 'Which van or yard does it go to?'); return; }
    setBusy(true);
    try { const r = await call('/api/scaf/crew/notes', 'POST', { kind, day: today(), job_id: v.job.id, from_loc: kind === 'delivery' ? loc : null, to_loc: kind === 'collection' ? loc : null, final, signed_by: signed, driver, vehicle: locs.find((l) => l.id === loc)?.name, lines }); Alert.alert('Saved', 'SN-' + String(r.number).padStart(4, '0')); back(); }
    catch (e: any) { Alert.alert('Not saved', e.message); }
    setBusy(false);
  }
  let cat = '';
  return (
    <View style={s.fill}>
      <Header title={`${kind === 'delivery' ? 'Delivery' : 'Collection'} · ACESC${v.job.number}`} back={() => back(false)} />
      {loading ? <ActivityIndicator style={{ marginTop: 30 }} color={C.magenta} /> : (
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>{kind === 'delivery' ? 'FROM' : 'TO'}</Text>
        <View style={s.chips}>{locs.map((l) => (<TouchableOpacity key={l.id} style={[s.chip, loc === l.id && s.chipOn]} onPress={() => setLoc(l.id)}><Text style={[s.chipT, loc === l.id && s.chipTOn]}>{l.name}</Text></TouchableOpacity>))}</View>
        {kind === 'collection' ? (
          <TouchableOpacity style={[s.btn, s.btnLine, { marginTop: 12 }]} onPress={() => { const q: Record<string, string> = {}; for (const [k, n] of Object.entries(onSite)) if (n > 0) q[k] = String(n); setQty(q); setFinal(true); }}>
            <Text style={[s.btnT, { color: C.purple }]}>Fill with everything on site</Text>
          </TouchableOpacity>) : null}
        {items.map((i) => { const head = i.category !== cat ? (cat = i.category) : null; return (
          <View key={i.id}>
            {head ? <Text style={s.label}>{String(head).toUpperCase()}</Text> : null}
            <View style={s.entry}>
              <View style={{ flex: 1 }}><Text style={s.entryT}>{i.name}</Text><Text style={s.muted}>{i.code}{onSite[i.id] ? ` · on site ${onSite[i.id]}` : ''}</Text></View>
              <TextInput style={[s.input, s.qtyIn]} value={qty[i.id] ?? ''} onChangeText={(t) => setQty({ ...qty, [i.id]: t })} keyboardType="decimal-pad" placeholder="0" />
            </View>
          </View>); })}
        {kind === 'collection' ? (
          <TouchableOpacity style={[s.entry, { marginTop: 8 }]} onPress={() => setFinal(!final)}><Text style={[s.check, final && { color: C.green }]}>{final ? '☑' : '☐'}</Text><Text style={s.entryT}>Final collection — the site is now empty</Text></TouchableOpacity>) : null}
        <Text style={s.label}>DRIVER</Text><TextInput style={s.input} value={driver} onChangeText={setDriver} />
        <Text style={s.label}>{kind === 'delivery' ? 'RECEIVED ON SITE BY' : 'CHECKED BY'}</Text><TextInput style={s.input} value={signed} onChangeText={setSigned} />
        <TouchableOpacity style={[s.btn, { marginTop: 18 }]} onPress={save} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Save note</Text>}</TouchableOpacity>
      </ScrollView>)}
    </View>
  );
}

function Inspect({ job, scaffolds, pre, back }: { job: any; scaffolds: any[]; pre?: string[]; back: (r?: boolean) => void }) {
  const [ticked, setTicked] = useState<string[]>(pre ?? scaffolds.map((x) => x.id));
  const [reason, setReason] = useState('weekly');
  const [safe, setSafe] = useState<boolean | null>(null);
  const [defects, setDefects] = useState('');
  const [actions, setActions] = useState('');
  const [inspector, setInspector] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function photo() {
    if (photos.length >= 4) { Alert.alert('Photos', 'Up to 4 photos.'); return; }
    const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) { Alert.alert('Camera', 'Allow the camera in the phone settings.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.35, base64: true, allowsEditing: false });
    if (!r.canceled && r.assets?.[0]?.base64) setPhotos([...photos, r.assets[0].base64]);
  }
  async function save() {
    if (!ticked.length) { Alert.alert('Inspection', 'Tick the scaffolds inspected.'); return; }
    if (safe === null) { Alert.alert('Inspection', 'Is it safe to use?'); return; }
    if (!safe && !defects.trim()) { Alert.alert('Inspection', 'Say what is wrong.'); return; }
    setBusy(true);
    try { await call('/api/scaf/crew/jobs/' + job.id + '/inspections', 'POST', { scaffold_ids: ticked, reason, safe, defects, actions, inspector, photos }); Alert.alert('Saved', safe ? 'Inspection recorded.' : 'Recorded — the office sees it is NOT safe.'); back(); }
    catch (e: any) { Alert.alert('Not saved', e.message); }
    setBusy(false);
  }
  return (
    <View style={s.fill}>
      <Header title={`Inspection · ACESC${job.number}`} back={() => back(false)} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>SCAFFOLDS</Text>
        {scaffolds.map((x) => { const on = ticked.includes(x.id); return (
          <TouchableOpacity key={x.id} style={[s.entry, on && { backgroundColor: C.soft }]} onPress={() => setTicked(on ? ticked.filter((i) => i !== x.id) : [...ticked, x.id])}>
            <Text style={[s.check, on && { color: C.purple }]}>{on ? '☑' : '☐'}</Text><Text style={[s.entryT, { flex: 1 }]}>{x.element ?? 'Scaffold'}{x.tag ? ' · ' + x.tag : ''}</Text>
          </TouchableOpacity>); })}
        <Text style={s.label}>WHY</Text>
        <View style={s.chips}>{[['first_use', 'Before first use'], ['weekly', '7-day'], ['weather', 'After bad weather'], ['alteration', 'After alteration'], ['other', 'Other']].map(([k, l]) => (
          <TouchableOpacity key={k} style={[s.chip, reason === k && s.chipOn]} onPress={() => setReason(k)}><Text style={[s.chipT, reason === k && s.chipTOn]}>{l}</Text></TouchableOpacity>))}</View>
        <Text style={s.label}>SAFE TO USE?</Text>
        <View style={s.row}>
          <TouchableOpacity style={[s.btn, safe === true ? { backgroundColor: C.green } : s.btnLine]} onPress={() => setSafe(true)}><Text style={[s.btnT, safe !== true && { color: C.green }]}>Safe</Text></TouchableOpacity>
          <TouchableOpacity style={[s.btn, safe === false ? { backgroundColor: '#b42318' } : s.btnLine]} onPress={() => setSafe(false)}><Text style={[s.btnT, safe !== false && { color: '#b42318' }]}>Not safe</Text></TouchableOpacity>
        </View>
        <Text style={s.label}>DEFECTS</Text><TextInput style={[s.input, { minHeight: 70 }]} value={defects} onChangeText={setDefects} multiline placeholder={safe === false ? 'What is wrong (required)' : 'None'} />
        <Text style={s.label}>WHAT WAS DONE</Text><TextInput style={[s.input, { minHeight: 60 }]} value={actions} onChangeText={setActions} multiline placeholder="e.g. tag removed, toe board refitted" />
        <Text style={s.label}>INSPECTED BY</Text><TextInput style={s.input} value={inspector} onChangeText={setInspector} />
        <TouchableOpacity style={[s.btn, s.btnLine, { marginTop: 14 }]} onPress={photo}><Text style={[s.btnT, { color: C.purple }]}>Take a photo ({photos.length}/4)</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, { marginTop: 18 }]} onPress={save} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Save inspection</Text>}</TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  tabs: { flexDirection: 'row', backgroundColor: C.soft, borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabOn: { backgroundColor: C.white, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabT: { fontSize: 15, fontWeight: '700', color: C.muted },
  tabTOn: { color: C.purple, fontWeight: '800' },
  card: { backgroundColor: C.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line },
  title: { fontSize: 17, fontWeight: '800', color: C.ink, marginBottom: 2 },
  kind: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  label: { fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 1, marginTop: 14, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink, backgroundColor: C.white },
  qtyIn: { width: 76, textAlign: 'right', paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: C.white },
  chipOn: { borderColor: C.purple, backgroundColor: C.purple },
  chipT: { color: C.ink, fontWeight: '700' },
  chipTOn: { color: C.white },
  navBtn: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 16 },
  navT: { fontSize: 22, fontWeight: '800', color: C.purple },
  dayT: { fontSize: 18, fontWeight: '800', color: C.ink },
  btn: { flex: 1, backgroundColor: C.purple, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnLine: { backgroundColor: C.white, borderWidth: 1.5, borderColor: C.line },
  btnT: { color: C.white, fontSize: 16, fontWeight: '800' },
  section: { fontSize: 15, fontWeight: '800', color: C.purple, marginTop: 18, marginBottom: 4 },
  muted: { fontSize: 12, color: C.muted, marginTop: 2 },
  link: { fontSize: 15, color: C.purple, fontWeight: '700', marginTop: 6, textDecorationLine: 'underline' },
  warn: { color: '#b45309', marginTop: 10 },
  found: { color: '#15803d', fontWeight: '700', marginTop: 6 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: C.line },
  entryT: { fontSize: 15, color: C.ink },
  note: { fontSize: 13, color: C.ink, fontStyle: 'italic', marginTop: 6 },
  check: { fontSize: 22, color: C.muted },
  back: { fontSize: 16, color: C.purple, fontWeight: '800' },
  sig: { height: 170, backgroundColor: C.white, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#bdb8d3', borderRadius: 12, overflow: 'hidden' },
});
