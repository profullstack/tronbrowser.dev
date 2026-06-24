import { describe, it, expect } from 'vitest';
import { SYNC_OBJECTS } from './index.js';

describe('@tronbrowser/sync', () => {
  it('syncs the five PRD object kinds', () => {
    expect([...SYNC_OBJECTS].sort()).toEqual(
      ['bookmarks', 'profiles', 'prompts', 'settings', 'workflows'].sort(),
    );
  });
});
