import { describe, it, expect } from 'vitest';
import { NODE_TYPES } from './index.js';

describe('@tronbrowser/workflow-engine', () => {
  it('exposes the seven PRD node types', () => {
    expect(NODE_TYPES).toEqual([
      'prompt',
      'browser',
      'ai',
      'http',
      'conditional',
      'delay',
      'export',
    ]);
  });
});
