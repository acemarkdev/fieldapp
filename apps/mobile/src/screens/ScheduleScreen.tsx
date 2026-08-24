import { useEffect, useState, useCallback } from 'react';
import { View, Text, SectionList, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { C, INSTALL_LABEL } from '../lib/theme';
import { cacheGet, cacheSet } from '../lib/offline';
import { buildSections, monthGrid, isoDate, type SchedRow as Row, type SchedSection as Section } from '../lib/scheduleGrouping';

function statusColor(s: string | null): string {
  if (s === 'installed_no_snag') return C.green;
  if (s === 'snag' || s === 'installed_snag' || s === 'misfit') return C.magenta;
  if (s) return C.amber;
  return '#8b88a3';
}

export default function ScheduleScreen({ teamId, onOpenItem, onBrowseJobs }: {
  teamId?: string | null; onOpenItem: (id: string) => void; onBrowseJobs: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      // RLS already limits a fitter to their own team, but filter explicitly too.
      let q = supabase
        .from('survey_items')
        .select('id,full_code,room_code,item_code,flat,block,item_type,kind,install_status,planned_install_date,job_id,jobs(client_code,job_code,name)')
        .not('install_status', 'is', null);
      if (teamId) q = q.eq('team_id', teamId);
      const { data, error } = await q;
      if (error) throw error;
      const list = (data as unknown as Row[]) ?? [];
      setRows(list); setOffline(false);
      cacheSet('schedule', list);
    } catch {
      const c = await cacheGet<Row[]>('schedule');
      setRows(c ?? []); setOffline(true);
    }
    setLoading(false);
  }, [teamId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  const [mode, setMode] = useState<'agenda' | 'month'>('agenda');
  const todayIso = isoDate(new Date());
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState<string>(todayIso);

  const { sections, counts } = buildSections(rows);

  const site = (r: Row) => r.jobs?.name || (r.jobs ? `${r.jobs.client_code}.${r.jobs.job_code}` : '');
  const where = (r: Row) => [r.block, r.flat].filter(Boolean).join(' · ');

  // Group scheduled items by day for the month grid + selected-day list.
  const byDay: Record<string, Row[]> = {};
  for (const r of rows) if (r.planned_install_date) (byDay[r.planned_install_date] ??= []).push(r);
  const dayColor = (day: string): string => {
    const list = byDay[day] ?? [];
    if (!list.length) return 'transparent';
    if (list.some((r) => r.install_status === 'snag' || r.install_status === 'misfit' || r.install_status === 'installed_snag')) return C.magenta;
    if (list.every((r) => r.install_status === 'installed_no_snag')) return C.green;
    return C.amber;
  };

  const Card = (item: Row) => {
    const isSnag = item.kind === 'snag';
    const st = item.install_status ? INSTALL_LABEL[item.install_status] ?? item.install_status : null;
    return (
      <TouchableOpacity key={item.id} style={s.card} onPress={() => onOpenItem(item.id)} activeOpacity={0.7}>
        <View style={s.dotCol}><View style={[s.dot, { backgroundColor: statusColor(item.install_status) }]} /></View>
        <View style={{ flex: 1 }}>
          <View style={s.cardTop}>
            <Text style={s.code} numberOfLines={1}>{item.full_code}</Text>
            {isSnag && <Text style={s.snag}>SNAG</Text>}
          </View>
          <Text style={s.site} numberOfLines={1}>{site(item)}</Text>
          <Text style={s.meta} numberOfLines={1}>
            {[where(item), `${item.room_code || '—'} · ${item.item_code || '—'}`, item.item_type || null].filter(Boolean).join('  ·  ')}
          </Text>
        </View>
        {st && <Text style={[s.stTag, { color: statusColor(item.install_status), borderColor: statusColor(item.install_status) }]}>{st}</Text>}
      </TouchableOpacity>
    );
  };

  const monthLabel = monthCursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const shiftMonth = (delta: number) => setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  const grid = monthGrid(monthCursor);
  const selList = (byDay[selectedDay] ?? []);
  const selLabel = (() => { const [y, m, d] = selectedDay.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); })();

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <View style={s.hrow}>
          <Text style={s.htitle}>My schedule</Text>
          <TouchableOpacity onPress={onBrowseJobs} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.jobsBtn}>Jobs ›</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.hsummary}>{counts.today} today · {counts.tomorrow} tomorrow · {counts.week} this week</Text>
        <View style={s.seg}>
          {(['agenda', 'month'] as const).map((mo) => (
            <TouchableOpacity key={mo} style={[s.segBtn, mode === mo && s.segBtnOn]} onPress={() => setMode(mo)} activeOpacity={0.8}>
              <Text style={[s.segTxt, mode === mo && s.segTxtOn]}>{mo === 'agenda' ? 'Agenda' : 'Month'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={C.magenta} /></View>
      ) : mode === 'agenda' ? (
        <SectionList
          sections={sections}
          keyExtractor={(it) => it.id}
          stickySectionHeadersEnabled
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.magenta} />}
          ListHeaderComponent={
            <View>
              {!teamId && <Text style={s.banner}>You're not assigned to a team yet. Ask the office to set your team so your work appears here.</Text>}
              {offline && <Text style={s.banner}>Offline — showing saved data.</Text>}
            </View>
          }
          ListEmptyComponent={<Text style={s.empty}>{teamId ? 'Nothing scheduled for your team yet. Dates come from Monday — ask the office to pull them.' : ''}</Text>}
          renderSectionHeader={({ section }) => (
            <View style={s.secHead}>
              <Text style={[s.secTitle, (section as Section).accent ? { color: (section as Section).accent } : null]}>{(section as Section).title}</Text>
            </View>
          )}
          renderItem={({ item }) => Card(item)}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.magenta} />}
        >
          <View style={s.monthBar}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={s.monthNav}>‹</Text></TouchableOpacity>
            <Text style={s.monthLabel}>{monthLabel}</Text>
            <TouchableOpacity onPress={() => shiftMonth(1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={s.monthNav}>›</Text></TouchableOpacity>
          </View>
          <View style={s.weekRow}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <Text key={w} style={s.weekLbl}>{w}</Text>)}
          </View>
          <View style={s.grid}>
            {grid.map((day) => {
              const inMonth = Number(day.slice(5, 7)) === monthCursor.getMonth() + 1;
              const n = (byDay[day] ?? []).length;
              const isToday = day === todayIso;
              const isSel = day === selectedDay;
              return (
                <TouchableOpacity key={day} style={[s.cell, isSel && s.cellSel, isToday && !isSel && s.cellToday]} onPress={() => setSelectedDay(day)} activeOpacity={0.7}>
                  <Text style={[s.cellNum, !inMonth && s.cellOut, isSel && s.cellNumSel]}>{Number(day.slice(8, 10))}</Text>
                  {n > 0 && <View style={[s.cellBadge, { backgroundColor: dayColor(day) }]}><Text style={s.cellBadgeTxt}>{n}</Text></View>}
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.selHead}>{selLabel}{selList.length ? `  ·  ${selList.length}` : ''}</Text>
          {selList.length ? selList.map((it) => Card(it)) : <Text style={s.empty}>Nothing scheduled this day.</Text>}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: C.purple, paddingTop: 8, paddingBottom: 14, paddingHorizontal: 16 },
  hrow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  htitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  jobsBtn: { color: '#cfc9ea', fontSize: 14, fontWeight: '700' },
  hsummary: { color: '#cfc9ea', fontSize: 13, marginTop: 4 },
  seg: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: 3, marginTop: 12, alignSelf: 'flex-start' },
  segBtn: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 8 },
  segBtnOn: { backgroundColor: '#fff' },
  segTxt: { color: '#e6e2f5', fontSize: 13, fontWeight: '800' },
  segTxtOn: { color: C.purple },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthNav: { color: C.purple, fontSize: 26, fontWeight: '800', paddingHorizontal: 12 },
  monthLabel: { color: C.ink, fontSize: 16, fontWeight: '800' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekLbl: { flex: 1, textAlign: 'center', color: C.muted, fontSize: 11, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  cellSel: { backgroundColor: C.purple },
  cellToday: { borderWidth: 1.5, borderColor: C.purple },
  cellNum: { fontSize: 14, fontWeight: '700', color: C.ink },
  cellNumSel: { color: '#fff' },
  cellOut: { color: '#c9c6d8', fontWeight: '500' },
  cellBadge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  cellBadgeTxt: { color: '#fff', fontSize: 9.5, fontWeight: '800' },
  selHead: { fontSize: 14, fontWeight: '800', color: C.ink, marginTop: 18, marginBottom: 10 },
  banner: { backgroundColor: C.amberSoft, color: C.amber, fontWeight: '700', fontSize: 12, padding: 10, borderRadius: 10, marginBottom: 10 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 30, paddingHorizontal: 20, lineHeight: 20 },
  secHead: { backgroundColor: C.bg, paddingVertical: 6, marginTop: 4 },
  secTitle: { fontSize: 13, fontWeight: '800', color: C.ink, textTransform: 'none' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 13, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start' },
  dotCol: { paddingTop: 3, paddingRight: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { fontSize: 13, fontWeight: '700', color: C.ink, flexShrink: 1 },
  snag: { fontSize: 10, fontWeight: '800', color: '#fff', backgroundColor: C.magenta, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: 'hidden', marginLeft: 6 },
  site: { fontSize: 12.5, fontWeight: '600', color: C.purple, marginTop: 3 },
  meta: { fontSize: 12, color: C.muted, marginTop: 3 },
  stTag: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, overflow: 'hidden', marginLeft: 8, alignSelf: 'flex-start' },
});
