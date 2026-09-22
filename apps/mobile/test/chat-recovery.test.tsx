import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactTestInstance } from 'react-test-renderer';
import { ChatScreen } from '../src/screens/ChatScreen';
import App from '../App';
import { ChatError, type ChatMessage } from '../src/lib/ai';
import {
  actAsync,
  fire,
  hosts,
  renderScreen,
  switchTab,
  textContents,
} from './harness';
const calls = vi.hoisted(
  () =>
    [] as {
      history: ChatMessage[];
      signal: AbortSignal;
      resolve: (text: string) => void;
      reject: (error: unknown) => void;
    }[],
);
vi.mock('../src/lib/ai', async (original) => ({
  ...(await original<typeof import('../src/lib/ai')>()),
  sendChat: vi.fn(
    (history: ChatMessage[], { signal }: { signal: AbortSignal }) =>
      new Promise<string>((resolve, reject) =>
        calls.push({ history, signal, resolve, reject }),
      ),
  ),
}));
beforeEach(() => {
  calls.length = 0;
});
const button = (root: ReactTestInstance, label: string) =>
  hosts(root, 'TouchableOpacity').find(
    (n) => n.props.accessibilityLabel === label,
  )!;
const input = (root: ReactTestInstance) =>
  hosts(root, 'TextInput').find(
    (n) => n.props.accessibilityLabel === 'Chat message',
  )!;
async function send(root: ReactTestInstance, text = 'hello') {
  await fire(input(root), 'onChangeText', text);
  await fire(button(root, 'Send message'), 'onPress');
}
describe('chat recovery without hidden replay', () => {
  it('shows a timeout as a failed turn without retrying automatically', async () => {
    const { root } = await renderScreen(<ChatScreen />);
    await send(root);
    await actAsync(() => calls[0]!.reject(new ChatError('timeout')));
    expect(textContents(root).join(' ')).toContain(
      'No reply within 30 seconds.',
    );
    expect(button(root, 'Retry message')).toBeDefined();
    expect(calls).toHaveLength(1);
  });
  it('cancelling Clear leaves pending work and the conversation intact', async () => {
    const { root } = await renderScreen(<ChatScreen />);
    await send(root);
    await fire(button(root, 'Clear conversation'), 'onPress');
    await fire(button(root, 'Cancel clear conversation'), 'onPress');
    expect(calls[0]!.signal.aborted).toBe(false);
    expect(textContents(root)).toContain('hello');
    await actAsync(() => calls[0]!.resolve('reply'));
    expect(textContents(root)).toContain('reply');
  });
  it('blocks same-frame duplicate sends and commits each prompt exactly once', async () => {
    const { root } = await renderScreen(<ChatScreen />);
    await fire(input(root), 'onChangeText', 'hello');
    const submit = button(root, 'Send message').props.onPress;
    await actAsync(() => {
      submit();
      submit();
    });
    expect(calls).toHaveLength(1);
    await actAsync(() => calls[0]!.resolve('world'));
    expect(textContents(root).filter((t) => t === 'hello')).toHaveLength(1);
    expect(textContents(root)).toContain('world');
  });
  it('keeps failed prompts retryable, never sends errors, preserves a newer draft', async () => {
    const { root } = await renderScreen(<ChatScreen />);
    await send(root);
    await fire(input(root), 'onChangeText', 'next draft');
    await actAsync(() => calls[0]!.reject(new Error('PRIVATE_SERVER_ERROR')));
    expect(textContents(root).join(' ')).not.toContain('PRIVATE_SERVER_ERROR');
    expect(input(root).props.value).toBe('next draft');
    await fire(button(root, 'Retry message'), 'onPress');
    expect(calls[1]!.history).toEqual(calls[0]!.history);
    await actAsync(() => calls[1]!.resolve('done'));
    expect(textContents(root).filter((t) => t === 'hello')).toHaveLength(1);
    expect(input(root).props.value).toBe('next draft');
    await fire(button(root, 'Send message'), 'onPress');
    expect(calls[2]!.history.map((m) => m.text).slice(-3)).toEqual([
      'hello',
      'done',
      'next draft',
    ]);
  });
  it('a new prompt replaces an unsuccessful turn, not its error in history', async () => {
    const { root } = await renderScreen(<ChatScreen />);
    await send(root);
    await actAsync(() => calls[0]!.reject(new Error('secret')));
    await send(root, 'other');
    expect(calls[1]!.history.map((m) => m.text).slice(1)).toEqual(['other']);
  });
  it('Stop wins against a resolved microtask and an old result cannot replace a retry', async () => {
    const { root } = await renderScreen(<ChatScreen />);
    await send(root);
    await actAsync(() => {
      calls[0]!.resolve('late');
      button(root, 'Stop response').props.onPress();
    });
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(textContents(root)).not.toContain('late');
    await fire(button(root, 'Retry message'), 'onPress');
    await actAsync(() => calls[1]!.resolve('new'));
    expect(textContents(root)).toContain('new');
  });
  it('confirmable clear invalidates work, keeps the draft and ignores late output', async () => {
    const { root } = await renderScreen(<ChatScreen />);
    await send(root);
    await fire(input(root), 'onChangeText', 'keep me');
    await fire(button(root, 'Clear conversation'), 'onPress');
    expect(calls[0]!.signal.aborted).toBe(false);
    await fire(button(root, 'Confirm clear conversation'), 'onPress');
    expect(calls[0]!.signal.aborted).toBe(true);
    await actAsync(() => calls[0]!.resolve('stale'));
    expect(textContents(root)).not.toContain('stale');
    expect(textContents(root)).not.toContain('hello');
    expect(input(root).props.value).toBe('keep me');
  });
  it('aborts on true unmount but not when changing tabs', async () => {
    const app = await renderScreen(<App />);
    await switchTab(app.root, 'Chat');
    await send(app.root);
    await switchTab(app.root, 'Browse');
    expect(calls[0]!.signal.aborted).toBe(false);
    await actAsync(() => calls[0]!.resolve('background reply'));
    await switchTab(app.root, 'Chat');
    expect(textContents(app.root)).toContain('background reply');
    await send(app.root, 'pending');
    await actAsync(() => app.unmount());
    expect(calls[1]!.signal.aborted).toBe(true);
    await actAsync(() => calls[1]!.resolve('after unmount'));
  });
});
