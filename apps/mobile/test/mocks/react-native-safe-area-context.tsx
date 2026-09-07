/**
 * Test double for `react-native-safe-area-context` (aliased in
 * vitest.config.ts) with settable inset values, so tests can prove the shell
 * actually consumes them. Set insets *before* rendering. Like the real
 * library, reading insets outside a SafeAreaProvider throws.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
let mockInsets: EdgeInsets = ZERO_INSETS;

export function setMockSafeAreaInsets(insets: EdgeInsets): void {
  mockInsets = insets;
}

export function resetMockSafeAreaInsets(): void {
  mockInsets = ZERO_INSETS;
}

const InsetsContext = createContext<EdgeInsets | null>(null);

export function SafeAreaProvider({ children }: { children?: ReactNode }) {
  return createElement(InsetsContext.Provider, { value: mockInsets }, children);
}

export function useSafeAreaInsets(): EdgeInsets {
  const insets = useContext(InsetsContext);
  if (insets === null) {
    throw new Error('No safe area value available. Render a SafeAreaProvider first.');
  }
  return insets;
}
