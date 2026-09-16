// Mapping (phone) — the compact, one-thing-per-screen version of the iPad grid, for iPhone.
// Step 1 set scope (block/elevations/floors) → Step 2 walk each elevation·floor entering the
// window & door counts with a running total and a progress bar → Step 3 review & Preload.
// Reuses the exact same grid model as the iPad screen, so the created items are identical.
import { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { C } from '../lib/theme';
import { can } from '../lib/permissions';
import type { Job } from './JobsScreen';
import { buildGrid, type MappingGrid } from '../lib/mappingModel';
import { preloadMappingItems, gridTotals } from '../lib/mapping';

interface Cell { ei: number; fi: number }

export default function MappingStepperScreen({ job, role, onBack, onDone, onImport }: {
  job: Job; role?: string | null; onBack: () => void; onDone: () => void; onImport?: () => void;
}) {
  const canMap = can(role, 'items.create');
  const [phase, setPhase] = useState<'scope' | 'cells' | 'review'>('scope');
  const [block, setBlock] = useState('B1');
  const [nElev, setNElev] = useState('1');
  const [nFloors, setNFloors] = useState('1');
  const [grid, setGrid] = useState<MappingGrid | null>(null);
  const [idx, setIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  const cells: Cell[] = useMemo(() => {
    if (!grid) return [];
    const out: Cell[] = [];
    grid.elevations.forEach((el, ei) => el.floors.forEach((_f, fi) => out.push({ ei, fi })));
    return out;
  }, [grid]);
  const totals = useMemo(() => (grid ? gridTotals(grid) : { windows: 0, doors: 0, items: 0 }), [grid]);

  function start() {
    const b = block.trim().toUpperCase();
    if (!b) { Alert.alert('Block required', 'Enter a block (e.g. B1) first.'); return; }
    setGrid(buildGrid({ block: b, nElevations: Number(nElev) || 1, nFloors: Number(nFloors) || 1 }));
    setIdx(0);
    setPhase('cells');
  }

  function setCount(key: 'windows' | 'doors', n: number, cell: Cell) {
    setGrid((g) => {
      if (!g) return g;
      const v = Math.max(0, Math.floor(n) || 0);
      const elevations = g.elevations.map((el, i) => i !== cell.ei ? el : {
        ...el, floors: el.floors.map((f, j) => j !== cell.fi ? f : { ...f, [key]: v }),
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
    } finally { setSaving(false); }
  }

  const cur = grid && cells[idx] ? cells[idx] : null;
  const curFloor = cur && grid ? grid.elevations[cur.ei].floors[cur.fi] : null;
  const curElev = cur && grid ? grid.elevations[cur.ei].elevation : '';

  return (
    <View style={st.fill}>
      <View style={st.head}>
        <TouchableOpacity onPress={phase === 'scope' ? onBack : () => setPhase(phase === 'review' ? 'cells' : 'scope')}>
          <Text style={st.back}>‹ {phase === 'scope' ? 'Back' : (phase === 'review' ? 'Cells' : 'Scope')}</Text>
        </TouchableOpacity>
        <Text style={st.title} numberOfLines={1}>{job.client_code}.{job.job_code} — Mapping</Text>
        <View style={{ width: 48 }} />
      </View>

      {!canMap ? (
        <View style={st.center}><Text style={st.muted}>You don’t have permission to map items on this job.</Text></View>
      ) : phase === 'scope' ? (
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          {onImport && (
            <TouchableOpacity style={st.importBtn} onPress={onImport}><Text style={st.importTxt}>Import from Excel  ›</Text></TouchableOpacity>
          )}
          <Text style={st.section}>SCOPE</Text>
          <Text style={st.lbl}>Block</Text>
          <TextInput style={st.input} value={block} onChangeText={(t) => setBlock(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} />
          <Text style={st.lbl}>Number of elevations</Text>
          <TextInput style={st.input} value={nElev} onChangeText={setNElev} keyboardType="number-pad" />
          <Text style={st.lbl}>Number of floors</Text>
          <TextInput style={st.input} value={nFloors} onChangeText={setNFloors} keyboardType="number-pad" />
          <TouchableOpacity style={st.primary} onPress={start}><Text style={st.primaryTxt}>Start</Text></TouchableOpacity>
        </ScrollView>
      ) : phase === 'cells' && cur && curFloor ? (
        <View style={st.body}>
          <View style={st.progress}><View style={[st.progressFill, { width: `${((idx + 1) / cells.length) * 100}%` }]} /></View>
          <Text style={st.progressTxt}>Floor {idx + 1} of {cells.length}</Text>

          <View style={st.cellHead}>
            <Text style={st.cellTitle}>{curElev} · {curFloor.floor}</Text>
            <Text style={st.running}>Σ Windows {totals.windows} · Doors {totals.doors} · Items {totals.items}</Text>
          </View>

          <Counter label="Windows" value={curFloor.windows} onSet={(n) => setCount('windows', n, cur)} />
          <Counter label="Doors" value={curFloor.doors} onSet={(n) => setCount('doors', n, cur)} />

          <View style={st.navRow}>
            <TouchableOpacity style={[st.nav, idx === 0 && st.disabled]} disabled={idx === 0} onPress={() => setIdx((i) => Math.max(0, i - 1))}>
              <Text style={st.navTxt}>‹ Back</Text>
            </TouchableOpacity>
            {idx < cells.length - 1 ? (
              <TouchableOpacity style={st.navPrimary} onPress={() => setIdx((i) => Math.min(cells.length - 1, i + 1))}>
                <Text style={st.navPrimaryTxt}>Next ›</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={st.navPrimary} onPress={() => setPhase('review')}>
                <Text style={st.navPrimaryTxt}>Review ›</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        // review — scrollable list + a Preload button pinned to a fixed footer (always tappable)
        <View style={st.fill}>
          <ScrollView contentContainerStyle={st.reviewBody}>
            <View style={st.totals}><Text style={st.totalsTxt}>Windows <Text style={st.b}>{totals.windows}</Text>  ·  Doors <Text style={st.b}>{totals.doors}</Text>  ·  Items <Text style={st.b}>{totals.items}</Text></Text></View>
            {grid?.elevations.map((el, ei) => (
              <View key={ei} style={st.card}>
                <Text style={st.elev}>Elevation {el.elevation}</Text>
                {el.floors.map((f, fi) => {
                  const empty = (f.windows + f.doors) === 0;
                  const cellIndex = cells.findIndex((c) => c.ei === ei && c.fi === fi);
                  return (
                    <TouchableOpacity key={fi} style={st.reviewRow} onPress={() => { setIdx(cellIndex); setPhase('cells'); }}>
                      <Text style={st.floor}>{f.floor}</Text>
                      <Text style={[st.reviewCounts, empty && { color: C.amber }]}>{empty ? 'empty' : `${f.windows} W · ${f.doors} D`}</Text>
                      <Text style={st.editLink}>Edit</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>
          <View style={st.footer}>
            <TouchableOpacity style={[st.primary, st.footerBtn, saving && st.disabled]} onPress={preload} disabled={saving}>
              {saving ? <ActivityIndicator color={C.white} /> : <Text style={st.primaryTxt}>Preload {totals.items} item{totals.items === 1 ? '' : 's'}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

function Counter({ label, value, onSet }: { label: string; value: number; onSet: (n: number) => void }) {
  return (
    <View style={st.counter}>
      <Text style={st.counterLbl}>{label}</Text>
      <View style={st.counterRow}>
        <TouchableOpacity style={st.stepBtn} onPress={() => onSet(Math.max(0, value - 1))}><Text style={st.stepTxt}>−</Text></TouchableOpacity>
        <TextInput style={st.counterInput} value={value ? String(value) : ''} onChangeText={(t) => onSet(Math.max(0, Math.floor(Number(t) || 0)))} keyboardType="number-pad" placeholder="0" placeholderTextColor="#a9a6bb" />
        <TouchableOpacity style={st.stepBtn} onPress={() => onSet(value + 1)}><Text style={st.stepTxt}>+</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.line },
  back: { color: C.magenta, fontSize: 16, fontWeight: '600' },
  title: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: C.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  muted: { color: C.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  body: { flex: 1, padding: 16 },
  reviewBody: { padding: 16, paddingBottom: 24 },
  footer: { padding: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.white },
  footerBtn: { marginTop: 0 },
  importBtn: { borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.white, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 18 },
  importTxt: { color: C.purple, fontWeight: '700', fontSize: 15 },
  section: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  lbl: { color: C.muted, fontSize: 12, marginBottom: 4, marginTop: 12 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: C.white, color: C.ink, fontSize: 16 },
  primary: { backgroundColor: C.magenta, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 22 },
  primaryTxt: { color: C.white, fontWeight: '700', fontSize: 16 },
  progress: { height: 6, backgroundColor: C.soft, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: C.magenta },
  progressTxt: { color: C.muted, fontSize: 12, marginTop: 6, marginBottom: 16 },
  cellHead: { marginBottom: 18 },
  cellTitle: { fontSize: 24, fontWeight: '800', color: C.ink },
  running: { color: C.muted, fontSize: 13, marginTop: 6 },
  counter: { marginBottom: 18 },
  counterLbl: { color: C.ink, fontSize: 15, fontWeight: '600', marginBottom: 8 },
  counterRow: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: { width: 54, height: 54, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { fontSize: 26, color: C.purple, fontWeight: '700' },
  counterInput: { flex: 1, marginHorizontal: 12, textAlign: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 12, backgroundColor: C.white, color: C.ink, fontSize: 22, fontWeight: '700' },
  navRow: { flexDirection: 'row', alignItems: 'center', marginTop: 'auto', gap: 12 },
  nav: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingVertical: 14, alignItems: 'center', backgroundColor: C.white },
  navTxt: { color: '#5a5470', fontSize: 16, fontWeight: '600' },
  navPrimary: { flex: 1, backgroundColor: C.magenta, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  navPrimaryTxt: { color: C.white, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  totals: { backgroundColor: C.soft, borderRadius: 8, borderWidth: 1, borderColor: C.line, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 12 },
  totalsTxt: { color: C.ink, fontSize: 14 },
  b: { fontWeight: '800', color: C.purple },
  card: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginBottom: 12 },
  elev: { fontSize: 15, fontWeight: '700', color: C.ink, marginBottom: 6 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line },
  floor: { width: 48, fontWeight: '700', color: '#5a5470', fontSize: 13 },
  reviewCounts: { flex: 1, color: C.ink, fontSize: 14 },
  editLink: { color: C.magenta, fontSize: 14, fontWeight: '600' },
});
