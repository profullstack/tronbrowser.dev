import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { theme } from '../theme';
import { sendChat, type ChatMessage } from '../lib/ai';

/**
 * AI chat tab (PRD §Mobile). Wired to `../lib/ai`, which is the single seam
 * where the real model provider / `@tronbrowser/ai-core` gets plugged in.
 */
export function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'sys-0', role: 'assistant', text: 'Hi — I’m your TronBrowser agent. Ask me anything.' },
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text };
    setMessages((m) => [...m, userMsg]);
    setDraft('');
    setBusy(true);
    try {
      const reply = await sendChat([...messages, userMsg]);
      setMessages((m) => [...m, reply]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { id: `e-${Date.now()}`, role: 'assistant', text: `Error: ${(err as Error).message}` },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [draft, busy, messages]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === 'user' ? styles.userBubble : styles.aiBubble,
            ]}
          >
            <Text style={styles.bubbleText}>{item.text}</Text>
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder={busy ? 'Thinking…' : 'Message'}
          placeholderTextColor={theme.textDim}
          editable={!busy}
          multiline
        />
        <TouchableOpacity
          style={[styles.send, (!draft.trim() || busy) && styles.sendDisabled]}
          onPress={submit}
          disabled={!draft.trim() || busy}
        >
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  list: { padding: 12, gap: 8 },
  bubble: { maxWidth: '85%', padding: 10, borderRadius: 12 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: theme.accentDim },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: theme.surfaceAlt },
  bubbleText: { color: theme.text, fontSize: 15, lineHeight: 20 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    backgroundColor: theme.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    color: theme.text,
    backgroundColor: theme.surfaceAlt,
  },
  send: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent,
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: theme.bg, fontWeight: '800' },
});
