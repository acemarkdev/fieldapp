import { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, Image, Pressable, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Dimensions, Alert, RefreshControl } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase, isDemo } from '../lib/supabase';
import { C } from '../lib/theme';
import { can } from '../lib/permissions';
import type { Job } from './JobsScreen';

interface Plan { id: string; name: string; storage_path: string; url?: string | null; }
interface PinItem { id: string; full_code: string | null; item_code: string | null; stage: string | null; install_status: string | null; plan_id: string | null; plan_x: number | null; plan_y: number | null; }

const statusColor = (s: string | null) =>
  s === 'installed_no_snag' ? C.green
  : (s === 'snag' || s === 'installed_snag' || s === 'misfit') ? C.magenta
  : s ? C.amber : '#8b88a3';
// Before an item is scheduled, the pin shows whether its survey details are in:
// purple = surveyed, grey = mapped only (tap the pin to add the details).
const pinColor = (it: { stage: string | null; install_status: string | null }) =>
  it.install_status ? statusColor(it.install_status) : (it.stage === 'surveyed' || it.stage === 'synced') ? C.purple : '#8b88a3';
const MAX_PLAN_BYTES = 15 * 1024 * 1024;   // same limit as the office upload

export default function PlanScreen({ job, role, onBack, onOpenItem }: {
  job: Job; role?: string | null; onBack: () => void; onOpenItem: (id: string) => void;
}) {
  const canPlace = can(role, 'items.edit');
  const canManage = can(role, 'plans.manage');           // may add a plan from the phone
  const isManager = role === 'admin' || role === 'office';
  const [adding, setAdding] = useState(false);
  const [planName, setPlanName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [curId, setCurId] = useState<string | null>(null);
  const [items, setItems] = useState<PinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unplaced' | 'placed'>('all');
  const [multiPlan, setMultiPlan] = useState(false);
  const [aspect, setAspect] = useState(1.4); // width/height fallback
  const nameOf = (id: string | null) => plans.find((p) => p.id === id)?.name || 'another plan';

  // Fetch plans + pins from Supabase (no loading flag, so pull-to-refresh doesn't flash the spinner).
  const fetchData = useCallback(async () => {
    try {
      const { data: pl, error: pe } = await supabase.from('job_plans').select('id,name,storage_path').eq('job_id', job.id).order('sort');
      if (pe) throw pe;
      const withUrls: Plan[] = [];
      for (const p of (pl ?? []) as Plan[]) {
        const { data: s } = await supabase.storage.from('plans').createSignedUrl(p.storage_path, 3600);
        withUrls.push({ ...p, url: s?.signedUrl ?? null });
      }
      setPlans(withUrls);
      setCurId((prev) => (prev && withUrls.some((p) => p.id === prev)) ? prev : (withUrls[0]?.id ?? null));
      const { data: it, error: ie } = await supabase.from('survey_items')
        .select('id,full_code,item_code,stage,install_status,plan_id,plan_x,plan_y').eq('job_id', job.id).order('full_code');
      if (ie) throw ie;
      setItems((it ?? []) as PinItem[]);
      const { data: t } = await supabase.from('tenants').select('pins_multi_plan').eq('id', job.tenant_id).maybeSingle();
      setMultiPlan(!!(t as any)?.pins_multi_plan);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load the plan. Check your connection and pull down to retry.');
    }
  }, [job.id, job.tenant_id]);

  const load = useCallback(async () => { setLoading(true); await fetchData(); setLoading(false); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  useEffect(() => { load(); }, [load]);

  // Intrinsic aspect ratio of the current plan image, so pins map correctly.
  useEffect(() => {
    const plan = plans.find((p) => p.id === curId);
    if (plan?.url) Image.getSize(plan.url, (w, h) => { if (w && h) setAspect(w / h); }, () => {});
  }, [curId, plans]);

  const width = Dimensions.get('window').width - 24;
  const height = Math.round(width / aspect);
  const curPlan = plans.find((p) => p.id === curId);
  const pins = items.filter((i) => i.plan_id === curId && i.plan_x != null && i.plan_y != null);

  async function place(x: number, y: number) {
    if (!armed || !curId) return;
    const id = armed;
    const { error } = await supabase.from('survey_items')
      .update({ plan_id: curId, plan_x: Math.max(0, Math.min(1, x)), plan_y: Math.max(0, Math.min(1, y)) }).eq('id', id);
    if (error) { Alert.alert('Could not place pin', error.message); return; }
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, plan_id: curId, plan_x: x, plan_y: y } : it));
    setArmed(null);
  }
  async function unpin(id: string) {
    const { error } = await supabase.from('survey_items').update({ plan_id: null, plan_x: null, plan_y: null }).eq('id', id);
    if (error) { Alert.alert('Could not remove pin', error.message); return; }
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, plan_id: null, plan_x: null, plan_y: null } : it));
  }

  // Add a plan from the phone: a photo taken now, a picture from the gallery, or an image file
  // (Files / Drive). The image goes to the 'plans' bucket and a job_plans row points at it.
  async function addPlan(source: 'camera' | 'gallery' | 'files') {
    if (isDemo()) { Alert.alert('Demo mode', 'Adding plans is disabled in the demo.'); return; }
    if (busy) return;
    let base64: string | null = null; let mime = 'image/jpeg';
    try {
      if (source === 'files') {
        const res = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true, multiple: false });
        if (res.canceled || !res.assets?.[0]) return;
        const a = res.assets[0];
        if (!a.mimeType || !/^image\/(jpeg|png|webp)$/.test(a.mimeType)) { Alert.alert('JPG or PNG only', 'Pick a JPG or PNG image. A PDF plan can be added in the office app, which converts it.'); return; }
        mime = a.mimeType || 'image/jpeg';
        base64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
      } else {
        const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera / photo access to add a plan.'); return; }
        const res = source === 'camera'
          ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 })
          : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5 });
        if (res.canceled || !res.assets?.[0]?.base64) return;
        base64 = res.assets[0].base64!; mime = res.assets[0].mimeType || 'image/jpeg';
      }
    } catch (e: any) { Alert.alert('Could not read the image', e?.message ?? String(e)); return; }
    if (!base64) return;
    if (base64.length * 0.75 > MAX_PLAN_BYTES) { Alert.alert('Image too large', 'A plan can be up to 15 MB. Take the photo again or pick a smaller image.'); return; }

    const name = planName.trim() || `Plan ${plans.length + 1}`;
    const ext = ((mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '')) || 'jpg';
    const path = `${job.tenant_id}/plans/${job.id}/${Date.now()}.${ext}`;
    setBusy('Uploading the plan…');
    try {
      const up = await supabase.storage.from('plans').upload(path, decode(base64), { contentType: mime });
      if (up.error) throw up.error;
      const { data: created, error } = await supabase.from('job_plans')
        .insert({ tenant_id: job.tenant_id, job_id: job.id, name, storage_path: path, sort: plans.length }).select('id').single();
      if (error) {
        try { await supabase.storage.from('plans').remove([path]); } catch { /* best effort: don't leave an orphan image */ }
        throw error;
      }
      setAdding(false); setPlanName('');
      await fetchData();
      setCurId((created as any).id);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      Alert.alert('Could not add the plan',
        /network|fetch/i.test(msg) ? 'You appear to be offline. Adding a plan needs a connection.'
        : /row-level security|permission/i.test(msg) ? 'Your login is not allowed to add plans yet. Ask the office to check your role.'
        : msg);
    }
    setBusy(null);
  }

  // Remove a plan. A surveyor may only remove one with no pins on it (the database enforces this);
  // office/admin may remove any — its pins are then cleared.
  function removePlan() {
    const plan = plans.find((p) => p.id === curId);
    if (!plan || busy) return;
    if (isDemo()) { Alert.alert('Demo mode', 'Removing plans is disabled in the demo.'); return; }
    const n = items.filter((i) => i.plan_id === plan.id).length;
    Alert.alert(`Remove “${plan.name}”?`, n ? `${n} pin${n === 1 ? '' : 's'} on it will be cleared. The items themselves stay.` : 'It has no pins on it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setBusy('Removing…');
        const { data, error } = await supabase.from('job_plans').delete().eq('id', plan.id).select('id');
        if (error || !(data ?? []).length) {
          Alert.alert('Could not remove the plan', error?.message ?? 'Plans that already have pins can only be removed by the office.');
        } else {
          try { await supabase.storage.from('plans').remove([plan.storage_path]); } catch { /* the row is gone; the image is unreachable */ }
          await fetchData();
        }
        setBusy(null);
      } },
    ]);
  }

  const addPanel = (
    <View style={s.addCard}>
      <Text style={s.addLabel}>Plan name</Text>
      <TextInput style={s.addInput} value={planName} onChangeText={setPlanName} placeholder={`Plan ${plans.length + 1}  (e.g. Flat 12, Ground floor)`} placeholderTextColor="#9a97ad" />
      <Text style={s.addLabel}>Where is the plan?</Text>
      <View style={s.addRow}>
        <TouchableOpacity style={s.addBtn} onPress={() => addPlan('camera')} disabled={!!busy} activeOpacity={0.8}><Text style={s.addBtnTxt}>Take photo</Text></TouchableOpacity>
        <TouchableOpacity style={s.addBtn} onPress={() => addPlan('gallery')} disabled={!!busy} activeOpacity={0.8}><Text style={s.addBtnTxt}>Gallery</Text></TouchableOpacity>
        <TouchableOpacity style={s.addBtn} onPress={() => addPlan('files')} disabled={!!busy} activeOpacity={0.8}><Text style={s.addBtnTxt}>Files</Text></TouchableOpacity>
      </View>
      {busy
        ? <View style={s.busyRow}><ActivityIndicator color={C.magenta} /><Text style={s.busyTxt}>{busy}</Text></View>
        : <Text style={s.hint}>Photograph the paper plan flat-on and in good light. JPG or PNG only; a PDF is added in the office app.</Text>}
    </View>
  );

  const listItems = items.filter((it) => {
    const placed = it.plan_id === curId && it.plan_x != null;
    if (filter === 'placed') return placed;
    if (filter === 'unplaced') return !it.plan_id; // not on ANY plan
    return true;
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <View style={s.hrow}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={s.back}>‹ Items</Text></TouchableOpacity>
          {canManage && plans.length > 0 && (
            <TouchableOpacity onPress={() => setAdding((v) => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.addLink}>{adding ? 'Close' : '+ Add plan'}</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={s.htitle}>Plan · {job.client_code}.{job.job_code}</Text>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={C.magenta} /></View>
      ) : plans.length === 0 ? (
        <ScrollView
          contentContainerStyle={[s.center, { flexGrow: 1 }]}
          alwaysBounceVertical keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.magenta} colors={[C.magenta]} />}
        >
          {err
            ? <Text style={s.empty}>Couldn't load the plan.{'\n'}{err}{'\n\n'}Pull down to retry.</Text>
            : canManage
              ? <View style={{ alignSelf: 'stretch' }}><Text style={[s.empty, { marginBottom: 14 }]}>No plan for this job yet. Add one here, then place the mapped items on it as pins.</Text>{addPanel}</View>
              : <Text style={s.empty}>No plan uploaded for this job yet.{'\n'}A surveyor or the office adds it.{'\n\n'}Pull down to refresh.</Text>}
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          alwaysBounceVertical keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.magenta} colors={[C.magenta]} />}
        >
          {adding && canManage && addPanel}
          {plans.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {plans.map((p) => (
                <TouchableOpacity key={p.id} style={[s.planTab, curId === p.id && s.planTabOn]} onPress={() => setCurId(p.id)} activeOpacity={0.8}>
                  <Text style={[s.planTabTxt, curId === p.id && s.planTabTxtOn]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {armed && <Text style={s.armBanner}>Tap the plan to place {items.find((i) => i.id === armed)?.item_code || 'the item'} · <Text style={s.armCancel} onPress={() => setArmed(null)}>cancel</Text></Text>}

          <Pressable
            onPress={(e) => { if (armed) place(e.nativeEvent.locationX / width, e.nativeEvent.locationY / height); }}
            style={{ width, height, alignSelf: 'center', borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line }}
          >
            {curPlan?.url
              ? <Image source={{ uri: curPlan.url }} style={{ width, height }} resizeMode="contain" resizeMethod="resize" />
              : <View style={[s.center, { flex: 1 }]}><Text style={s.empty}>Plan image unavailable offline.</Text></View>}
            <View style={StyleSheet.absoluteFill} pointerEvents={armed ? 'none' : 'box-none'}>
              {pins.map((it) => (
                <Pressable key={it.id} onPress={() => onOpenItem(it.id)}
                  style={[s.pin, { left: (it.plan_x as number) * width, top: (it.plan_y as number) * height }]} hitSlop={6}>
                  <View style={[s.pinDot, { backgroundColor: pinColor(it) }]} />
                  <Text style={s.pinLbl}>{it.item_code || it.full_code}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>

          <View style={s.filterRow}>
            {(['all', 'unplaced', 'placed'] as const).map((f) => (
              <TouchableOpacity key={f} style={[s.chip, filter === f && s.chipOn]} onPress={() => setFilter(f)} activeOpacity={0.8}>
                <Text style={[s.chipTxt, filter === f && s.chipTxtOn]}>{f === 'all' ? 'All' : f === 'unplaced' ? 'Unplaced' : 'Placed'}</Text>
              </TouchableOpacity>
            ))}
            <Text style={s.count}>{listItems.length}</Text>
          </View>

          {!canPlace && <Text style={s.hint}>Tap a pin to open its item. (Placing pins is done by surveyors/office.)</Text>}
          {canPlace && <Text style={s.hint}>Tap “place ›” on an item, then tap the plan. Tap a pin to open the item and add its details. Grey pin = details missing · purple = surveyed.</Text>}
          {canManage && !!curPlan && (isManager || pins.length === 0) && !busy && (
            <Text style={s.removeLink} onPress={removePlan}>Remove this plan</Text>
          )}

          {listItems.map((it) => {
            const placed = it.plan_id === curId && it.plan_x != null;
            const elsewhere = !!it.plan_id && it.plan_id !== curId;
            const lockedElsewhere = elsewhere && !multiPlan;
            return (
              <View key={it.id} style={[s.row, armed === it.id && s.rowArmed]}>
                <View style={[s.rdot, { backgroundColor: pinColor(it) }]} />
                <Text style={s.rcode} onPress={() => onOpenItem(it.id)}>{it.full_code || it.item_code}</Text>
                {!canPlace
                  ? <Text style={[s.rplace, { color: placed ? C.green : C.muted }]}>{placed ? 'placed' : (elsewhere ? 'on ' + nameOf(it.plan_id) : '—')}</Text>
                  : placed
                    ? <Text style={s.runpin} onPress={() => unpin(it.id)}>unpin</Text>
                    : lockedElsewhere
                      ? <Text style={[s.rplace, { color: C.muted }]} onPress={() => Alert.alert('Already on ' + nameOf(it.plan_id), 'Unpin it there first, or turn on “item can be on multiple plans” in the office Plans settings.')}>on {nameOf(it.plan_id)}</Text>
                      : <Text style={s.rplace} onPress={() => setArmed(armed === it.id ? null : it.id)}>{armed === it.id ? 'tap plan…' : 'place ›'}</Text>}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: C.purple, paddingTop: 8, paddingBottom: 14, paddingHorizontal: 16 },
  hrow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  back: { color: '#cfc9ea', fontSize: 14, fontWeight: '600' },
  htitle: { color: '#fff', fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { color: C.muted, textAlign: 'center', fontSize: 13, lineHeight: 20 },
  planTab: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, backgroundColor: '#fff' },
  planTabOn: { backgroundColor: C.purple, borderColor: C.purple },
  planTabTxt: { fontSize: 13, fontWeight: '700', color: C.muted },
  planTabTxtOn: { color: '#fff' },
  armBanner: { backgroundColor: C.purple, color: '#fff', fontWeight: '700', fontSize: 13, padding: 10, borderRadius: 10, marginBottom: 10, overflow: 'hidden' },
  armCancel: { textDecorationLine: 'underline' },
  pin: { position: 'absolute', transform: [{ translateX: -9 }, { translateY: -26 }], alignItems: 'center' },
  pinDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
  pinLbl: { fontSize: 9, fontWeight: '800', color: '#fff', backgroundColor: C.ink, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, marginTop: 1, overflow: 'hidden' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: '#fff' },
  chipOn: { backgroundColor: C.magenta, borderColor: C.magenta },
  chipTxt: { fontSize: 12.5, fontWeight: '700', color: C.muted },
  chipTxtOn: { color: '#fff' },
  count: { marginLeft: 'auto', color: C.muted, fontSize: 12, fontWeight: '700' },
  hint: { color: C.muted, fontSize: 12, marginBottom: 8, lineHeight: 17 },
  addLink: { color: '#fff', fontSize: 14, fontWeight: '800' },
  addCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, marginBottom: 12 },
  addLabel: { fontSize: 12, fontWeight: '800', color: C.ink, marginBottom: 6 },
  addInput: { borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 10, fontSize: 15, color: C.ink, marginBottom: 12 },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  addBtn: { flex: 1, backgroundColor: C.purple, borderRadius: 11, paddingVertical: 13, alignItems: 'center' },
  addBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 13.5 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  busyTxt: { color: C.muted, fontSize: 13, fontWeight: '700' },
  removeLink: { color: C.magenta, fontSize: 12.5, fontWeight: '800', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  rowArmed: { borderColor: C.purple, backgroundColor: C.soft },
  rdot: { width: 9, height: 9, borderRadius: 5 },
  rcode: { flex: 1, fontSize: 12.5, fontWeight: '600', color: C.ink },
  runpin: { fontSize: 12, fontWeight: '800', color: C.magenta },
  rplace: { fontSize: 12, fontWeight: '800', color: C.purple },
});
