/**
 * Shared helpers for the component tests: render real screens with
 * react-test-renderer, drive their rendered props inside act(), and query the
 * host-element tree produced by the test doubles in ./mocks.
 */
import { act, type ReactElement } from 'react';
import TestRenderer, {
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { StyleSheet } from './mocks/react-native';

const liveRenderers: ReactTestRenderer[] = [];

/** Render inside act() so effects (BackHandler subscriptions etc.) run. */
export async function renderScreen(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  liveRenderers.push(renderer!);
  return renderer!;
}

/** Unmount everything a test rendered (called from test/setup.ts). */
export async function cleanupRenderers(): Promise<void> {
  while (liveRenderers.length > 0) {
    const renderer = liveRenderers.pop()!;
    await act(async () => {
      renderer.unmount();
    });
  }
}

/** Run any state-changing interaction (mock emissions included) inside act(). */
export async function actAsync(run: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await run();
  });
}

/** Invoke a rendered prop callback (onPress, onChangeText, …) inside act(). */
export async function fire(
  node: ReactTestInstance,
  prop: string,
  ...args: unknown[]
): Promise<void> {
  const handler = node.props[prop] as ((...handlerArgs: unknown[]) => unknown) | undefined;
  if (typeof handler !== 'function') {
    throw new Error(`rendered node has no ${prop} handler`);
  }
  await act(async () => {
    handler(...args);
  });
}

/** Host-element check: react-test-renderer types `type` too narrowly to ===. */
export function isHostType(node: ReactTestInstance, type: string): boolean {
  return (node.type as unknown) === type;
}

/** All host nodes of a native type name ('View', 'TextInput', …). */
export function hosts(root: ReactTestInstance, type: string): ReactTestInstance[] {
  return root.findAll((node) => isHostType(node, type));
}

/** Exactly one host node of `type` matching `predicate`, or a loud failure. */
export function hostWhere(
  root: ReactTestInstance,
  type: string,
  predicate: (node: ReactTestInstance) => boolean,
  description: string,
): ReactTestInstance {
  const matches = hosts(root, type).filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${description}, found ${matches.length}`);
  }
  return matches[0];
}

/** Flattened style object of a rendered node. */
export function flat(node: ReactTestInstance): Record<string, unknown> {
  return StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]);
}

/** Every plain-string Text content in the tree (chat bubbles, rows, labels). */
export function textContents(root: ReactTestInstance): string[] {
  return hosts(root, 'Text')
    .map((node) => node.props.children)
    .filter((children): children is string => typeof children === 'string');
}

/** The bottom-bar button for a tab, located by its visible label. */
export function tabButton(root: ReactTestInstance, label: string): ReactTestInstance {
  return hostWhere(
    root,
    'TouchableOpacity',
    (node) =>
      node.props.accessibilityRole === 'tab' &&
      node.findAll((text) => isHostType(text, 'Text') && text.props.children === label).length === 1,
    `tab "${label}"`,
  );
}

export async function switchTab(root: ReactTestInstance, label: string): Promise<void> {
  await fire(tabButton(root, label), 'onPress');
}

/** The four keep-mounted TabScene host views, in App.tsx tab order. */
export function scenes(root: ReactTestInstance): ReactTestInstance[] {
  return hosts(root, 'View').filter((node) => 'accessibilityElementsHidden' in node.props);
}
