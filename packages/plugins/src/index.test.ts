import { describe, it, expect } from 'vitest';
import { PLUGIN_LIFECYCLE } from './index.js';

describe('@tronbrowser/plugins', () => {
  it('defines the five PRD lifecycle phases in order', () => {
    expect(PLUGIN_LIFECYCLE).toEqual([
      'install',
      'enable',
      'disable',
      'update',
      'uninstall',
    ]);
  });
});
