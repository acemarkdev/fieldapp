import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { enqueuePhoto, flushPhotos, getPendingPhotos, getPhotoDataUri } from '../lib/offline';
import { can } from '../lib/permissions';

const INSTALL_LABEL: Record<string, string> = {
  scheduled: 'Scheduled', installed_no_snag: 'Installed', installed_snag: 'Installed + snag',
  snag: 'Snag', misfit: 'MisFit', delayed: 'Delayed',
};

const STATUS_OPTS: [string, string][] = [
  ['scheduled', 'Scheduled'],
  ['installed_no_snag', 'Installed'],
  ['installed_snag', 'Installed + snag'],
  ['snag', 'Snag'],
  ['misfit', 'MisFit'],
  ['delayed', 'Delayed'],
];
const INSTALLED = new Set(['installed_no_snag', 'installed_snag']);
const money = (p?: number | null) => (p == null ? '—' : '£' + (p / 100).toFixed(2));

interface Full {
  id: string; tenant_id: string; full_code: string | null; kind: string | null; snag_comment: string | null;
  block: string | null; elevation: string | null; flat: string | null; floor: string | null;
  room_code: string | null; item_code: string | null;
  material: string | null; item_type: string | null; window_type: string | null; design_code: string | null;
  glass: string | null; safety_glass: string | null; glazing: string | null;
  width_mm: number | null; height_mm: number | null; cill_depth_mm: number | null;
  transom1_mm: number | null; transom2_mm: number | null; transom3_mm: number | null;
  mullion1_mm: number | null; mullion2_mm: number | null; mullion3_mm: number | null;
  open_in_out: string | null; add_ons: string | null; coupled: string | null; comments: string | null;
  stage: string; install_status: string | null; actual_install_date: string | null;
  team_id: string | null; rate_override_pennies: number | null; monday_item_id: string | null;
}

export default function ItemDetailScreen({ id, role, onBack, onChanged, onEditItem }: { id: string; role?: string | null; onBack: () => void; onChanged: () => void; onEditItem?: (row: any) => void }) {
  const canFit = can(role, 'items.fit');   // only these roles may change install status
  const canAddPhoto = can(role, 'photos.add');
  const canEditSpec = can(role, 'items.edit'); // surveyor/office may fill in the spec
  const canSnag = can(role, 'snags.raise');
  const [snagOpen, setSnagOpen] = useState(false);
  const [snagComment, setSnagComment] = useState('');
  const [snagShots, setSnagShots] = useState<{ uri: string; base64: string }[]>([]);
  const [snagSaving, setSnagSaving] = useState(false);
  const [item, setItem] = useState<Full | null>(null);
  const [team, setTeam] = useState<{ name: string; default_rate_pennies: number; door_rate_pennies?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<{ id: string; url: string; pending?: boolean }[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadPhotos = useCallback(async (fullCode?: string) => {
    const out: { id: string; url: string; pending?: boolean }[] = [];
    try {
      const { data } = await supabase.from('item_photos').select('id,storage_path').eq('item_id', id).order('created_at');
      for (const p of (data ?? []) as any[]) {
        const { data: s } = await supabase.storage.from('photos').createSignedUrl(p.storage_path, 3600);
        if (s?.signedUrl) out.push({ id: p.id, url: s.signedUrl });
      }
    } catch { /* offline: server photos unavailable, still show pending below */ }
    const pend = await getPendingPhotos({ itemId: id, itemFullCode: fullCode });
    for (const ph of pend) {
      const uri = await getPhotoDataUri(ph.localId);
      if (uri) out.push({ id: ph.localId, url: uri, pending: true });
    }
    setPhotos(out);
  }, [id]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('survey_items').select('*').eq('id', id).single();
    const it = data as Full;
    setItem(it);
    if (it?.team_id) {
      const { data: t } = await supabase.from('fitter_teams').select('name,default_rate_pennies,door_rate_pennies').eq('id', it.team_id).single();
      setTeam(t as any);
    } else setTeam(null);
    await loadPhotos(it?.full_code ?? undefined);
    setLoading(false);
  }, [id, loadPhotos]);

  useEffect(() => { load(); }, [load]);

  async function addPhoto(fromCamera: boolean) {
    if (!item) return;
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera / photo access to attach images.'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.4 })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.4 });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    setUploading(true);
    try {
      // Offline-first: queue the photo, then try to upload now. Works with or without signal.
      await enqueuePhoto({ tenant_id: item.tenant_id, itemId: item.id }, res.assets[0].base64!);
      await flushPhotos();
      await loadPhotos(item.full_code ?? undefined);
      onChanged();
    } catch (e: any) { Alert.alert('Photo error', e?.message ?? String(e)); }
    setUploading(false);
  }

  async function setStatus(status: string) {
    if (!item || saving) return;
    setSaving(true);
    const patch: Record<string, unknown> = { install_status: status };
    if (INSTALLED.has(status)) patch.actual_install_date = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from('survey_items').update(patch).eq('id', item.id);
    setSaving(false);
    if (error) { Alert.alert('Could not save', error.message); return; }
    setItem({ ...item, install_status: status, actual_install_date: (patch.actual_install_date as string) ?? item.actual_install_date });
    onChanged();
  }

  async function addSnagShot(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera / photo access to attach images.'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.4 })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.4 });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    setSnagShots((prev) => [...prev, { uri: res.assets![0].uri, base64: res.assets![0].base64! }]);
  }

  async function saveSnag() {
    if (!item) return;
    const comment = snagComment.trim();
    if (!comment) { Alert.alert('Add a description', 'Describe the defect before saving.'); return; }
    setSnagSaving(true);
    try {
      // Next "-S<n>" like the office does, so codes stay consistent.
      const { data: kids } = await supabase.from('survey_items').select('full_code').eq('parent_item_id', item.id);
      const taken = new Set((kids ?? []).map((k: any) => k.full_code));
      let n = 1; while (taken.has(`${item.full_code}-S${n}`)) n++;
      const full_code = `${item.full_code}-S${n}`;
      const row: Record<string, unknown> = {
        tenant_id: item.tenant_id, job_id: (item as any).job_id, kind: 'snag', parent_item_id: item.id, team_id: item.team_id,
        block: item.block, elevation: item.elevation, flat: item.flat, room_code: item.room_code, item_code: item.item_code, floor: (item as any).floor,
        full_code, material: item.material, item_type: item.item_type, glass: item.glass, safety_glass: item.safety_glass, glazing: item.glazing,
        width_mm: item.width_mm, height_mm: item.height_mm, stage: 'surveyed', install_status: 'snag', snag_comment: comment, comments: comment,
      };
      const { data: created, error } = await supabase.from('survey_items').insert(row).select('id').single();
      if (error) throw error;
      for (const sh of snagShots) await enqueuePhoto({ tenant_id: item.tenant_id, itemId: (created as any).id }, sh.base64);
      await flushPhotos();
      setSnagSaving(false); setSnagOpen(false); setSnagComment(''); setSnagShots([]);
      Alert.alert('Snag raised', full_code);
      onChanged(); load();
    } catch (e: any) {
      setSnagSaving(false);
      Alert.alert('Could not raise snag', /network|fetch|Failed to fetch/i.test(e?.message || '') ? 'You appear to be offline. Raising a snag needs a connection.' : (e?.message || String(e)));
    }
  }

  if (loading || !item) return (
    <View style={{ flex: 1 }}>
      <Header code={item?.full_code} onBack={onBack} />
      <View style={s.center}><ActivityIndicator color={C.magenta} /></View>
    </View>
  );

  // Doors use the team's door rate; windows (everything else) the default. Override wins.
  const isDoor = (item.item_type ?? '').toLowerCase().includes('door')
    || (item.item_code ?? '').trim().toUpperCase().startsWith('D');
  const teamRate = team ? (isDoor ? (team.door_rate_pennies ?? team.default_rate_pennies) : team.default_rate_pennies) : null;
  const rate = item.rate_override_pennies ?? teamRate ?? null;
  const isSnag = item.kind === 'snag';

  return (
    <View style={{ flex: 1 }}>
      <Header code={item.full_code} snag={isSnag} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {canEditSpec && onEditItem && !isSnag && (
          <TouchableOpacity style={s.editBtn} onPress={() => onEditItem(item)} activeOpacity={0.85}>
            <Text style={s.editBtnText}>{(item.material || item.glass || item.width_mm) ? 'Edit details' : 'Add survey details ›'}</Text>
          </TouchableOpacity>
        )}
        {canSnag && !isSnag && (
          <TouchableOpacity style={s.snagBtn} onPress={() => { setSnagComment(''); setSnagShots([]); setSnagOpen(true); }} activeOpacity={0.85}>
            <Text style={s.snagBtnText}>⚠ Raise a snag</Text>
          </TouchableOpacity>
        )}
        <Section title="INSTALL STATUS">
          {canFit ? (
            <View style={s.opts}>
              {STATUS_OPTS.map(([val, label]) => {
                const on = item.install_status === val;
                return (
                  <TouchableOpacity key={val} style={[s.opt, on && s.optOn]} onPress={() => setStatus(val)} disabled={saving} activeOpacity={0.7}>
                    <Text style={[s.optText, on && s.optTextOn]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={s.readonlyBox}>
              <Text style={s.readonlyVal}>{item.install_status ? (INSTALL_LABEL[item.install_status] ?? item.install_status) : 'Not scheduled'}</Text>
              <Text style={s.note}>Only fitters and office set the install status.</Text>
            </View>
          )}
          {!!item.actual_install_date && <Text style={s.note}>Install date: {item.actual_install_date}</Text>}
        </Section>

        <Section title="PHOTOS">
          {canAddPhoto && (
            <View style={s.photoBar}>
              <TouchableOpacity style={s.pbtn} onPress={() => addPhoto(true)} disabled={uploading} activeOpacity={0.7}>
                <Text style={s.pbtnText}>Take photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.pbtn} onPress={() => addPhoto(false)} disabled={uploading} activeOpacity={0.7}>
                <Text style={s.pbtnText}>Choose photo</Text>
              </TouchableOpacity>
              {uploading && <ActivityIndicator color={C.magenta} style={{ marginLeft: 6 }} />}
            </View>
          )}
          {photos.length === 0
            ? <Text style={s.note}>No photos yet.</Text>
            : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                {photos.map((p) => (
                  <View key={p.id} style={{ marginRight: 8 }}>
                    <Image source={{ uri: p.url }} style={s.thumb} />
                    {p.pending && <Text style={s.pendMark}>pending</Text>}
                  </View>
                ))}
              </ScrollView>}
        </Section>

        {isSnag && !!item.snag_comment && (
          <Section title="SNAG"><Text style={s.big}>{item.snag_comment}</Text></Section>
        )}

        <Section title="LOCATION">
          <Row k="Room / Item" v={`${item.room_code || '—'} / ${item.item_code || '—'}`} />
          <Row k="Block · Elev · Flat" v={[item.block, item.elevation, item.flat].map((x) => x || '—').join(' · ')} />
          <Row k="Floor" v={item.floor} />
        </Section>

        <Section title="SPECIFICATION">
          <Row k="Material" v={item.material} />
          <Row k="Type" v={item.item_type} />
          <Row k="Window type" v={item.window_type} />
          <Row k="Style" v={item.design_code} />
          <Row k="Glass" v={item.glass} />
          <Row k="Safety glass" v={item.safety_glass} />
          <Row k="Glazing" v={item.glazing} />
          <Row k="Size (mm)" v={item.width_mm || item.height_mm ? `${item.width_mm ?? '?'} × ${item.height_mm ?? '?'}` : null} />
          <Row k="Cill depth (mm)" v={item.cill_depth_mm != null ? String(item.cill_depth_mm) : null} />
          <Row k="Transoms (mm)" v={[item.transom1_mm, item.transom2_mm, item.transom3_mm].filter((x) => x != null).join(' · ') || null} />
          <Row k="Mullions (mm)" v={[item.mullion1_mm, item.mullion2_mm, item.mullion3_mm].filter((x) => x != null).join(' · ') || null} />
          <Row k="Opens" v={item.open_in_out ? `Open ${item.open_in_out}` : null} />
          <Row k="Coupled" v={item.coupled} />
          <Row k="Add-ons" v={item.add_ons} />
          <Row k="Comments" v={item.comments} />
        </Section>

        <Section title="LABOUR & SYNC">
          <Row k="Team" v={team?.name ?? '—'} />
          <Row k="Fitting rate" v={money(rate)} />
          <Row k="Monday" v={item.monday_item_id ? 'synced' : 'not synced'} />
        </Section>
      </ScrollView>

      <Modal visible={snagOpen} animationType="slide" transparent onRequestClose={() => setSnagOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalWrap}>
          <View style={s.modalCard}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Raise a snag</Text>
              <TouchableOpacity onPress={() => setSnagOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.modalX}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.modalSub}>Against {item.full_code}. Creates a snag item the office can schedule and push to Monday.</Text>
            <TextInput
              style={s.snagInput} placeholder="Describe the defect…" placeholderTextColor="#9a97ad"
              value={snagComment} onChangeText={setSnagComment} multiline
            />
            <View style={s.photoBar}>
              <TouchableOpacity style={s.pbtn} onPress={() => addSnagShot(true)} activeOpacity={0.7}><Text style={s.pbtnText}>Take photo</Text></TouchableOpacity>
              <TouchableOpacity style={s.pbtn} onPress={() => addSnagShot(false)} activeOpacity={0.7}><Text style={s.pbtnText}>Choose photo</Text></TouchableOpacity>
            </View>
            {snagShots.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {snagShots.map((sh, i) => (
                  <View key={i} style={{ marginRight: 8 }}>
                    <Image source={{ uri: sh.uri }} style={s.thumb} />
                    <TouchableOpacity onPress={() => setSnagShots((prev) => prev.filter((_, j) => j !== i))} style={s.rm}><Text style={s.rmText}>×</Text></TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={[s.snagSave, snagSaving && { opacity: 0.6 }]} onPress={saveSnag} disabled={snagSaving} activeOpacity={0.85}>
              {snagSaving ? <ActivityIndicator color="#fff" /> : <Text style={s.snagSaveText}>Save snag</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Header({ code, snag, onBack }: { code?: string | null; snag?: boolean; onBack: () => void }) {
  return (
    <View style={s.header}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={s.back}>‹ Items</Text>
      </TouchableOpacity>
      <View style={s.htitleRow}>
        <Text style={s.htitle}>{code || 'Item'}</Text>
        {snag && <Text style={s.snag}>SNAG</Text>}
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  if (v == null || v === '') return null;
  return (
    <View style={s.row}>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: C.purple, paddingTop: 8, paddingBottom: 14, paddingHorizontal: 16 },
  back: { color: '#cfc9ea', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  htitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  htitle: { color: '#fff', fontSize: 17, fontWeight: '800', flexShrink: 1 },
  snag: { fontSize: 10, fontWeight: '800', color: '#fff', backgroundColor: C.magenta, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  editBtn: { backgroundColor: C.magenta, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 16 },
  editBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  snagBtn: { borderWidth: 1.5, borderColor: '#f3d19a', backgroundColor: C.amberSoft, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 16 },
  snagBtnText: { color: C.amber, fontWeight: '800', fontSize: 15 },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(31,26,61,0.45)' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: C.purple },
  modalX: { fontSize: 18, fontWeight: '800', color: C.muted },
  modalSub: { fontSize: 12.5, color: C.muted, marginTop: 4, marginBottom: 12 },
  snagInput: { borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: C.ink, minHeight: 80, textAlignVertical: 'top' },
  snagSave: { backgroundColor: C.magenta, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  snagSaveText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  rm: { position: 'absolute', top: -6, right: -6, backgroundColor: C.ink, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rmText: { color: '#fff', fontSize: 15, fontWeight: '800', lineHeight: 18 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: '#9a97ad', letterSpacing: 0.5, marginBottom: 7 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: 'row', paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#f2f0f8' },
  k: { width: 130, color: C.muted, fontWeight: '600', fontSize: 13 },
  v: { flex: 1, color: C.ink, fontSize: 13 },
  big: { paddingVertical: 12, color: C.ink, fontSize: 15 },
  note: { color: C.muted, fontSize: 12, marginTop: 8 },
  readonlyBox: { paddingVertical: 12 },
  readonlyVal: { fontSize: 16, fontWeight: '800', color: C.ink },
  opts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  opt: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#fff' },
  optOn: { backgroundColor: C.purple, borderColor: C.purple },
  optText: { fontSize: 13, fontWeight: '700', color: C.muted },
  optTextOn: { color: '#fff' },
  photoBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  pbtn: { backgroundColor: C.soft, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  pbtnText: { color: C.purple, fontWeight: '700', fontSize: 13 },
  thumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: C.soft },
  pendMark: { position: 'absolute', bottom: 4, left: 4, fontSize: 9, fontWeight: '800', color: '#fff', backgroundColor: 'rgba(217,119,6,0.9)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
});
