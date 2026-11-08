// Production (roles "production" and "production_manager") on the phone: two tabs — Czas pracy (the production
// time screen) and Wysyłki (loading the shipments: see ShipmentsScreen).
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { C } from '../lib/theme';
import TimeScreen from './TimeScreen';
import ShipmentsScreen from './ShipmentsScreen';

export default function ProductionShell() {
  const [tab, setTab] = useState<'time' | 'ship'>('time');
  return (
    <View style={s.fill}>
      <View style={s.tabs}>
        {([['time', 'Czas pracy'], ['ship', 'Wysyłki']] as const).map(([k, l]) => (
          <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)} activeOpacity={0.8}><Text style={[s.tabT, tab === k && s.tabTOn]}>{l}</Text></TouchableOpacity>
        ))}
      </View>
      {tab === 'time' ? <TimeScreen /> : <ShipmentsScreen />}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  tabs: { flexDirection: 'row', backgroundColor: C.soft, borderRadius: 12, padding: 4, gap: 4, marginHorizontal: 12, marginTop: 10 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabOn: { backgroundColor: C.white, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabT: { fontSize: 15, fontWeight: '700', color: C.muted },
  tabTOn: { color: C.purple, fontWeight: '800' },
});
