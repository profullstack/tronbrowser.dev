/** Shared visual tokens for the TronBrowser mobile companion. */
export const theme = {
  bg: '#05070d',
  surface: '#0b1020',
  surfaceAlt: '#111834',
  border: '#1c2545',
  text: '#ffffff',
  textDim: '#8a97c2',
  accent: '#34e7ff',
  accentDim: '#1b7f8f',
  danger: '#ff5470',
} as const;

export type Theme = typeof theme;
