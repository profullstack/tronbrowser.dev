// TronBrowser mobile companion (Expo / React Native).
// System-WebView browser + AI chat + agents + settings. This is the companion
// app, NOT the Ungoogled Chromium engine — see docs/mobile-architecture.md.
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BrowserScreen } from './src/screens/BrowserScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { AgentsScreen } from './src/screens/AgentsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { theme } from './src/theme';

type TabKey = 'browser' | 'chat' | 'agents' | 'settings';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'browser', label: 'Browse', icon: '🌐' },
  { key: 'chat', label: 'Chat', icon: '💬' },
  { key: 'agents', label: 'Agents', icon: '🤖' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  const [tab, setTab] = useState<TabKey>('browser');

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.screen}>
        {tab === 'browser' && <BrowserScreen />}
        {tab === 'chat' && <ChatScreen />}
        {tab === 'agents' && <AgentsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.tab}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={styles.tabIcon}>{t.icon}</Text>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    paddingBottom: 6,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 2 },
  tabIcon: { fontSize: 18 },
  tabLabel: { color: theme.textDim, fontSize: 11, fontWeight: '600' },
  tabLabelActive: { color: theme.accent },
});
