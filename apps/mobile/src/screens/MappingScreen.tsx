// Mapping — build a job's items from an elevation × floor grid (iPad-oriented). Mirrors the
// office "Operations ▸ Mapping ▸ Build elevations & floors": set block + elevations + floors,
// enter window/door counts per floor, watch the live Windows·Doors·Items total, then Preload
// to bulk-create the items. Uses the shared mapping model so codes match the office app.
import { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { C } from '../lib/theme';
import { can } from '../lib/permissions';
import type { Job } from './JobsScreen';
import { buildGrid, type MappingGrid } from '../lib/mappingModel';
import { preloadMappingItems, gridTotals } from '../lib/mapping';

export default function MappingScreen({ job, role, onBack, onDone, onImport }: {
  job: Job; role?: string | null; onBack: () => void; onDone: () => void; onImport?: () => void;
}) {
  const canMap = can(role, 'items.create');
  const [block, setBlock] = useState('B1');
  const [nElev, setNElev] = useState('1');
  const [nFloors, setNFloors] = useState('1');
  const [grid, setGrid] = useState<MappingGrid | null>(null);
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => (grid ? gridTotals(grid) : { windows: 0, doors: 0, items: 0 }), [grid]);

  function build() {
    const b = block.trim().toUpperCase();
    if (!b) { Alert.alert('Block required', 'Enter a block (e.g. B1) first.'); return; }
    const make = () => setGrid(buildGrid({ block: b, nElevations: Number(nElev) || 1, nFloors: Number(nFloors) || 1 }));
    if (grid && totals.items > 0) {
      Alert.alert('Rebuild grid?', 'This replaces the current unsaved grid.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rebuild', style: 'destructive', onPress: make },
      ]);
    } else make();
  }

  function setCell(ei: number, fi: number, key: 'windows' | 'doors', raw: string) {
    setGrid((g) => {
      if (!g) return g;
      const n = Math.max(0, Math.floor(Number(raw) || 0));
      const elevations = g.elevations.map((el, i) => i !== ei ? el : {
        ...el,
        floors: el.floors.map((f, j) => j !== fi ? f : { ...f, [key]: n }),
      });
      return { ...g, elevations };
    });
  }

  async function preload() {
    if (!grid) return;
    if (totals.items === 0) { Alert.alert('Nothing to preload', 'Enter windows or doors on at least one floor.'); return; }
    setSaving(true);
    try {
      const r = await preloadMappingItems(
        { id: job.id, tenant_id: (job as any).tenant_id, client_code: job.client_code, job_code: job.job_code },
        grid,
      );
      if (r.error) { Alert.alert('Could not save', r.error); return; }
      const parts: string[] = [];
      if (r.inserted) parts.push(`Created ${r.inserted}`);
      if (r.queued) parts.push(`Saved ${r.queued} offline (syncs later)`);
      if (r.skipped) parts.push(`${r.skipped} already existed`);
      Alert.alert(r.queued && !r.inserted ? 'Saved offline' : 'Mapped', parts.join(' · ') || 'Nothing to save', [{ text: 'OK', onPress: onDone }]);
      setGrid(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={st.fill}>
      <View style={st.head}>
        <TouchableOpacity onPress={onBack}><Text style={st.back}>‹ Back</Text></TouchableOpacity>
        <Text style={st.title} numberOfLines={1}>{job.client_code}.{job.job_code} — Mapping</Text>
        <View style={{ width: 48 }} />
      </View>

      {!canMap ? (
        <View style={st.center}><Text style={st.muted}>You don’t have permission to map items on this job.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          {onImport && (
            <TouchableOpacity style={st.importBtn} onPress={onImport}>
              <Text style={st.importTxt}>Import from Excel  ›</Text>
            </TouchableOpacity>
          )}
          <Text style={st.section}>BUILD ELEVATIONS & FLOORS</Text>
          <View style={st.controls}>
            <Field label="Block" value={block} onChange={(t) => setBlock(t.toUpperCase())} width={110} auto="characters" />
            <Field label="Elevations" value={nElev} onChange={setNElev} width={100} kb />
            <Field label="Floors" value={nFloors} onChange={setNFloors} width={100} kb />
            <TouchableOpacity style={st.build} onPress={build}><Text style={st.buildTxt}>Build grid</Text></TouchableOpacity>
          </View>

          {grid && (
            <>
              <View style={st.totals}>
                <Text style={st.totalsTxt}>Windows <Text style={st.b}>{totals.windows}</Text>  ·  Doors <Text style={st.b}>{totals.doors}</Text>  ·  Items <Text style={st.b}>{totals.items}</Text></Text>
              </View>

              {grid.elevations.map((el, ei) => (
                <View key={ei} style={st.card}>
                  <View style={st.cardHead}>
                    <Text style={st.elev}>Elevation {el.elevation}</Text>
                    <Text style={st.muted}>Block {grid.block}</Text>
                  </View>
                  {el.floors.map((f, fi) => (
                    <View key={fi} style={st.row}>
                      <Text style={st.floor}>{f.floor}</Text>
                      <CellInput label="Windows" value={f.windows} onChange={(t) => setCell(ei, fi, 'windows', t)} />
                      <CellInput label="Doors" value={f.doors} onChange={(t) => setCell(ei, fi, 'doors', t)} />
                    </View>
                  ))}
                </View>
              ))}

              <Text style={st.hint}>Preload creates draft items (stage Scanned). Duplicates that already exist are skipped.</Text>
            </>
          )}
        </ScrollView>
      )}

      {/* Fixed footer — always visible & tappable regardless of how many elevations. */}
      {canMap && grid && (
        <View style={st.footer}>
          <TouchableOpacity style={[st.preload, saving && st.disabled]} onPress={preload} disabled={saving}>
            {saving ? <ActivityIndicator color={C.white} /> : <Text style={st.preloadTxt}>Preload {totals.items} item{totals.items === 1 ? '' : 's'}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={st.clear} onPress={() => setGrid(null)} disabled={saving}>
            <Text style={st.clearTxt}>Clear grid</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function Field({ label, value, onChange, width, kb, auto }: {
  label: string; value: string; onChange: (t: string) => void; width: number; kb?: boolean; auto?: 'characters';
}) {
  return (
    <View style={{ marginRight: 12 }}>
      <Text style={st.lbl}>{label}</Text>
      <TextInput
        style={[st.input, { width }]} value={value} onChangeText={onChange}
        keyboardType={kb ? 'number-pad' : 'default'} autoCapitalize={auto ?? 'none'} autoCorrect={false}
      />
    </View>
  );
}

function CellInput({ label, value, onChange }: { label: string; value: number; onChange: (t: string) => void }) {
  return (
    <TextInput
      style={st.cell} placeholder={label} placeholderTextColor="#a9a6bb"
      value={value ? String(value) : ''} onChangeText={onChange} keyboardType="number-pad"
    />
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.line },
  back: { color: C.magenta, fontSize: 16, fontWeight: '600' },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: C.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: C.muted, fontSize: 13 },
  body: { padding: 16, paddingBottom: 96 },
  importBtn: { borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.white, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 18 },
  importTxt: { color: C.purple, fontWeight: '700', fontSize: 15 },
  section: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  controls: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' },
  lbl: { color: C.muted, fontSize: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: C.white, color: C.ink, fontSize: 15 },
  build: { backgroundColor: C.magenta, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 11, marginTop: 18 },
  buildTxt: { color: C.white, fontWeight: '700', fontSize: 15 },
  totals: { backgroundColor: C.soft, borderRadius: 8, borderWidth: 1, borderColor: C.line, paddingVertical: 10, paddingHorizontal: 14, marginTop: 16, marginBottom: 12 },
  totalsTxt: { color: C.ink, fontSize: 14 },
  b: { fontWeight: '800', color: C.purple },
  card: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  elev: { fontSize: 15, fontWeight: '700', color: C.ink },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  floor: { width: 48, fontWeight: '700', color: '#5a5470', fontSize: 13 },
  cell: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginRight: 8, backgroundColor: C.white, color: C.ink, fontSize: 15 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.white },
  preload: { backgroundColor: C.magenta, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 12, marginRight: 12 },
  preloadTxt: { color: C.white, fontWeight: '700', fontSize: 15 },
  clear: { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: C.white },
  clearTxt: { color: '#5a5470', fontSize: 15 },
  disabled: { opacity: 0.6 },
  hint: { color: C.muted, fontSize: 12, marginTop: 10 },
});
