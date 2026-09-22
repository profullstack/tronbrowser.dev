import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  CHAT_TIMEOUT_MS,
  ChatError,
  sendChat,
  type ChatFailure,
  type ChatMessage,
} from '../lib/ai';

const INITIAL: ChatMessage[] = [
  {
    id: 'sys-0',
    role: 'assistant',
    text: 'Hi — I’m your TronBrowser agent. Ask me anything.',
  },
];
type Turn =
  | { message: ChatMessage; state: 'pending' }
  | { message: ChatMessage; state: 'failed'; reason: ChatFailure };
const FAILURE_COPY: Record<ChatFailure, string> = {
  timeout: `No reply within ${CHAT_TIMEOUT_MS / 1000} seconds. The request may still have reached the service.`,
  cancelled: 'Stopped. The request may still have reached the service.',
  network: "Couldn't reach the assistant.",
  http: 'The assistant service returned an error.',
  invalid: "The assistant sent a reply this app couldn't read.",
};

/**
 * AI chat tab (PRD §Mobile). Wired to `../lib/ai`, which is the single seam
 * where the real model provider / `@tronbrowser/ai-core` gets plugged in.
 */
export function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL);
  const [draft, setDraft] = useState('');
  const [turn, setTurn] = useState<Turn | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const history = useRef(INITIAL);
  const generation = useRef(0);
  const nextId = useRef(0);
  const pending = useRef<{
    controller: AbortController;
    message: ChatMessage;
  } | null>(null);
  const busy = turn?.state === 'pending';
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const run = useCallback(async (message: ChatMessage) => {
    if (pending.current) return;
    const controller = new AbortController();
    const attempt = ++generation.current;
    pending.current = { controller, message };
    setTurn({ message, state: 'pending' });
    try {
      const text = await sendChat([...history.current, message], {
        signal: controller.signal,
      });
      if (attempt !== generation.current) return;
      history.current = [
        ...history.current,
        message,
        { id: `a-${++nextId.current}`, role: 'assistant', text },
      ];
      setMessages(history.current);
      setTurn(null);
    } catch (error) {
      if (attempt !== generation.current) return;
      setTurn({
        message,
        state: 'failed',
        reason: error instanceof ChatError ? error.kind : 'network',
      });
    } finally {
      if (pending.current?.controller === controller) pending.current = null;
    }
  }, []);

  const submit = () => {
    const text = draft.trim();
    if (!text || pending.current) return;
    setDraft('');
    void run({ id: `u-${++nextId.current}`, role: 'user', text });
  };
  const stop = () => {
    const request = pending.current;
    if (!request) {
      setTurn((current) =>
        current?.state === 'pending'
          ? { message: current.message, state: 'failed', reason: 'cancelled' }
          : current,
      );
      return;
    }
    generation.current++;
    pending.current = null;
    request.controller.abort();
    setTurn({ message: request.message, state: 'failed', reason: 'cancelled' });
  };
  const clear = () => {
    generation.current++;
    pending.current?.controller.abort();
    pending.current = null;
    history.current = INITIAL;
    setMessages(INITIAL);
    setTurn(null);
    setConfirmClear(false);
  };
  useEffect(
    () => () => {
      generation.current++;
      pending.current?.controller.abort();
      pending.current = null;
    },
    [],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.actions}>
        {confirmClear ? (
          <>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Confirm clear conversation"
              onPress={clear}
              style={styles.action}
            >
              <Text style={styles.actionText}>Confirm clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel clear conversation"
              onPress={() => setConfirmClear(false)}
              style={styles.action}
            >
              <Text style={styles.actionText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Clear conversation"
            disabled={messages.length === 1 && !turn}
            onPress={() => setConfirmClear(true)}
            style={styles.action}
          >
            <Text style={styles.actionText}>Clear conversation</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        ref={listRef}
        data={turn ? [...messages, turn.message] : messages}
        onContentSizeChange={() =>
          listRef.current?.scrollToEnd({ animated: true })
        }
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
      {turn && (
        <View style={styles.status}>
          <Text accessibilityRole="alert" style={styles.statusText}>
            {turn.state === 'pending'
              ? 'Waiting for reply...'
              : FAILURE_COPY[turn.reason]}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={busy ? 'Stop response' : 'Retry message'}
            accessibilityHint={busy ? undefined : 'Sends the message again.'}
            style={styles.action}
            onPress={
              busy
                ? stop
                : () => {
                    void run(turn.message);
                  }
            }
          >
            <Text style={styles.actionText}>{busy ? 'Stop' : 'Retry'}</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Chat message"
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder={busy ? 'Thinking…' : 'Message'}
          placeholderTextColor={theme.textDim}
          multiline
        />
        <TouchableOpacity
          style={[styles.send, (!draft.trim() || busy) && styles.sendDisabled]}
          onPress={submit}
          disabled={!draft.trim() || busy}
          accessibilityRole="button"
          accessibilityLabel="Send message"
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
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
  },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  actionText: { color: theme.accent, fontWeight: '600' },
  status: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: { color: theme.textDim, flex: 1, flexShrink: 1 },
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
