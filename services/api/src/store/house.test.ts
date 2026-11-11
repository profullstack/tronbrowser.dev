import { describe, it, expect } from 'vitest';
import { housePublishers, isHousePublisher } from './house.js';

describe('house publishers', () => {
  it('exempts nobody when unset or blank', () => {
    expect(housePublishers(undefined).size).toBe(0);
    expect(isHousePublisher('u1', '')).toBe(false);
    expect(isHousePublisher('u1', '   ')).toBe(false);
  });

  it('parses comma and whitespace separated ids', () => {
    const set = housePublishers(' a1, b2  c3,,\n d4 ');
    expect([...set]).toEqual(['a1', 'b2', 'c3', 'd4']);
    expect(isHousePublisher('c3', 'a1,c3')).toBe(true);
    expect(isHousePublisher('zz', 'a1,c3')).toBe(false);
  });

  it('never matches an empty user id', () => {
    expect(isHousePublisher('', 'a1')).toBe(false);
    expect(isHousePublisher(null, 'a1')).toBe(false);
  });
});
