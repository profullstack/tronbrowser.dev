// TronBrowser mobile companion (Expo / React Native).
// System-WebView browser + AI chat + agents + settings. This is the companion
// app, NOT the Ungoogled Chromium engine — see docs/mobile-architecture.md.
import { StatusBar } from 'expo-status-bar';
import { useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
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

// Inactive scenes are parked offscreen inside an overflow-hidden host instead
// of being unmounted (which destroys WebView history and chat state) or given
// `display: 'none'` (which Android can treat as a native detach). Same
// technique as react-navigation's ResourceSavingView.
const DETACHED_TOP = 100000;

function TabScene({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <View
      style={[styles.scene, { zIndex: active ? 0 : -1 }]}
      collapsable={false}
      pointerEvents={active ? 'auto' : 'none'}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!active}
    >
      <View style={[styles.sceneInner, !active && styles.sceneDetached]} collapsable={false}>
        {children}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

function AppShell() {
  const [tab, setTab] = useState<TabKey>('browser');
  // Android 15/16 enforce edge-to-edge: the app draws under the system bars,
  // so the toolbar and tab bar must pad themselves out of the way explicitly.
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      // Edge-to-edge Android windows do not reliably resize the absolute tab
      // scenes for the IME. Resize their shared root, including the tab bar.
      enabled={Platform.OS === 'android'}
      behavior={Platform.OS === 'android' ? 'height' : undefined}
      keyboardVerticalOffset={0}
      style={[
        styles.root,
        { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <StatusBar style="light" />
      <View style={styles.screen}>
        <TabScene active={tab === 'browser'}>
          <BrowserScreen isActive={tab === 'browser'} />
        </TabScene>
        <TabScene active={tab === 'chat'}>
          <ChatScreen />
        </TabScene>
        <TabScene active={tab === 'agents'}>
          <AgentsScreen />
        </TabScene>
        <TabScene active={tab === 'settings'}>
          <SettingsScreen />
        </TabScene>
      </View>
      <View style={[styles.tabBar, { paddingBottom: 6 + insets.bottom }]}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.tab}
              onPress={() => {
                if (t.key !== tab) Keyboard.dismiss();
                setTab(t.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={styles.tabIcon}>{t.icon}</Text>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  screen: { flex: 1 },
  scene: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  sceneInner: { flex: 1 },
  sceneDetached: { top: DETACHED_TOP },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 2 },
  tabIcon: { fontSize: 18 },
  tabLabel: { color: theme.textDim, fontSize: 11, fontWeight: '600' },
  tabLabelActive: { color: theme.accent },
});
