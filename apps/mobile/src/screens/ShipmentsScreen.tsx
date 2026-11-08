// Warehouse ▸ Wysyłki: the shipments being loaded (Logistics ▸ Shipments in the office). The list shows what is not
// sent yet and what left this week. A shipment opens its lines: tick each one as loaded, put in the net / gross kg,
// take photos of it; then photograph the CMR and the signed packing list and mark the shipment as sent.
// Photos go up one by one in the background — the screen can be used while they upload.
// Everything goes through the office server (/api/shipments/…), which applies the same rules as the office.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert, Image, AppState, Modal } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { officeUrl } from '../lib/crewLogic';
import { forPhone, kg, kgText, progress, beforeSending, firstLine, STATUS_PL, type PShip, type PLine, type PFile } from '../lib/shipLogic';
import { useKeyboardPad } from '../lib/useKeyboardPad';

const BASE = officeUrl(process.env.EXPO_PUBLIC_OFFICE_URL, process.env.EXPO_PUBLIC_SUPABASE_URL);
async function token() { const { data } = await supabase.auth.getSession(); return data?.session?.access_token ?? ''; }
async function call(path: string, method = 'GET', body?: unknown): Promise<any> {
  const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let d: any = {}; try { d = await r.json(); } catch { /* empty */ }
  if (!r.ok || d.ok === false) throw new Error(plError(d.error) || 'Serwer biura nie odpowiada (' + r.status + ').');
  return d;
}
const PL_ERR: Record<string, string> = {
  'Not allowed.': 'Brak uprawnień.', 'Shipment not found.': 'Nie znaleziono wysyłki.', 'Line not found.': 'Nie znaleziono pozycji.',
  'The weight is not a number (kg).': 'Waga musi być liczbą (kg).', 'The gross weight is lower than the net weight.': 'Waga brutto jest mniejsza niż netto.',
  'A photo must be an image (JPG or PNG).': 'Zdjęcie musi być obrazem (JPG lub PNG).', 'The file is too large (max 20 MB).': 'Plik jest za duży (max 20 MB).',
};
function plError(m: unknown) { const s = String(m ?? ''); return PL_ERR[s] ?? s; }
const dPL = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

// ---- background photo uploads: one at a time, a counter shows what is still going up ----
type Job = { sid: string; kind: string; lineId: string | null; b64: string; name: string };
const queue: Job[] = []; let running = false; const listeners = new Set<(n: number) => void>(); let onDone: ((sid: string) => void) | null = null;
const tell = () => listeners.forEach((f) => f(queue.length + (running ? 1 : 0)));
async function pump() {
  if (running) return; running = true;
  while (queue.length) {
    const j = queue.shift()!; tell();
    try { await call('/api/shipments/' + j.sid + '/files', 'POST', { kind: j.kind, line_id: j.lineId, name: j.name, data: 'data:image/jpeg;base64,' + j.b64 }); onDone?.(j.sid); }
    catch (e: any) { Alert.alert('Zdjęcie nie zostało wysłane', (e?.message ?? String(e)) + '\nSpróbuj ponownie, gdy będzie internet.'); }
  }
  running = false; tell();
}
async function pickPhotos(fromCamera: boolean): Promise<string[]> {
  const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) { Alert.alert('Brak dostępu', 'Pozwól aplikacji używać aparatu / zdjęć w ustawieniach telefonu.'); return []; }
  const res = fromCamera ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 }) : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, allowsMultipleSelection: true, selectionLimit: 10 });
  if (res.canceled) return [];
  return (res.assets ?? []).map((a) => a.base64).filter((b): b is string => !!b);
}

export default function ShipmentsScreen() {
  const [list, setList] = useState<PShip[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  useEffect(() => { listeners.add(setPending); return () => { listeners.delete(setPending); }; }, []);
  const load = useCallback(async () => {
    try { const d = await call('/api/shipments'); setList(forPhone(d.shipments ?? [])); }
    catch (e: any) { Alert.alert('Brak połączenia', 'Nie udało się wczytać wysyłek. ' + (e?.message ?? '')); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); }); return () => sub.remove(); }, [load]);
  if (open) return <Detail id={open} pending={pending} onBack={() => { setOpen(null); load(); }} />;
  if (loading) return <View style={[s.fill, s.center]}><ActivityIndicator color={C.magenta} /></View>;
  return (
    <ScrollView style={s.fill} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      {pending > 0 && <Text style={s.upl}>Wysyłanie zdjęć… zostało {pending}</Text>}
      {list.length === 0 && <Text style={[s.muted, { textAlign: 'center', marginTop: 24 }]}>Brak wysyłek do załadunku. Biuro dodaje je w Logistyka ▸ Wysyłki.</Text>}
      {list.map((x) => (
        <TouchableOpacity key={x.id} style={s.card} onPress={() => setOpen(x.id)} activeOpacity={0.8}>
          <View style={s.row}>
            <Text style={[s.title, { flex: 1 }]} numberOfLines={1}>{x.name}</Text>
            <Text style={[s.pill, { backgroundColor: x.status === 'sent' ? C.green : x.status === 'in_progress' ? C.amber : x.status === 'sent_no_docs' ? C.magenta : C.muted }]}>{STATUS_PL[x.status] ?? x.status}</Text>
          </View>
          <Text style={s.muted} numberOfLines={1}>{[x.company === 'wem' ? 'WEM' : 'Acemark', dPL(x.ship_date), firstLine(x.importer)].filter(Boolean).join(' · ')}</Text>
          <Text style={s.muted}>{x.totals?.lines ?? 0} poz. · {x.photos ?? 0} zdjęć{x.missing?.length ? ' · brak: ' + x.missing.join(', ') : ''}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function Detail({ id, pending, onBack }: { id: string; pending: number; onBack: () => void }) {
  const [d, setD] = useState<{ shipment: any; lines: PLine[]; files: PFile[] } | null>(null);
  const [tok, setTok] = useState('');
  const [view, setView] = useState<string | null>(null);   // a photo shown full screen
  const kb = useKeyboardPad();
  const load = useCallback(async () => {
    try { const g = await call('/api/shipments/' + id); setD({ shipment: g.shipment, lines: g.lines, files: g.files }); }
    catch (e: any) { Alert.alert('Nie udało się wczytać', e?.message ?? String(e)); }
  }, [id]);
  useEffect(() => { load(); token().then(setTok); }, [load]);
  useEffect(() => { onDone = (sid) => { if (sid === id) load(); }; return () => { onDone = null; }; }, [id, load]);
  if (!d) return <View style={[s.fill, s.center]}><ActivityIndicator color={C.magenta} /></View>;
  const sh = d.shipment, p = progress(d.lines), sent = sh.status === 'sent' || sh.status === 'sent_no_docs';
  const fileUri = (fid: string) => ({ uri: BASE + '/api/shipments/' + id + '/files/' + fid, headers: { Authorization: 'Bearer ' + tok } });

  const patch = async (l: PLine, f: Partial<PLine>) => {
    setD((x) => (x ? { ...x, lines: x.lines.map((y) => (y.id === l.id ? { ...y, ...f } : y)) } : x));
    try { await call('/api/shipments/' + id + '/lines/' + l.id, 'PATCH', f); }
    catch (e: any) { Alert.alert('Nie zapisano', e?.message ?? String(e)); load(); }
  };
  const photo = async (kind: string, lineId: string | null, fromCamera: boolean, label: string) => {
    const shots = await pickPhotos(fromCamera); if (!shots.length) return;
    shots.forEach((b64, i) => queue.push({ sid: id, kind, lineId, b64, name: `${label}-${Date.now()}-${i + 1}.jpg` }));
    tell(); pump();
  };
  const ask = (title: string, msg: string, yes: string) => new Promise<boolean>((res) => Alert.alert(title, msg, [{ text: 'Anuluj', style: 'cancel', onPress: () => res(false) }, { text: yes, onPress: () => res(true) }]));
  const status = async (st: string) => {
    if (st === 'sent') {
      const miss = beforeSending(d.lines, d.files);
      if (miss.length && !(await ask('Na pewno wysłane?', miss.join('\n'), 'Tak, wysłane'))) return;
      if (!d.files.some((f) => f.kind === 'cmr')) st = 'sent_no_docs';
    }
    try { await call('/api/shipments/' + id, 'PATCH', { status: st }); load(); } catch (e: any) { Alert.alert('Nie udało się', e?.message ?? String(e)); }
  };
  const papers = (kind: string) => d.files.filter((f) => f.kind === kind);
  return (
    <>
      <ScrollView style={s.fill} contentContainerStyle={{ padding: 12, paddingBottom: 60 + kb }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <TouchableOpacity onPress={onBack} style={{ paddingVertical: 6 }}><Text style={s.link}>‹ Wysyłki</Text></TouchableOpacity>
        {pending > 0 && <Text style={s.upl}>Wysyłanie zdjęć… zostało {pending}</Text>}
        <View style={s.card}>
          <Text style={s.title}>{sh.name}</Text>
          <Text style={s.muted}>{(sh.company === 'wem' ? 'WEM' : 'Acemark') + ' · ' + (STATUS_PL[sh.status] ?? sh.status) + (sh.ship_date ? ' · ' + dPL(sh.ship_date) : '')}</Text>
          {!!sh.importer && <Text style={s.info}><Text style={s.infoL}>Importer: </Text>{firstLine(sh.importer)}</Text>}
          {!!sh.delivery_address && <Text style={s.info}><Text style={s.infoL}>Dostawa: </Text>{sh.delivery_address}</Text>}
          {!!(sh.driver || sh.plates) && <Text style={s.info}><Text style={s.infoL}>Kierowca: </Text>{[sh.driver, sh.plates].filter(Boolean).join(' · ')}</Text>}
          <Text style={[s.found, p.loaded < p.total && { color: C.amber }]}>Załadowano {p.loaded} z {p.total}</Text>
          <View style={[s.row, { marginTop: 10 }]}>
            {sh.status === 'new' && <TouchableOpacity style={s.btn} onPress={() => status('in_progress')}><Text style={s.btnT}>Zaczynam załadunek</Text></TouchableOpacity>}
            {!sent && <TouchableOpacity style={[s.btn, { backgroundColor: C.green }]} onPress={() => status('sent')}><Text style={s.btnT}>Wysłane</Text></TouchableOpacity>}
          </View>
        </View>

        <Text style={s.section}>Pozycje</Text>
        {d.lines.length === 0 && <Text style={s.muted}>Biuro nie dodało jeszcze pozycji.</Text>}
        {d.lines.map((l, i) => (
          <Line key={l.id} n={i + 1} l={l} photos={d.files.filter((f) => f.kind === 'photo' && f.line_id === l.id)} uri={fileUri}
            onPatch={(f) => patch(l, f)} onPhoto={(cam) => photo('photo', l.id, cam, 'poz' + (i + 1))} onView={setView} />
        ))}

        <Text style={s.section}>Dokumenty</Text>
        {([['cmr', 'CMR'], ['packing_signed', 'Podpisana lista pakowa']] as const).map(([k, label]) => (
          <View key={k} style={s.card}>
            <View style={s.row}><Text style={[s.title, { flex: 1, fontSize: 15 }]}>{label}</Text>{papers(k).length > 0 && <Text style={s.found}>✓ {papers(k).length}</Text>}</View>
            <View style={s.thumbs}>{papers(k).map((f) => /\.(jpe?g|png)$/i.test(f.file_name ?? '') ? <TouchableOpacity key={f.id} onPress={() => setView(f.id)}><Image source={fileUri(f.id)} style={s.thumb} /></TouchableOpacity> : <Text key={f.id} style={s.muted}>{f.file_name}</Text>)}</View>
            <View style={[s.row, { marginTop: 8 }]}>
              <TouchableOpacity style={s.pbtn} onPress={() => photo(k, null, true, k)}><Text style={s.pbtnT}>📷 Zrób zdjęcie</Text></TouchableOpacity>
              <TouchableOpacity style={[s.pbtn, { backgroundColor: C.soft }]} onPress={() => photo(k, null, false, k)}><Text style={[s.pbtnT, { color: C.purple }]}>Z galerii</Text></TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
      <Modal visible={!!view} animationType="fade" onRequestClose={() => setView(null)}>
        <TouchableOpacity style={[s.fill, { backgroundColor: '#000' }]} activeOpacity={1} onPress={() => setView(null)}>
          {view && <Image source={fileUri(view)} style={{ flex: 1 }} resizeMode="contain" />}
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function Line({ n, l, photos, uri, onPatch, onPhoto, onView }: { n: number; l: PLine; photos: PFile[]; uri: (id: string) => any; onPatch: (f: Partial<PLine>) => void; onPhoto: (cam: boolean) => void; onView: (id: string) => void }) {
  const [net, setNet] = useState(kgText(l.net_kg)), [gross, setGross] = useState(kgText(l.gross_kg));
  const last = useRef({ net: kgText(l.net_kg), gross: kgText(l.gross_kg) });
  useEffect(() => { setNet(kgText(l.net_kg)); setGross(kgText(l.gross_kg)); last.current = { net: kgText(l.net_kg), gross: kgText(l.gross_kg) }; }, [l.net_kg, l.gross_kg]);
  const saveKg = (which: 'net' | 'gross') => {
    const v = which === 'net' ? net : gross; if (v === last.current[which]) return;
    const x = kg(v); if (x === undefined) { Alert.alert('Waga', 'Wpisz wagę w kg, np. 17,5.'); return; }
    last.current[which] = v; onPatch(which === 'net' ? { net_kg: x } : { gross_kg: x });
  };
  return (
    <View style={[s.card, l.loaded && { borderColor: C.green, backgroundColor: C.greenSoft }]}>
      <View style={s.row}>
        <TouchableOpacity style={[s.check, l.loaded && s.checkOn]} onPress={() => onPatch({ loaded: !l.loaded })}><Text style={s.checkT}>{l.loaded ? '✓' : ''}</Text></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.entryT}><Text style={{ fontWeight: '800' }}>{n}. </Text>{l.description}</Text>
          <Text style={s.muted}>{kgText(l.qty)} {l.unit ?? ''}{l.comment ? ' · ' + l.comment : ''}</Text>
        </View>
      </View>
      <View style={[s.row, { marginTop: 8 }]}>
        <View style={{ flex: 1 }}><Text style={s.label}>NETTO KG</Text><TextInput style={s.input} value={net} onChangeText={setNet} onBlur={() => saveKg('net')} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.muted} /></View>
        <View style={{ flex: 1 }}><Text style={s.label}>BRUTTO KG</Text><TextInput style={s.input} value={gross} onChangeText={setGross} onBlur={() => saveKg('gross')} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.muted} /></View>
      </View>
      <View style={s.thumbs}>{photos.map((f) => <TouchableOpacity key={f.id} onPress={() => onView(f.id)}><Image source={uri(f.id)} style={s.thumb} /></TouchableOpacity>)}</View>
      <View style={[s.row, { marginTop: 8 }]}>
        <TouchableOpacity style={s.pbtn} onPress={() => onPhoto(true)}><Text style={s.pbtnT}>📷 Zdjęcie</Text></TouchableOpacity>
        <TouchableOpacity style={[s.pbtn, { backgroundColor: C.soft }]} onPress={() => onPhoto(false)}><Text style={[s.pbtnT, { color: C.purple }]}>Z galerii</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { backgroundColor: C.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line, marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  pill: { color: C.white, fontWeight: '800', fontSize: 12, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  muted: { fontSize: 12, color: C.muted, marginTop: 2 },
  info: { fontSize: 13, color: C.ink, marginTop: 6 },
  infoL: { fontWeight: '800', color: C.muted },
  found: { color: '#15803d', fontWeight: '800', marginTop: 8 },
  upl: { color: C.amber, fontWeight: '800', marginBottom: 8 },
  section: { fontSize: 15, fontWeight: '800', color: C.purple, marginTop: 10, marginBottom: 6 },
  link: { color: C.purple, fontWeight: '800', fontSize: 15 },
  btn: { flex: 1, backgroundColor: C.purple, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnT: { color: C.white, fontSize: 16, fontWeight: '800' },
  pbtn: { flex: 1, backgroundColor: C.purple, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  pbtnT: { color: C.white, fontWeight: '800', fontSize: 14 },
  label: { fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 1, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 17, color: C.ink, backgroundColor: C.white, textAlign: 'center', fontWeight: '700' },
  entryT: { fontSize: 14, color: C.ink },
  check: { width: 40, height: 40, borderRadius: 10, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.white },
  checkOn: { backgroundColor: C.green, borderColor: C.green },
  checkT: { color: C.white, fontSize: 22, fontWeight: '900' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: C.soft },
});
