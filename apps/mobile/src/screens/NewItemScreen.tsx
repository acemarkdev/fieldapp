import { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert, Modal, FlatList } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { enqueueItem, enqueuePhoto, flushAll, cacheGet, cacheSet, updatePending, removePending, repointPendingPhotos, type Pending } from '../lib/offline';
import { ROOMS, QUICK_ROOMS, roomName } from '../lib/rooms';
import { GLASS_DEFAULT, GLASS_QUICK, GLASS_OPTIONS } from '../lib/glass';
import { WINDOW_TYPE_QUICK, WINDOW_TYPES } from '../lib/windowTypes';
import StylePicker from './StylePicker';
import { STYLE_ASSETS } from '../lib/styleAssets';
import { STYLE_META } from '../lib/styleMeta';
import type { Job } from './JobsScreen';

const MATERIALS = ['uPVC', 'Aluminium', 'Timber', 'Composite', 'Steel'];
const GLAZINGS = ['Single', 'Double', 'Triple'];

const digits = (v: string) => (v || '').replace(/\D/g, '');
const num = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)) || null);

export default function NewItemScreen({ job, onDone, onCancel, editing, existingItem, role }: { job: Job; onDone: () => void; onCancel: () => void; editing?: Pending; existingItem?: any; role?: string | null }) {
  // `existingItem` = a real survey_items row already in the database (surveyor adding the spec to
  // a scanned item). `editing` = a not-yet-synced item still in the local queue. Both prefill the
  // form the same way because the row and the queued payload share field names.
  const p: any = existingItem ?? editing?.payload ?? {};
  // Scanners do the first pass: capture each item's location/identity only (stage 'scanned');
  // the surveyor fills in the spec later. Scan mode hides the spec/team and adds "save & next".
  const scanMode = role === 'scanner';
  const eElev = digits(p.elevation || '');
  const eWd = (p.item_code || '').charAt(0);
  // location (raw, surveyor-friendly; the app adds the B/E/F prefixes and builds the code)
  const [blockN, setBlockN] = useState(digits(p.block || ''));
  const [elevSel, setElevSel] = useState(['1', '2', '3', '4'].includes(eElev) ? eElev : '');
  const [elevN, setElevN] = useState(['1', '2', '3', '4'].includes(eElev) ? '' : eElev);
  const [flatN, setFlatN] = useState(p.flat ? String(p.flat) : '');
  const [floorN, setFloorN] = useState(digits(p.floor || ''));
  const [room, setRoom] = useState(p.room_code || '');
  const [wd, setWd] = useState<'' | 'W' | 'D'>(eWd === 'W' ? 'W' : eWd === 'D' ? 'D' : '');
  const [itemN, setItemN] = useState(digits(p.item_code || ''));
  const [roomModal, setRoomModal] = useState(false);
  const [roomQuery, setRoomQuery] = useState('');
  // spec (predefined pickers — Glazing defaults to Triple, Glass to 4-20-4)
  const [material, setMaterial] = useState(p.material || '');
  const [windowType, setWindowType] = useState(p.window_type || '');
  const [designCode, setDesignCode] = useState(p.design_code || '');
  const [stylePicker, setStylePicker] = useState(false);
  const [wtModal, setWtModal] = useState(false);
  const [wtQuery, setWtQuery] = useState('');
  const [glazing, setGlazing] = useState(p.glazing || 'Triple');
  const [glass, setGlass] = useState(p.glass || GLASS_DEFAULT);
  const [glassModal, setGlassModal] = useState(false);
  const [glassQuery, setGlassQuery] = useState('');
  const [safetyGlass, setSafetyGlass] = useState(p.safety_glass || '');   // 'Yes' | 'No'
  const [openInOut, setOpenInOut] = useState(p.open_in_out || '');        // 'In' | 'Out'
  const [coupled, setCoupled] = useState(p.coupled || '');                // 'Yes' | 'No'
  const [spec, setSpec] = useState<Record<string, string>>({
    width: p.width_mm != null ? String(p.width_mm) : '',
    height: p.height_mm != null ? String(p.height_mm) : '',
    cill: p.cill_depth_mm != null ? String(p.cill_depth_mm) : '',
    t1: p.transom1_mm != null ? String(p.transom1_mm) : '',
    t2: p.transom2_mm != null ? String(p.transom2_mm) : '',
    t3: p.transom3_mm != null ? String(p.transom3_mm) : '',
    m1: p.mullion1_mm != null ? String(p.mullion1_mm) : '',
    m2: p.mullion2_mm != null ? String(p.mullion2_mm) : '',
    m3: p.mullion3_mm != null ? String(p.mullion3_mm) : '',
    addons: p.add_ons || '',
    comments: p.comments || '',
  });
  const specSet = (k: string) => (t: string) => setSpec((prev) => ({ ...prev, [k]: t }));
  // Scanner "one hands" mode: flip on to capture the full spec now (saves as surveyed).
  const [fullDetails, setFullDetails] = useState(false);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [teamId, setTeamId] = useState<string | null>(p.team_id ?? null);
  const [shots, setShots] = useState<{ uri: string; base64: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [justSaved, setJustSaved] = useState('');

  // derived, code-ready values (stored identically to the office form so codes match)
  const block = digits(blockN) ? 'B' + digits(blockN) : '';
  const elevVal = elevSel || digits(elevN);
  const elevation = elevVal ? 'E' + elevVal : '';
  const flatDigits = digits(flatN);
  const floor = digits(floorN) ? 'F' + digits(floorN) : '';
  const roomCode = room.trim().toUpperCase();
  const itemNum = digits(itemN);
  const itemCode = wd && itemNum ? wd + itemNum.padStart(2, '0') : '';
  const itemType = wd === 'W' ? 'Window' : wd === 'D' ? 'Door' : '';
  const code = [job.client_code, job.job_code, block, elevation, flatDigits ? 'F' + flatDigits : '', roomCode, itemCode, floor]
    .filter((x) => x && x.trim()).join('.');
  const specOff = scanMode && !fullDetails; // quick location-only scan (no spec captured)
  const showSpec = !specOff;                // whether the specification sections are shown/saved

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('fitter_teams').select('id,name').order('name');
      if (!error && data) { setTeams(data as any); cacheSet('teams', data); }
      else { const c = await cacheGet<{ id: string; name: string }[]>('teams'); if (c) setTeams(c); }
    })();
  }, []);

  async function addShot(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera / photo access to attach images.'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.4 })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.4 });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    setShots((prev) => [...prev, { uri: res.assets![0].uri, base64: res.assets![0].base64! }]);
  }

  async function save(next = false) {
    setError(''); setJustSaved('');
    if (!block) { setError('Block is required.'); return; }
    if (!elevation) { setError('Elevation is required.'); return; }
    if (!roomCode) { setError('Room is required (it forms the code).'); return; }
    if (!itemCode) { setError('Item is required — pick W or D and enter a number.'); return; }
    if (!floor) { setError('Floor is required.'); return; }
    setSaving(true);
    const off = <T,>(v: T) => (specOff ? null : v); // in a quick scan, leave the spec blank for the surveyor
    const payload = {
      tenant_id: job.tenant_id, job_id: job.id, kind: 'item', stage: specOff ? 'scanned' : 'surveyed',
      block: block || null, elevation: elevation || null, flat: flatDigits || null, floor: floor || null,
      room_code: roomCode, item_code: itemCode, full_code: code, item_type: itemType || null,
      material: off(material || null), window_type: off(windowType || null), design_code: off(designCode || null),
      glass: off(glass || null), safety_glass: off(safetyGlass || null), glazing: off(glazing || null),
      width_mm: off(num(spec.width || '')), height_mm: off(num(spec.height || '')), cill_depth_mm: off(num(spec.cill || '')),
      transom1_mm: off(num(spec.t1 || '')), transom2_mm: off(num(spec.t2 || '')), transom3_mm: off(num(spec.t3 || '')),
      mullion1_mm: off(num(spec.m1 || '')), mullion2_mm: off(num(spec.m2 || '')), mullion3_mm: off(num(spec.m3 || '')),
      open_in_out: off(openInOut || null), add_ons: off(spec.addons || null), coupled: off(coupled || null),
      comments: off(spec.comments || null), team_id: off(teamId),
    };
    if (existingItem) {
      // Surveyor completing the spec on a real, already-saved item — update it directly (online).
      const { tenant_id, job_id, kind, ...fields } = payload as any;
      const { error: upErr } = await supabase.from('survey_items').update({ ...fields, stage: 'surveyed' }).eq('id', existingItem.id);
      if (upErr) {
        setSaving(false);
        setError(/network|fetch|Failed to fetch/i.test(upErr.message) ? 'You appear to be offline. Editing a saved item needs a connection.' : upErr.message);
        return;
      }
      for (const shot of shots) await enqueuePhoto({ tenant_id: job.tenant_id, itemId: existingItem.id, itemFullCode: code }, shot.base64);
      await flushAll();
      setSaving(false);
      onDone();
      return;
    }
    if (editing) {
      await updatePending(editing.localId, { localId: editing.localId, job_id: job.id, full_code: code, payload });
      await repointPendingPhotos(editing.full_code, code); // keep any queued photos attached
    } else {
      const localId = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      await enqueueItem({ localId, job_id: job.id, full_code: code, payload });
    }
    for (const shot of shots) await enqueuePhoto({ tenant_id: job.tenant_id, itemFullCode: code }, shot.base64);
    await flushAll();
    setSaving(false);
    if (next && !editing) {
      // Fast sequential scanning: keep the location, bump the item number, clear photos, stay put.
      setJustSaved(code);
      setShots([]);
      setItemN(String((Number(itemNum) || 0) + 1));
    } else {
      onDone();
    }
  }

  function del() {
    Alert.alert('Delete this item?', 'It will be removed from the queue and not synced.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await removePending(editing!.localId); onDone(); } },
    ]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={s.header}>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.back}>‹ Cancel</Text>
        </TouchableOpacity>
        <Text style={s.htitle}>{existingItem ? 'Add details' : editing ? (scanMode ? 'Edit scan' : 'Edit item') : (scanMode ? 'Scan item' : 'New item')} · {job.client_code}.{job.job_code}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={s.codeBox}><Text style={s.codeText}>{code || `${job.client_code}.${job.job_code}`}</Text></View>

        <Text style={s.group}>LOCATION</Text>

        <NumField label="Block" prefix="B" v={blockN} on={setBlockN} ph="1" />

        <View style={s.field}>
          <Text style={s.label}>Elevation</Text>
          <View style={s.row}>
            {['1', '2', '3', '4'].map((n) => (
              <Pill key={n} label={'E' + n} on={elevSel === n} onPress={() => { setElevSel(n); setElevN(''); }} />
            ))}
            <TextInput
              style={s.mini} placeholder="E5+" placeholderTextColor="#9a97ad" keyboardType="numeric"
              value={elevN} onChangeText={(t) => { setElevN(t); setElevSel(''); }}
            />
          </View>
        </View>

        <NumField label="Flat / plot" v={flatN} on={setFlatN} ph="21" kb />
        <NumField label="Floor" prefix="F" v={floorN} on={setFloorN} ph="1" />

        <View style={s.field}>
          <Text style={s.label}>Room *</Text>
          <View style={s.row}>
            {QUICK_ROOMS.map((c) => <Pill key={c} label={roomName(c)} on={room === c} onPress={() => setRoom(c)} />)}
            <Pill label="More…" on={false} onPress={() => { setRoomQuery(''); setRoomModal(true); }} />
          </View>
          {!!room && !QUICK_ROOMS.includes(room) && (
            <Text style={s.hint}>Selected: {roomName(room)} ({room})</Text>
          )}
        </View>

        <View style={s.field}>
          <Text style={s.label}>Item *</Text>
          <View style={s.row}>
            <Pill label="Window (W)" on={wd === 'W'} onPress={() => setWd('W')} />
            <Pill label="Door (D)" on={wd === 'D'} onPress={() => setWd('D')} />
            <TextInput style={s.mini} placeholder="02" placeholderTextColor="#9a97ad" keyboardType="numeric" value={itemN} onChangeText={setItemN} />
          </View>
          {!!(wd || itemNum) && (
            <Text style={s.hint}>{itemCode ? `→ ${itemCode}` : 'pick W/D and a number'}{itemType ? `  ·  Type: ${itemType}` : ''}</Text>
          )}
        </View>

        {scanMode && (
          <TouchableOpacity style={s.toggleRow} onPress={() => setFullDetails((v) => !v)} activeOpacity={0.7}>
            <View style={[s.toggle, fullDetails && s.toggleOn]}>{fullDetails && <View style={s.toggleDot} />}</View>
            <Text style={s.toggleText}>Add full details now (survey while scanning)</Text>
          </TouchableOpacity>
        )}

        {specOff && <Text style={s.scanNote}>Scan pass: capture the location only. The surveyor adds material, glass and sizes later.</Text>}

        {showSpec && (<>
        <Text style={s.group}>SPECIFICATION</Text>

        <View style={s.field}>
          <Text style={s.label}>Material</Text>
          <View style={s.row}>
            {MATERIALS.map((m) => <Pill key={m} label={m} on={material === m} onPress={() => setMaterial(material === m ? '' : m)} />)}
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Window style</Text>
          <TouchableOpacity style={s.styleBtn} onPress={() => setStylePicker(true)} activeOpacity={0.8}>
            {designCode && STYLE_ASSETS[designCode] ? <Image source={STYLE_ASSETS[designCode]} style={s.styleThumb} resizeMode="contain" /> : null}
            <Text style={[s.styleBtnText, !designCode && { color: C.muted }]}>{designCode ? `Style ${designCode}` : 'Choose style…'}</Text>
            <Text style={s.styleBtnArrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Window type {designCode ? '(or override)' : ''}</Text>
          <View style={s.row}>
            {WINDOW_TYPE_QUICK.map((t) => <Pill key={t} label={t} on={windowType === t} onPress={() => setWindowType(windowType === t ? '' : t)} />)}
            <Pill label="More…" on={false} onPress={() => { setWtQuery(''); setWtModal(true); }} />
          </View>
          {!!windowType && !WINDOW_TYPE_QUICK.includes(windowType) && <Text style={s.hint}>Selected: {windowType}</Text>}
        </View>

        <View style={s.field}>
          <Text style={s.label}>Glazing</Text>
          <View style={s.row}>
            {GLAZINGS.map((g) => <Pill key={g} label={g} on={glazing === g} onPress={() => setGlazing(g)} />)}
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Glass</Text>
          <View style={s.row}>
            {GLASS_QUICK.map((g) => <Pill key={g} label={g} on={glass === g} onPress={() => setGlass(g)} />)}
            <Pill label="More…" on={false} onPress={() => { setGlassQuery(''); setGlassModal(true); }} />
          </View>
          {!!glass && !GLASS_QUICK.includes(glass) && <Text style={s.hint}>Selected: {glass}</Text>}
        </View>

        <View style={s.field}>
          <Text style={s.label}>Safety glass</Text>
          <View style={s.row}>
            {['Yes', 'No'].map((o) => <Pill key={o} label={o} on={safetyGlass === o} onPress={() => setSafetyGlass(safetyGlass === o ? '' : o)} />)}
          </View>
        </View>

        <Field label="Width (mm)" ph="900" v={spec.width} on={specSet('width')} kb="numeric" />
        <Field label="Height inc cill (mm)" ph="1050" v={spec.height} on={specSet('height')} kb="numeric" />
        <Field label="Cill depth (mm)" ph="150" v={spec.cill} on={specSet('cill')} kb="numeric" />

        <Text style={s.group}>TRANSOMS (mm from top)</Text>
        <View style={s.row3}>
          <MiniField label="T1" v={spec.t1} on={specSet('t1')} />
          <MiniField label="T2" v={spec.t2} on={specSet('t2')} />
          <MiniField label="T3" v={spec.t3} on={specSet('t3')} />
        </View>

        <Text style={s.group}>MULLIONS (mm from left)</Text>
        <View style={s.row3}>
          <MiniField label="M1" v={spec.m1} on={specSet('m1')} />
          <MiniField label="M2" v={spec.m2} on={specSet('m2')} />
          <MiniField label="M3" v={spec.m3} on={specSet('m3')} />
        </View>

        <View style={s.field}>
          <Text style={s.label}>Opens</Text>
          <View style={s.row}>
            {['In', 'Out'].map((o) => <Pill key={o} label={'Open ' + o} on={openInOut === o} onPress={() => setOpenInOut(openInOut === o ? '' : o)} />)}
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Coupled</Text>
          <View style={s.row}>
            {['Yes', 'No'].map((o) => <Pill key={o} label={o} on={coupled === o} onPress={() => setCoupled(coupled === o ? '' : o)} />)}
          </View>
        </View>

        <Field label="Add-ons required" v={spec.addons} on={specSet('addons')} />
        <Field label="Comments" v={spec.comments} on={specSet('comments')} multiline />
        </>)}

        <Text style={s.group}>PHOTOS (optional)</Text>
        <View style={s.photoBar}>
          <TouchableOpacity style={s.pbtn} onPress={() => addShot(true)} activeOpacity={0.7}><Text style={s.pbtnText}>Take photo</Text></TouchableOpacity>
          <TouchableOpacity style={s.pbtn} onPress={() => addShot(false)} activeOpacity={0.7}><Text style={s.pbtnText}>Choose photo</Text></TouchableOpacity>
        </View>
        {shots.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            {shots.map((sh, i) => (
              <View key={i} style={{ marginRight: 8 }}>
                <Image source={{ uri: sh.uri }} style={s.thumb} />
                <TouchableOpacity onPress={() => setShots((prev) => prev.filter((_, j) => j !== i))} style={s.rm}><Text style={s.rmText}>×</Text></TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {showSpec && (<>
        <Text style={s.group}>TEAM (optional)</Text>
        <View style={s.chips}>
          <Pill label="— none —" on={teamId === null} onPress={() => setTeamId(null)} />
          {teams.map((t) => <Pill key={t.id} label={t.name} on={teamId === t.id} onPress={() => setTeamId(t.id)} />)}
        </View>
        </>)}

        {!!justSaved && <Text style={s.saved}>Saved {justSaved} ✓ — ready for the next.</Text>}
        {!!error && <Text style={s.error}>{error}</Text>}

        {specOff && !editing ? (
          <>
            <TouchableOpacity style={[s.save, saving && { opacity: 0.6 }]} onPress={() => save(true)} disabled={saving} activeOpacity={0.85}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Save &amp; scan next</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.delBtn} onPress={() => save(false)} disabled={saving} activeOpacity={0.8}>
              <Text style={[s.delBtnText, { color: C.purple }]}>Save &amp; done</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={[s.save, saving && { opacity: 0.6 }]} onPress={() => save(false)} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>{existingItem ? 'Save details' : editing ? 'Save changes' : 'Create item'}</Text>}
          </TouchableOpacity>
        )}
        {!!editing && (
          <TouchableOpacity style={s.delBtn} onPress={del} activeOpacity={0.8}>
            <Text style={s.delBtnText}>Delete item</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={roomModal} animationType="slide" transparent onRequestClose={() => setRoomModal(false)}>
        <View style={s.modalWrap}>
          <View style={s.modalCard}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Choose a room</Text>
              <TouchableOpacity onPress={() => setRoomModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.modalDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.search} placeholder="Search rooms…" placeholderTextColor="#9a97ad"
              autoCorrect={false} value={roomQuery} onChangeText={setRoomQuery}
            />
            <FlatList
              data={ROOMS.filter((r) => `${r.name} ${r.code}`.toLowerCase().includes(roomQuery.trim().toLowerCase()))}
              keyExtractor={(r) => r.code}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 380 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.roomRow} onPress={() => { setRoom(item.code); setRoomModal(false); }} activeOpacity={0.7}>
                  <Text style={s.roomName}>{item.name}</Text>
                  <Text style={s.roomCode}>{item.code}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={s.roomEmpty}>No match.</Text>}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={glassModal} animationType="slide" transparent onRequestClose={() => setGlassModal(false)}>
        <View style={s.modalWrap}>
          <View style={s.modalCard}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Choose glass</Text>
              <TouchableOpacity onPress={() => setGlassModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.modalDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.search} placeholder="Search, or type a custom spec…" placeholderTextColor="#9a97ad"
              autoCorrect={false} autoCapitalize="characters" value={glassQuery} onChangeText={setGlassQuery}
            />
            <FlatList
              data={GLASS_OPTIONS.filter((g) => g.toLowerCase().includes(glassQuery.trim().toLowerCase()))}
              keyExtractor={(g) => g}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 360 }}
              ListHeaderComponent={
                glassQuery.trim() && !GLASS_OPTIONS.some((g) => g.toLowerCase() === glassQuery.trim().toLowerCase())
                  ? <TouchableOpacity style={s.roomRow} onPress={() => { setGlass(glassQuery.trim()); setGlassModal(false); }} activeOpacity={0.7}>
                      <Text style={[s.roomName, { color: C.magenta, fontWeight: '700' }]}>Use “{glassQuery.trim()}”</Text>
                      <Text style={s.roomCode}>custom</Text>
                    </TouchableOpacity>
                  : null
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={s.roomRow} onPress={() => { setGlass(item); setGlassModal(false); }} activeOpacity={0.7}>
                  <Text style={s.roomName}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={wtModal} animationType="slide" transparent onRequestClose={() => setWtModal(false)}>
        <View style={s.modalWrap}>
          <View style={s.modalCard}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Window / door type</Text>
              <TouchableOpacity onPress={() => setWtModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.modalDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.search} placeholder="Search, or type a custom type…" placeholderTextColor="#9a97ad"
              autoCorrect={false} value={wtQuery} onChangeText={setWtQuery}
            />
            <FlatList
              data={WINDOW_TYPES.filter((t) => t.toLowerCase().includes(wtQuery.trim().toLowerCase()))}
              keyExtractor={(t) => t}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 380 }}
              ListHeaderComponent={
                wtQuery.trim() && !WINDOW_TYPES.some((t) => t.toLowerCase() === wtQuery.trim().toLowerCase())
                  ? <TouchableOpacity style={s.roomRow} onPress={() => { setWindowType(wtQuery.trim()); setWtModal(false); }} activeOpacity={0.7}>
                      <Text style={[s.roomName, { color: C.magenta, fontWeight: '700' }]}>Use “{wtQuery.trim()}”</Text>
                      <Text style={s.roomCode}>custom</Text>
                    </TouchableOpacity>
                  : null
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={s.roomRow} onPress={() => { setWindowType(item); setWtModal(false); }} activeOpacity={0.7}>
                  <Text style={s.roomName}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <StylePicker
        visible={stylePicker}
        subtitle={[flatDigits ? 'Flat ' + flatDigits : '', roomCode ? roomName(roomCode) : '', itemCode].filter(Boolean).join(' · ')}
        roomCode={roomCode} jobId={job.id} tenantId={job.tenant_id} current={designCode}
        onClose={() => setStylePicker(false)}
        onPick={(code: string) => { setDesignCode(code); const m = STYLE_META[code]; if (m?.type) setWindowType(m.type); }}
      />
    </KeyboardAvoidingView>
  );
}

function NumField({ label, prefix, v, on, ph, kb }: { label: string; prefix?: string; v: string; on: (t: string) => void; ph?: string; kb?: boolean }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={s.prefixWrap}>
        {!!prefix && <Text style={s.prefixText}>{prefix}</Text>}
        <TextInput style={s.prefixInput} placeholder={ph} placeholderTextColor="#9a97ad" keyboardType="numeric" value={v} onChangeText={on} />
      </View>
    </View>
  );
}

function Field({ label, ph, v, on, kb, multiline }: { label: string; ph?: string; v?: string; on: (t: string) => void; kb?: 'numeric'; multiline?: boolean }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, multiline && { height: 70, textAlignVertical: 'top' }]}
        placeholder={ph} placeholderTextColor="#9a97ad" value={v ?? ''} onChangeText={on}
        keyboardType={kb === 'numeric' ? 'numeric' : 'default'} autoCorrect={false} multiline={!!multiline}
      />
    </View>
  );
}

function MiniField({ label, v, on }: { label: string; v?: string; on: (t: string) => void }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.input} placeholder="—" placeholderTextColor="#9a97ad" keyboardType="numeric" value={v ?? ''} onChangeText={on} />
    </View>
  );
}

function Pill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[s.chip, on && s.chipOn]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: C.purple, paddingTop: 8, paddingBottom: 14, paddingHorizontal: 16 },
  back: { color: '#cfc9ea', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  htitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  codeBox: { backgroundColor: C.soft, borderRadius: 11, padding: 13, marginBottom: 6 },
  codeText: { color: C.purple, fontSize: 14, fontWeight: '700' },
  group: { fontSize: 11, fontWeight: '800', color: '#9a97ad', letterSpacing: 0.5, marginTop: 16, marginBottom: 4 },
  field: { marginTop: 10 },
  label: { fontSize: 12, fontWeight: '700', color: C.muted, marginBottom: 5 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink, backgroundColor: '#fff' },
  prefixWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: '#fff', paddingLeft: 12 },
  prefixText: { color: C.muted, fontSize: 15, fontWeight: '800' },
  prefixInput: { flex: 1, paddingHorizontal: 6, paddingVertical: 10, fontSize: 15, color: C.ink },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  row3: { flexDirection: 'row', gap: 8, marginTop: 6 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, backgroundColor: C.soft, borderRadius: 12, padding: 12 },
  toggle: { width: 44, height: 26, borderRadius: 999, backgroundColor: '#cfc9df', justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: 3 },
  toggleOn: { backgroundColor: C.magenta, alignItems: 'flex-end' },
  toggleDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: C.ink },
  mini: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, width: 84, color: C.ink, backgroundColor: '#fff' },
  hint: { fontSize: 12, color: C.muted, marginTop: 7, fontWeight: '600' },
  styleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 13, backgroundColor: '#fff' },
  styleBtnText: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink },
  styleBtnArrow: { fontSize: 20, fontWeight: '800', color: C.magenta },
  styleThumb: { width: 40, height: 30, marginRight: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff' },
  chipOn: { backgroundColor: C.purple, borderColor: C.purple },
  chipText: { fontSize: 13, fontWeight: '700', color: C.muted },
  chipTextOn: { color: '#fff' },
  error: { color: '#dc2626', fontSize: 13, marginTop: 16 },
  scanNote: { fontSize: 12.5, color: C.muted, backgroundColor: C.soft, borderRadius: 10, padding: 11, marginTop: 14, fontWeight: '600' },
  saved: { color: C.green, fontSize: 13, fontWeight: '800', marginTop: 16 },
  save: { backgroundColor: C.magenta, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  delBtn: { borderWidth: 1, borderColor: '#f1c4c4', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  delBtnText: { color: '#dc2626', fontWeight: '800', fontSize: 14 },
  photoBar: { flexDirection: 'row', gap: 8, marginTop: 4 },
  pbtn: { backgroundColor: C.soft, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  pbtnText: { color: C.purple, fontWeight: '700', fontSize: 13 },
  thumb: { width: 90, height: 90, borderRadius: 10, backgroundColor: C.soft },
  rm: { position: 'absolute', top: -6, right: -6, backgroundColor: C.ink, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rmText: { color: '#fff', fontSize: 15, fontWeight: '800', lineHeight: 18 },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(31,26,61,0.45)' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.purple },
  modalDone: { fontSize: 15, fontWeight: '800', color: C.magenta },
  search: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink, marginBottom: 8 },
  roomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f2f0f8' },
  roomName: { fontSize: 15, color: C.ink },
  roomCode: { fontSize: 13, fontWeight: '800', color: C.muted, fontVariant: ['tabular-nums'] },
  roomEmpty: { color: C.muted, textAlign: 'center', paddingVertical: 20 },
});
