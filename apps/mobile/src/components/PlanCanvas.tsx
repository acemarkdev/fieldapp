// A plan image with item pins drawn over it. Pin positions are stored normalised (0..1), so the
// same pin lands on the same spot at any display size.
import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { C } from '../lib/theme';

export interface CanvasPin { id: string; label: string; x: number; y: number; color: string }

export default function PlanCanvas({ url, width, pins, highlightId, onPinPress }: {
  url: string | null | undefined; width: number; pins: CanvasPin[];
  highlightId?: string | null; onPinPress?: (id: string) => void;
}) {
  const [aspect, setAspect] = useState(1.4); // width / height until the image reports its own
  useEffect(() => {
    if (url) Image.getSize(url, (w, h) => { if (w && h) setAspect(w / h); }, () => {});
  }, [url]);
  const height = Math.round(width / aspect);

  return (
    <View style={[s.wrap, { width, height }]}>
      {url
        ? <Image source={{ uri: url }} style={{ width, height }} resizeMode="contain" resizeMethod="resize" />
        : <View style={s.center}><Text style={s.empty}>Plan image unavailable offline.</Text></View>}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* the highlighted pin is drawn last so it sits on top of its neighbours */}
        {[...pins].sort((a, b) => Number(a.id === highlightId) - Number(b.id === highlightId)).map((p) => {
          const hi = p.id === highlightId;
          return (
            <Pressable key={p.id} hitSlop={8} disabled={!onPinPress || hi} onPress={() => onPinPress?.(p.id)}
              style={[hi ? s.pinHi : s.pin, { left: p.x * width, top: p.y * height }]}>
              <View style={[hi ? s.dotHi : s.dot, { backgroundColor: hi ? C.magenta : p.color }]} />
              <Text style={[s.lbl, hi && s.lblHi]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignSelf: 'center', borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { color: C.muted, textAlign: 'center', fontSize: 13 },
  pin: { position: 'absolute', transform: [{ translateX: -9 }, { translateY: -26 }], alignItems: 'center', opacity: 0.85 },
  pinHi: { position: 'absolute', transform: [{ translateX: -13 }, { translateY: -34 }], alignItems: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
  dotHi: { width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#fff' },
  lbl: { fontSize: 9, fontWeight: '800', color: '#fff', backgroundColor: C.ink, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, marginTop: 1, overflow: 'hidden' },
  lblHi: { fontSize: 11, backgroundColor: C.magenta },
});
