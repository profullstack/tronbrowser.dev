import Constants from 'expo-constants';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

/** Settings / sync / about (PRD §Mobile). */
export function SettingsScreen() {
  const version = Constants.expoConfig?.version ?? '—';
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>Settings</Text>

      <Section title="Sync">
        <Row label="Status" value="Not signed in" />
        <Row label="Backend" value="services/sync-server" muted />
      </Section>

      <Section title="Privacy">
        <Row label="Telemetry" value="Off (always)" />
        <Row label="Third-party cookies" value="Blocked in browser tab" />
      </Section>

      <Section title="Tor / .onion">
        <Text style={styles.note}>
          Tor routing is not in the companion app yet. On this system-WebView
          build it requires a native module (Android: Orbot/tor + SOCKS5; iOS:
          Tor.framework). Full-parity Tor lives in the desktop/Linux-phone and
          native-Android builds — see docs/mobile-architecture.md.
        </Text>
      </Section>

      <Section title="About">
        <Row label="Version" value={version} />
        <Text
          style={styles.link}
          onPress={() => Linking.openURL('https://tronbrowser.dev')}
        >
          tronbrowser.dev
        </Text>
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, muted && { color: theme.textDim }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 12, gap: 16 },
  header: { color: theme.text, fontSize: 22, fontWeight: '800' },
  section: { gap: 8 },
  sectionTitle: { color: theme.accent, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowLabel: { color: theme.textDim },
  rowValue: { color: theme.text, fontWeight: '600' },
  note: { color: theme.textDim, padding: 12, lineHeight: 20 },
  link: { color: theme.accent, paddingHorizontal: 12, paddingTop: 4, fontWeight: '700' },
});
