import { URL as NodeURL, fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const mock = (file: string) =>
  fileURLToPath(new NodeURL(`./test/mocks/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Component tests render the real App/screens; only the native boundary is
    // swapped for controllable doubles (see test/mocks/*). The real react-native
    // sources are Flow-typed and need Metro/Babel, so they never load here.
    alias: {
      'react-native-webview': mock('react-native-webview.tsx'),
      'react-native-safe-area-context': mock('react-native-safe-area-context.tsx'),
      'react-native': mock('react-native.ts'),
      'expo-status-bar': mock('expo-status-bar.ts'),
      'expo-constants': mock('expo-constants.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
});
