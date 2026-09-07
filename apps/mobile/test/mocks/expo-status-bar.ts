/** Test double for `expo-status-bar` (aliased in vitest.config.ts). */
import { createElement } from 'react';

export function StatusBar(props: Record<string, unknown>) {
  return createElement('StatusBar', props);
}
