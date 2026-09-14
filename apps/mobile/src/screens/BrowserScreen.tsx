import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { HOME, navigableHttpUrl, normalizeUrl } from '../lib/navigation';
import { theme } from '../theme';

/**
 * In-app browser tab.
 *
 * NOTE: this uses `react-native-webview`, i.e. the *system* engine — WebKit on
 * iOS (mandatory), the system WebView on Android. It is deliberately NOT the
 * Ungoogled Chromium engine (see docs/mobile-architecture.md — the engine ships
 * via the native Android build and the Linux-phone desktop build, not Expo).
 *
 * The screen stays mounted while other tabs are shown (App.tsx keeps every
 * scene alive), so `isActive` — not mount state — says whether this tab owns
 * the Android hardware Back button.
 */
export function BrowserScreen({ isActive = true }: { isActive?: boolean }) {
  const webRef = useRef<WebView>(null);
  const [address, setAddress] = useState(HOME);
  const [uri, setUri] = useState(HOME);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasFailed = failedUrl !== null;
  const [slowLoad, setSlowLoad] = useState(false);
  const editingRef = useRef(false);
  const currentUrlRef = useRef(HOME);
  const activeLoadRef = useRef(HOME);
  const cancelledUrlRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const supersededUrlsRef = useRef(new Set<string>());
  const [viewKey, setViewKey] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoadTimeout = () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };
  useEffect(() => () => clearLoadTimeout(), []);

  const beginLoad = (url: string) => {
    if (pendingRef.current && activeLoadRef.current !== url) supersededUrlsRef.current.add(activeLoadRef.current);
    // Stop ends the pending state, but its native callbacks may still arrive
    // after the user starts another page.
    if (cancelledUrlRef.current !== null && cancelledUrlRef.current !== url) {
      supersededUrlsRef.current.add(cancelledUrlRef.current);
    }
    supersededUrlsRef.current.delete(url);
    // Native events lack request IDs; retain only a bounded recent history.
    if (supersededUrlsRef.current.size > 16) {
      supersededUrlsRef.current.delete(supersededUrlsRef.current.values().next().value!);
    }
    activeLoadRef.current = url;
    cancelledUrlRef.current = null;
    pendingRef.current = true;
    setFailedUrl(null);
    setSlowLoad(false);
    setLoading(true);
    clearLoadTimeout();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      // A slow document may already be usable. Only the user may stop it.
      setSlowLoad(true);
    }, 30_000);
  };

  // Android system Back pops WebView history. Subscribe only while this tab is
  // the visible one AND there is history to pop; otherwise no handler exists at
  // all, so the event keeps its default meaning (leave the app) and a hidden
  // Browser tab can never swallow it.
  useEffect(() => {
    if (Platform.OS !== 'android' || !isActive || !canGoBack) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      supersededUrlsRef.current.clear();
      webRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [isActive, canGoBack]);

  const navigateTo = (next: string) => {
    const recovering = hasFailed;
    const reloadCurrent = next === currentUrlRef.current &&
      (!pendingRef.current || activeLoadRef.current === next);
    beginLoad(next);
    if (recovering) {
      // An error/interstitial may have no executable document. On iOS reload
      // after a provisional failure can reload the previous committed page.
      // Recreate only on explicit error recovery, accepting history loss here.
      setUri(next);
      setCanGoBack(false);
      setCanGoForward(false);
      supersededUrlsRef.current.clear();
      setViewKey(key => key + 1);
    } else if (reloadCurrent) {
      webRef.current?.reload();
    } else if (next === uri) {
      // The source prop can lag behind in-page navigation. Reassigning an
      // unchanged source does nothing; keep the native view and its history.
      webRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(next)});true;`);
    } else {
      setUri(next);
    }
    if (!editingRef.current) setAddress(next);
  };

  const go = () => {
    const next = normalizeUrl(address);
    editingRef.current = false;
    navigateTo(next);
    Keyboard.dismiss();
  };

  const reload = () => {
    if (failedUrl !== null) {
      navigateTo(failedUrl);
      return;
    }
    beginLoad(currentUrlRef.current);
    webRef.current?.reload();
  };

  const stop = () => {
    cancelledUrlRef.current = activeLoadRef.current;
    webRef.current?.stopLoading();
    pendingRef.current = false;
    clearLoadTimeout();
    setLoading(false);
    setSlowLoad(false);
  };

  const discardEdit = () => {
    editingRef.current = false;
    // Leaving the field without submitting cancels the draft, not navigation.
    setAddress(pendingRef.current ? activeLoadRef.current : currentUrlRef.current);
  };

  // Android hands `window.open` / `target="_blank"` to a detached WebView the
  // user never sees. Show those navigations in this single tab instead — but a
  // page-supplied URL only reaches `source` once validated as plain HTTP(S);
  // javascript:/data:/intent: targets are dropped.
  const openWindowInThisTab = (targetUrl: string) => {
    const next = navigableHttpUrl(targetUrl);
    if (!next) return;
    navigateTo(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <TouchableOpacity
          style={[styles.navBtn, !canGoBack && styles.navBtnDisabled]}
          onPress={() => { supersededUrlsRef.current.clear(); webRef.current?.goBack(); }}
          disabled={!canGoBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityState={{ disabled: !canGoBack }}
        >
          <Text style={styles.navBtnText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, !canGoForward && styles.navBtnDisabled]}
          onPress={() => { supersededUrlsRef.current.clear(); webRef.current?.goForward(); }}
          disabled={!canGoForward}
          accessibilityRole="button"
          accessibilityLabel="Forward"
          accessibilityState={{ disabled: !canGoForward }}
        >
          <Text style={styles.navBtnText}>›</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={address}
          onFocus={() => { editingRef.current = true; }}
          onBlur={discardEdit}
          onChangeText={(text) => {
            editingRef.current = true;
            setAddress(text);
          }}
          onSubmitEditing={go}
          submitBehavior="submit"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          placeholder="Search or enter address"
          placeholderTextColor={theme.textDim}
          selectTextOnFocus
        />
        <TouchableOpacity
          style={styles.navBtn}
          onPress={loading ? stop : reload}
          accessibilityRole="button"
          accessibilityLabel={loading ? 'Stop loading' : 'Reload'}
        >
          <Text style={styles.navBtnText}>{loading ? '×' : '⟳'}</Text>
        </TouchableOpacity>
      </View>
      {slowLoad && (
        <View style={styles.slowLoad} accessibilityRole="alert">
          <Text style={styles.slowText}>This page is taking longer to load.</Text>
          <TouchableOpacity style={styles.navBtn} onPress={() => setSlowLoad(false)}
            accessibilityRole="button" accessibilityLabel="Dismiss slow loading notice">
            <Text style={styles.navBtnText}>×</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.web}>
        {/* Keep the native page behind a real accessibility boundary on errors. */}
        <View style={styles.web} collapsable={false}
          accessibilityElementsHidden={hasFailed}
          importantForAccessibility={hasFailed ? 'no-hide-descendants' : 'auto'}
          pointerEvents={hasFailed ? 'none' : 'auto'}>
          <WebView
            key={viewKey}
            ref={webRef}
            source={{ uri }}
            style={styles.web}
            // Android also emits load-start for history updates after loading ends.
            // iOS emits start before allowing navigation, so retain its start flag.
            onLoadStart={({ nativeEvent }) => {
              // Completed Android history callbacks are not new network loads.
              if (Platform.OS === 'android' && !nativeEvent.loading) {
                return;
              }
              beginLoad(nativeEvent.url);
            }}
            onLoadEnd={({ nativeEvent }) => {
              if (supersededUrlsRef.current.has(nativeEvent.url)) return;
              pendingRef.current = false;
              clearLoadTimeout();
              setLoading(false);
              setSlowLoad(false);
              if (!('code' in nativeEvent) && nativeEvent.url !== cancelledUrlRef.current) {
                activeLoadRef.current = nativeEvent.url;
                currentUrlRef.current = nativeEvent.url;
                if (!editingRef.current) setAddress(nativeEvent.url);
              }
            }}
            onError={(event) => {
              // Own the error UI: the library's default ERROR overlay otherwise
              // hides the native view, including when a stale failure is ignored.
              event.preventDefault();
              const { url, code, description } = event.nativeEvent;
              if (supersededUrlsRef.current.has(url) || url === cancelledUrlRef.current) return;
              clearLoadTimeout();
              setSlowLoad(false);
              if ((Platform.OS === 'ios' && (code === -999 || code === 102)) || description?.includes('ERR_ABORTED')) {
                pendingRef.current = false;
                setLoading(false);
                return;
              }
              setLoading(false);
              pendingRef.current = false;
              setFailedUrl(url || activeLoadRef.current);
            }}
            onNavigationStateChange={(state) => {
              if (supersededUrlsRef.current.has(state.url)) return;
              if (!pendingRef.current && (state.loading === false || state.loading === undefined)) {
                currentUrlRef.current = state.url;
              }
              if (pendingRef.current) activeLoadRef.current = state.url;
              if (!editingRef.current) setAddress(state.url);
              setCanGoBack(state.canGoBack);
              setCanGoForward(state.canGoForward);
            }}
            onOpenWindow={(event) => openWindowInThisTab(event.nativeEvent.targetUrl)}
            // Privacy-leaning defaults consistent with the desktop ethos.
            thirdPartyCookiesEnabled={false}
            allowsInlineMediaPlayback
            pullToRefreshEnabled={Platform.OS === 'ios'}
          />
        </View>
        {loading && (
          <ActivityIndicator style={styles.spinner} color={theme.accent} size="small" />
        )}
        {hasFailed && (
          <View style={styles.error} accessibilityRole="alert" accessibilityViewIsModal>
            <Text style={styles.errorText}>This page did not finish loading.</Text>
            <TouchableOpacity style={styles.retry} onPress={reload}
              accessibilityRole="button" accessibilityLabel="Retry page">
              <Text style={styles.errorText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
    backgroundColor: theme.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceAlt,
  },
  navBtnDisabled: { opacity: 0.35 },
  navBtnText: { color: theme.accent, fontSize: 18, fontWeight: '700' },
  input: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: theme.text,
    backgroundColor: theme.surfaceAlt,
  },
  spinner: { position: 'absolute', top: 8, alignSelf: 'center', zIndex: 2 },
  web: { flex: 1, backgroundColor: theme.bg },
  slowLoad: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: theme.surface },
  slowText: { flex: 1, color: theme.text, fontSize: 14 },
  error: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center', gap: 16,
    padding: 24, backgroundColor: theme.bg,
  },
  errorText: { color: theme.text, fontSize: 16, textAlign: 'center' },
  retry: { paddingHorizontal: 24, paddingVertical: 12, backgroundColor: theme.surfaceAlt, borderRadius: 8 },
});
