import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { supabase, configured } from '../lib/supabase';
import { C } from '../lib/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn() {
    setError('');
    if (!configured) { setError('App not configured — set EXPO_PUBLIC_SUPABASE_URL and _ANON_KEY.'); return; }
    if (!email || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError('Invalid email or password.');
    // On success, App's auth listener swaps to the main screens.
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <View style={s.card}>
        <Text style={s.brand}>ACE<Text style={s.brandB}>GROUP</Text></Text>
        <Text style={s.sub}>Field app — sign in</Text>

        <Text style={s.label}>Email</Text>
        <TextInput
          style={s.input} autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
          placeholder="you@acegroup-uk.com" placeholderTextColor="#9a97ad"
          value={email} onChangeText={setEmail}
        />
        <Text style={s.label}>Password</Text>
        <TextInput
          style={s.input} secureTextEntry placeholder="••••••••" placeholderTextColor="#9a97ad"
          value={password} onChangeText={setPassword}
        />

        <TouchableOpacity style={s.btn} onPress={signIn} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Sign in</Text>}
        </TouchableOpacity>
        {!!error && <Text style={s.error}>{error}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.purpleDark, alignItems: 'center', justifyContent: 'center', padding: 22 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 18, padding: 26 },
  brand: { fontSize: 24, fontWeight: '800', color: C.purple },
  brandB: { color: C.magenta },
  sub: { fontSize: 13, color: C.muted, marginTop: 4, marginBottom: 18 },
  label: { fontSize: 12, fontWeight: '700', color: C.ink, marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15, color: C.ink },
  btn: { backgroundColor: C.magenta, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  error: { color: '#dc2626', fontSize: 13, marginTop: 12, textAlign: 'center' },
});
