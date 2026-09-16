// Mapping job picker — the field-app version of the office Mapping job dropdown: only jobs
// with no items yet, grouped by programme status (Live / Pending / Done). Pick one to start
// building its plan. Scanners only see jobs an admin has released for mapping (RLS enforces it).
import { useEffect, useMemo, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { C } from '../lib/theme';
import { mappingJobs, type MapJob } from '../lib/mapping';
import { bucketByProgramme } from '../lib/mappingModel';

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function MappingJobsScreen({ onBack, onPick }: {
  onBack: () => void; onPick: (job: MapJob) => void;
}) {
  const [jobs, setJobs] = useState<MapJob[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const list = await mappingJobs();
    setJobs(list);
  }
  useEffect(() => { load(); }, []);

  const sections = useMemo(() => {
    if (!jobs) return [];
    const b = bucketByProgramme(jobs, todayISO());
    return [
      { title: 'Live', data: b.live },
      { title: 'Pending', data: b.pending },
      { title: 'Done', data: b.done },
    ].filter((s) => s.data.length > 0);
  }, [jobs]);

  return (
    <View style={st.fill}>
      <View style={st.head}>
        <TouchableOpacity onPress={onBack}><Text style={st.back}>‹ Back</Text></TouchableOpacity>
        <Text style={st.title}>Map a job</Text>
        <View style={{ width: 48 }} />
      </View>

      {!jobs ? (
        <View style={st.center}><ActivityIndicator color={C.magenta} /></View>
      ) : jobs.length === 0 ? (
        <View style={st.center}><Text style={st.muted}>No jobs to map. A job appears here only until it has its first items.</Text></View>
      ) : (
        <SectionList
          sections={sections as any}
          keyExtractor={(item: MapJob) => item.id}
          contentContainerStyle={{ padding: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={C.magenta} />}
          renderSectionHeader={({ section }) => <Text style={st.section}>{(section as any).title.toUpperCase()}</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={st.row} onPress={() => onPick(item)}>
              <View style={{ flex: 1 }}>
                <Text style={st.code}>{item.client_code}.{item.job_code}</Text>
                {!!item.name && <Text style={st.name} numberOfLines={1}>{item.name}</Text>}
              </View>
              {!!item.programme_end && <Text style={st.ends}>ends {item.programme_end}</Text>}
              <Text style={st.chev}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}
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
  section: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  code: { color: C.ink, fontSize: 15, fontWeight: '700' },
  name: { color: C.muted, fontSize: 13, marginTop: 2 },
  ends: { color: C.muted, fontSize: 12, marginRight: 10 },
  chev: { color: C.muted, fontSize: 22, fontWeight: '300' },
});
