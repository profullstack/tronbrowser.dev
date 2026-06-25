// TronBrowser mobile (Phase 2) — Expo / React Native stub.
// Wire real screens (AI chat, sync, agent dashboard) once Phase 2 begins.
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.brand}>TronBrowser</Text>
      <Text style={styles.sub}>Mobile · Phase 2 (Expo)</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05070d', alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#ffffff', fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  sub: { color: '#34e7ff', marginTop: 8 },
});
