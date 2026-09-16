// Import from Excel — the field-app version of office "Mapping ▸ Import from Excel". Pick an
// .xlsx survey sheet, review the parsed rows (each flagged Complete / Unfinished), edit any
// row's required fields, then Upload to Items. Rows missing mandatory data are created as
// Unfinished so they can be completed later. Also deletes previously-imported items.
import { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, FlatList, StyleSheet, ActivityIndicator, Alert, Modal,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import * as XLSX from 'xlsx';
import { C } from '../lib/theme';
import { can } from '../lib/permissions';
import type { Job } from './JobsScreen';
import {
  parseImportAoa, importItemRecords, missingRequired, isRowComplete, FIELD_LABELS, type ImportRow,
} from '../lib/importModel';
import { commitImportRows, deleteImportedItems, type MapJob } from '../lib/mapping';

// Required fields we let the user fix inline (label + numeric hint).
const EDIT_FIELDS: { k: string; num?: boolean }[] = [
  { k: 'block' }, { k: 'elevation' }, { k: 'flat' }, { k: 'floor' }, { k: 'room' }, { k: 'item' },
  { k: 'material' }, { k: 'item_type' }, { k: 'glass' }, { k: 'glazing' },
  { k: 'width_mm', num: true }, { k: 'height_mm', num: true }, { k: 'open_in_out' }, { k: 'design_code' },
];

export default function ImportScreen({ job, role, onBack, onDone }: {
  job: Job; role?: string | null; onBack: () => void; onDone: () => void;
}) {
  const canImport = can(role, 'items.create');
  const mapJob: MapJob = { id: job.id, tenant_id: (job as any).tenant_id, client_code: job.client_code, job_code: job.job_code };
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [onlyUnfinished, setOnlyUnfinished] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const unfinishedCount = useMemo(() => (rows ? rows.filter((r) => !isRowComplete(r)).length : 0), [rows]);
  const visible = useMemo(() => {
    if (!rows) return [];
    const idx = rows.map((r, i) => i);
    return onlyUnfinished ? idx.filter((i) => !isRowComplete(rows[i])) : idx;
  }, [rows, onlyUnfinished]);

  async function pick() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      setBusy(true);
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const wb = XLSX.read(new Uint8Array(decode(b64)), { type: 'array' });
      const sheet = wb.Sheets['Main'] || wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as any[][];
      const parsed = parseImportAoa(aoa, { jobClient: job.client_code, jobCode: job.job_code });
      if (parsed.error) { Alert.alert('Could not read that file', parsed.error); return; }
      if (!parsed.rows.length) { Alert.alert('Nothing to import', 'No item rows were found in the sheet.'); return; }
      const load = () => { setRows(parsed.rows); setFileName(asset.name); setOnlyUnfinished(false); };
      if (parsed.mismatch > 0) {
        Alert.alert('Different job?', `${parsed.mismatch} of ${parsed.rows.length} rows have a different Area/Site than ${job.client_code}.${job.job_code}. Import anyway?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Import', onPress: load },
        ]);
      } else load();
    } catch (e: any) {
      Alert.alert('Could not read that file', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await commitImportRows(mapJob, rows);
      if (r.error) { Alert.alert('Upload failed', r.error); return; }
      const parts: string[] = [];
      if (r.inserted) parts.push(`Uploaded ${r.inserted}`);
      if (r.queued) parts.push(`Saved ${r.queued} offline (syncs later)`);
      if (r.unfinished) parts.push(`${r.unfinished} Unfinished`);
      if (r.skipped) parts.push(`${r.skipped} already existed`);
      Alert.alert(r.queued && !r.inserted ? 'Saved offline' : 'Imported', parts.join(' · ') || 'Nothing to upload', [{ text: 'OK', onPress: onDone }]);
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert('Delete imported items?', 'Removes items previously imported from Excel for this job. Items already synced to monday.com are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setBusy(true);
        try {
          const r = await deleteImportedItems(job.id);
          if (r.error) Alert.alert('Could not delete', r.error);
          else Alert.alert('Deleted', `Removed ${r.deleted} imported item${r.deleted === 1 ? '' : 's'}.`);
        } finally { setBusy(false); }
      } },
    ]);
  }

  function setField(i: number, k: string, v: string) {
    setRows((rs) => {
      if (!rs) return rs;
      const next = rs.slice();
      next[i] = { ...next[i], [k]: v };
      return next;
    });
  }

  return (
    <View style={st.fill}>
      <View style={st.head}>
        <TouchableOpacity onPress={onBack}><Text style={st.back}>‹ Back</Text></TouchableOpacity>
        <Text style={st.title} numberOfLines={1}>{job.client_code}.{job.job_code} — Import</Text>
        <View style={{ width: 48 }} />
      </View>

      {!canImport ? (
        <View style={st.center}><Text style={st.muted}>You don’t have permission to import items on this job.</Text></View>
      ) : (
        <View style={st.fill}>
          <View style={st.toolbar}>
            <TouchableOpacity style={st.primary} onPress={pick} disabled={busy}>
              <Text style={st.primaryTxt}>{rows ? 'Choose another file' : 'Choose .xlsx file'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.ghost} onPress={confirmDelete} disabled={busy}>
              <Text style={st.ghostTxt}>Delete imported</Text>
            </TouchableOpacity>
          </View>

          {busy && <ActivityIndicator color={C.magenta} style={{ marginTop: 20 }} />}

          {!rows && !busy && (
            <View style={st.center}>
              <Text style={st.muted}>Pick a survey sheet (the Main tab) to load its rows. You can review and fix any missing fields, then upload.</Text>
            </View>
          )}

          {rows && (
            <>
              <View style={st.summary}>
                <Text style={st.summaryTxt} numberOfLines={1}>{fileName}</Text>
                <Text style={st.summaryTxt}>{rows.length} rows · <Text style={{ color: unfinishedCount ? C.amber : C.green, fontWeight: '700' }}>{unfinishedCount} unfinished</Text></Text>
                <TouchableOpacity onPress={() => setOnlyUnfinished((v) => !v)}>
                  <Text style={[st.filter, onlyUnfinished && st.filterOn]}>{onlyUnfinished ? '✓ Unfinished only' : 'Unfinished only'}</Text>
                </TouchableOpacity>
              </View>

              <FlatList
                data={visible}
                keyExtractor={(i) => String(i)}
                contentContainerStyle={{ padding: 12 }}
                renderItem={({ item: i }) => {
                  const r = rows[i];
                  const miss = missingRequired(r);
                  const code = importItemRecords([r], { client_code: job.client_code, job_code: job.job_code })[0]?.full_code ?? '(no item)';
                  return (
                    <TouchableOpacity style={st.row} onPress={() => setEditIdx(i)}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.code}>{code}</Text>
                        {miss.length > 0 && <Text style={st.missing}>Missing: {miss.map((m) => FIELD_LABELS[m] ?? m).join(', ')}</Text>}
                      </View>
                      <View style={[st.badge, miss.length ? st.badgeAmber : st.badgeGreen]}>
                        <Text style={[st.badgeTxt, { color: miss.length ? C.amber : C.green }]}>{miss.length ? 'Unfinished' : 'Complete'}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />

              <View style={st.footer}>
                <TouchableOpacity style={[st.primary, { flex: 1 }, busy && st.disabled]} onPress={upload} disabled={busy}>
                  <Text style={st.primaryTxt}>Upload {rows.length} to Items</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      <Modal visible={editIdx != null} animationType="slide" onRequestClose={() => setEditIdx(null)}>
        {editIdx != null && rows && (
          <View style={st.fill}>
            <View style={st.head}>
              <TouchableOpacity onPress={() => setEditIdx(null)}><Text style={st.back}>Done</Text></TouchableOpacity>
              <Text style={st.title}>Edit row</Text>
              <View style={{ width: 48 }} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
              {EDIT_FIELDS.map(({ k, num }) => (
                <View key={k} style={{ marginBottom: 12 }}>
                  <Text style={st.lbl}>{FIELD_LABELS[k] ?? k}</Text>
                  <TextInput
                    style={st.input}
                    value={rows[editIdx][k] != null ? String(rows[editIdx][k]) : ''}
                    onChangeText={(t) => setField(editIdx, k, t)}
                    keyboardType={num ? 'number-pad' : 'default'}
                    autoCapitalize={['room', 'block', 'elevation', 'item'].includes(k) ? 'characters' : 'none'}
                    autoCorrect={false}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.line },
  back: { color: C.magenta, fontSize: 16, fontWeight: '600' },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: C.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  muted: { color: C.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  toolbar: { flexDirection: 'row', gap: 12, padding: 12 },
  primary: { backgroundColor: C.magenta, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center' },
  primaryTxt: { color: C.white, fontWeight: '700', fontSize: 15 },
  ghost: { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.white },
  ghostTxt: { color: '#b91c1c', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.6 },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.soft, borderBottomWidth: 1, borderBottomColor: C.line },
  summaryTxt: { color: C.ink, fontSize: 13, flexShrink: 1 },
  filter: { color: C.muted, fontSize: 13, fontWeight: '600' },
  filterOn: { color: C.magenta },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, marginBottom: 8 },
  code: { color: C.ink, fontSize: 13, fontWeight: '600' },
  missing: { color: C.amber, fontSize: 12, marginTop: 3 },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 10 },
  badgeAmber: { backgroundColor: C.amberSoft },
  badgeGreen: { backgroundColor: C.greenSoft },
  badgeTxt: { fontSize: 11, fontWeight: '700' },
  footer: { padding: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.white },
  lbl: { color: C.muted, fontSize: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: C.white, color: C.ink, fontSize: 15 },
});
