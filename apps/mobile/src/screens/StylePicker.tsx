import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, FlatList, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { STYLE_ASSETS, STYLE_CODES } from '../lib/styleAssets';
import { STYLE_META } from '../lib/styleMeta';

const LAST_KEY = 'ace_last_style';
const numOf = (c: string) => { const n = c.replace(/\D/g, ''); return n ? parseInt(n, 10) : 0; };
type TypeFilter = 'all' | 'Window' | 'Door' | 'Tilt & Turn';
const DOORISH = ['Door', 'Patio', 'Stable Door'];
const matchesType = (t: string, f: TypeFilter) => f === 'all' || (f === 'Door' ? DOORISH.includes(t) : t === f);

export default function StylePicker({
  visible, subtitle, roomCode, jobId, tenantId, current, onPick, onClose,
}: {
  visible: boolean; subtitle?: string; roomCode?: string | null; jobId?: string; tenantId?: string;
  current?: string; onPick: (designCode: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [wide, setWide] = useState<number | null>(null);
  const [high, setHigh] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lastCode, setLastCode] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery(''); setType('all'); setWide(null); setHigh(null);
    AsyncStorage.getItem(LAST_KEY).then(setLastCode);
    (async () => {
      try {
        const { data } = await supabase.from('pick_events').select('style_number,room_code').limit(2000);
        const c: Record<string, number> = {};
        for (const r of (data ?? []) as any[]) {
          if (!r.style_number) continue;
          c[r.style_number] = (c[r.style_number] ?? 0) + (r.room_code && r.room_code === roomCode ? 3 : 1);
        }
        setCounts(c);
      } catch { /* offline — default order */ }
    })();
  }, [visible, roomCode]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = STYLE_CODES.filter((c) => {
      const m = STYLE_META[c];
      if (q && !c.toLowerCase().includes(q)) return false;
      if (!m) return type === 'all' && wide == null && high == null; // unmapped: only in the fully-open view
      return matchesType(m.type, type) && (wide == null || m.wide === wide) && (high == null || m.high === high);
    });
    base.sort((a, b) => ((counts[b] ?? 0) - (counts[a] ?? 0)) || (numOf(a) - numOf(b)) || a.localeCompare(b));
    return base;
  }, [query, type, wide, high, counts]);

  const narrowed = !!query.trim() || type !== 'all' || wide != null || high != null;
  const ranked = Object.keys(counts).length > 0 && !narrowed;

  async function choose(code: string) {
    onPick(code);
    AsyncStorage.setItem(LAST_KEY, code).catch(() => {});
    if (tenantId) supabase.from('pick_events').insert({ tenant_id: tenantId, style_number: code, job_id: jobId ?? null, room_code: roomCode ?? null }).then(() => {}, () => {});
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.fill}>
        <View style={s.header}>
          <View style={s.hrow}>
            <TouchableOpacity style={s.backBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.backTxt}>‹</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.htitle}>Choose style</Text>
              {!!subtitle && <Text style={s.hsub}>{subtitle}</Text>}
            </View>
          </View>
          <TextInput
            style={s.search} placeholder="Search by code (e.g. 27, 129B)…" placeholderTextColor="rgba(255,255,255,0.75)"
            autoCorrect={false} autoCapitalize="characters" value={query} onChangeText={setQuery}
          />
        </View>

        <View style={s.filters}>
          <View style={s.frow}>
            {(['all', 'Window', 'Door', 'Tilt & Turn'] as TypeFilter[]).map((t) => (
              <TouchableOpacity key={t} style={[s.seg, type === t && s.segOn]} onPress={() => setType(t)} activeOpacity={0.8}>
                <Text style={[s.segTxt, type === t && s.segTxtOn]}>{t === 'all' ? 'All' : t === 'Tilt & Turn' ? 'Tilt&Turn' : t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.frow}>
            <Text style={s.flabel}>Wide</Text>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <TouchableOpacity key={n} style={[s.num, wide === n && s.numOn]} onPress={() => setWide(wide === n ? null : n)} activeOpacity={0.8}>
                <Text style={[s.numTxt, wide === n && s.numTxtOn]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.frow}>
            <Text style={s.flabel}>High</Text>
            {[1, 2, 3].map((n) => (
              <TouchableOpacity key={n} style={[s.num, high === n && s.numOn]} onPress={() => setHigh(high === n ? null : n)} activeOpacity={0.8}>
                <Text style={[s.numTxt, high === n && s.numTxtOn]}>{n}</Text>
              </TouchableOpacity>
            ))}
            {(wide != null || high != null || type !== 'all') && (
              <TouchableOpacity style={s.clear} onPress={() => { setType('all'); setWide(null); setHigh(null); }} activeOpacity={0.7}>
                <Text style={s.clearTxt}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <FlatList
          data={shown}
          keyExtractor={(c) => c}
          numColumns={3}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          columnWrapperStyle={{ justifyContent: 'space-between' }}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews initialNumToRender={18} windowSize={7}
          ListHeaderComponent={
            <View style={s.rankRow}>
              <View style={s.dot} />
              <Text style={s.rankTitle}>{ranked ? 'MOST USED HERE' : 'STYLES'}</Text>
              <Text style={s.rankSub}>{ranked ? 'auto-ranked by pick frequency' : `${shown.length} match${shown.length === 1 ? '' : 'es'}`}</Text>
            </View>
          }
          renderItem={({ item: code }) => {
            const on = current === code;
            const m = STYLE_META[code];
            return (
              <TouchableOpacity style={[s.tile, on && s.tileOn]} onPress={() => choose(code)} activeOpacity={0.8}>
                <Image source={STYLE_ASSETS[code]} style={s.sketch} resizeMode="contain" />
                <Text style={[s.tileNo, on && s.tileNoOn]}>Style {code}</Text>
                {m && <Text style={s.tileMeta}>{m.wide}×{m.high}{m.opening ? ` · ${m.opening} open` : ''}</Text>}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={s.empty}>No style matches those filters.</Text>}
          ListFooterComponent={
            lastCode ? (
              <TouchableOpacity style={s.sameBtn} onPress={() => choose(lastCode)} activeOpacity={0.85}>
                <Text style={s.sameTxt}>Same as last item (Style {lastCode})</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.magenta, paddingTop: 52, paddingBottom: 14, paddingHorizontal: 16 },
  hrow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: '#fff', fontSize: 26, fontWeight: '800', lineHeight: 28 },
  htitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  hsub: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600', marginTop: 2 },
  search: { marginTop: 12, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: '#fff', fontWeight: '600' },
  filters: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  frow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  flabel: { fontSize: 12, fontWeight: '800', color: C.muted, width: 38 },
  seg: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 9, alignItems: 'center', backgroundColor: '#fff' },
  segOn: { backgroundColor: C.purple, borderColor: C.purple },
  segTxt: { fontSize: 12.5, fontWeight: '800', color: C.muted },
  segTxtOn: { color: '#fff' },
  num: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  numOn: { backgroundColor: C.magenta, borderColor: C.magenta },
  numTxt: { fontSize: 14, fontWeight: '800', color: C.muted },
  numTxtOn: { color: '#fff' },
  clear: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 6 },
  clearTxt: { fontSize: 12.5, fontWeight: '800', color: C.magenta },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, marginBottom: 10, paddingHorizontal: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.magenta },
  rankTitle: { fontSize: 13, fontWeight: '800', color: C.magenta, letterSpacing: 0.4 },
  rankSub: { fontSize: 12, color: C.muted, marginLeft: 4 },
  tile: { width: '31.8%', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', marginBottom: 10 },
  tileOn: { borderColor: C.magenta, borderWidth: 2, backgroundColor: '#fdeef6' },
  sketch: { width: '100%', height: 78 },
  tileNo: { fontSize: 12, fontWeight: '800', color: C.ink, marginTop: 6 },
  tileNoOn: { color: C.magenta },
  tileMeta: { fontSize: 10.5, color: C.muted, marginTop: 1 },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 30 },
  sameBtn: { borderWidth: 1.5, borderColor: C.magenta, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 6, marginHorizontal: 4 },
  sameTxt: { color: C.magenta, fontWeight: '800', fontSize: 15 },
});
