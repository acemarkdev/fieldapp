import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';

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
  id: string; full_code: string | null; kind: string | null; snag_comment: string | null;
  block: string | null; elevation: string | null; flat: string | null; floor: string | null;
  room_code: string | null; item_code: string | null;
  material: string | null; item_type: string | null; glass: string | null; glazing: string | null;
  width_mm: number | null; height_mm: number | null; comments: string | null;
  stage: string; install_status: string | null; actual_install_date: string | null;
  team_id: string | null; rate_override_pennies: number | null; monday_item_id: string | null;
}

export default function ItemDetailScreen({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const [item, setItem] = useState<Full | null>(null);
  const [team, setTeam] = useState<{ name: string; default_rate_pennies: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('survey_items').select('*').eq('id', id).single();
    const it = data as Full;
    setItem(it);
    if (it?.team_id) {
      const { data: t } = await supabase.from('fitter_teams').select('name,default_rate_pennies').eq('id', it.team_id).single();
      setTeam(t as any);
    } else setTeam(null);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

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

  if (loading || !item) return (
    <View style={{ flex: 1 }}>
      <Header code={item?.full_code} onBack={onBack} />
      <View style={s.center}><ActivityIndicator color={C.magenta} /></View>
    </View>
  );

  const rate = item.rate_override_pennies ?? team?.default_rate_pennies ?? null;
  const isSnag = item.kind === 'snag';

  return (
    <View style={{ flex: 1 }}>
      <Header code={item.full_code} snag={isSnag} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Section title="INSTALL STATUS">
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
          {!!item.actual_install_date && <Text style={s.note}>Install date: {item.actual_install_date}</Text>}
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
          <Row k="Glass" v={item.glass} />
          <Row k="Glazing" v={item.glazing} />
          <Row k="Size (mm)" v={item.width_mm || item.height_mm ? `${item.width_mm ?? '?'} × ${item.height_mm ?? '?'}` : null} />
          <Row k="Comments" v={item.comments} />
        </Section>

        <Section title="LABOUR & SYNC">
          <Row k="Team" v={team?.name ?? '—'} />
          <Row k="Fitting rate" v={money(rate)} />
          <Row k="Monday" v={item.monday_item_id ? 'synced' : 'not synced'} />
        </Section>
      </ScrollView>
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
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: '#9a97ad', letterSpacing: 0.5, marginBottom: 7 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: 'row', paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#f2f0f8' },
  k: { width: 130, color: C.muted, fontWeight: '600', fontSize: 13 },
  v: { flex: 1, color: C.ink, fontSize: 13 },
  big: { paddingVertical: 12, color: C.ink, fontSize: 15 },
  note: { color: C.muted, fontSize: 12, marginTop: 8 },
  opts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  opt: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#fff' },
  optOn: { backgroundColor: C.purple, borderColor: C.purple },
  optText: { fontSize: 13, fontWeight: '700', color: C.muted },
  optTextOn: { color: '#fff' },
});
