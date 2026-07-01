import { FlatList, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

/**
 * Agent dashboard (PRD §Mobile). Static sample data for now; wire to
 * `@tronbrowser/agent-runtime` / the cloud worker once endpoints exist.
 */
interface AgentRow {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'done' | 'error';
  detail: string;
}

const SAMPLE: AgentRow[] = [
  { id: '1', name: 'Price watcher', status: 'running', detail: 'Checking 4 sites…' },
  { id: '2', name: 'Inbox triage', status: 'idle', detail: 'Next run in 12m' },
  { id: '3', name: 'Research: EV batteries', status: 'done', detail: 'Report ready' },
];

const STATUS_COLOR: Record<AgentRow['status'], string> = {
  idle: theme.textDim,
  running: theme.accent,
  done: '#4ade80',
  error: theme.danger,
};

export function AgentsScreen() {
  return (
    <View style={styles.container}>
      <FlatList
        data={SAMPLE}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<Text style={styles.header}>Agents</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.name}>{item.name}</Text>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[item.status] }]} />
            </View>
            <Text style={styles.detail}>{item.detail}</Text>
            <Text style={[styles.status, { color: STATUS_COLOR[item.status] }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  list: { padding: 12, gap: 10 },
  header: { color: theme.text, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  detail: { color: theme.textDim, marginTop: 4 },
  status: { marginTop: 8, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
});
