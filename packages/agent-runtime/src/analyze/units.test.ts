import { describe, expect, it } from 'vitest';
import { dataLeaves, flattenData, getByPath } from './data.js';
import { canonical, matchField, MATCH_THRESHOLD, normalize } from './matching.js';
import { decideSubmit, fieldRisk, looksLikeChallenge, submitRisk } from './policy.js';

describe('data', () => {
  it('flattens nested objects to dot-paths', () => {
    expect(flattenData({ lead: { email: 'a@b.com', n: 2 } })).toEqual({ 'lead.email': 'a@b.com', 'lead.n': '2' });
  });
  it('resolves a path', () => {
    expect(getByPath({ lead: { email: 'a@b.com' } }, 'lead.email')).toBe('a@b.com');
    expect(getByPath({ lead: {} }, 'lead.missing')).toBeUndefined();
  });
});

describe('matching', () => {
  const leaves = dataLeaves({ lead: { name: 'Jane', email: 'jane@x.com', company: 'Acme', message: 'Hi' } });
  it('normalizes and canonicalizes synonyms', () => {
    expect(normalize('E-mail Address')).toBe('emailaddress');
    expect(canonical('emailaddress')).toBe('email');
    expect(canonical('organisation')).toBe('company');
  });
  it('matches by exact key, synonym, and label', () => {
    expect(matchField({ label: 'Email', name: 'email', placeholder: '', type: 'email' }, leaves).path).toBe('lead.email');
    expect(matchField({ label: 'Your e-mail', name: '', placeholder: '', type: 'text' }, leaves).path).toBe('lead.email');
    expect(matchField({ label: 'Organization', name: 'org', placeholder: '', type: 'text' }, leaves).path).toBe('lead.company');
  });
  it('returns low confidence for unrelated fields', () => {
    const m = matchField({ label: 'Favorite color', name: 'color', placeholder: '', type: 'text' }, leaves);
    expect(m.confidence).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe('policy', () => {
  it('flags credential/payment fields as high risk', () => {
    expect(fieldRisk('Password')).toBe('high');
    expect(fieldRisk('Card number')).toBe('high');
    expect(fieldRisk('CVV')).toBe('high');
    expect(fieldRisk('Email')).toBe('low');
  });
  it('rates submits: payment/irreversible = high, ordinary = medium', () => {
    expect(submitRisk('Pay now')).toBe('high');
    expect(submitRisk('Delete account')).toBe('high');
    expect(submitRisk('Send message')).toBe('medium');
  });
  it('detects challenges', () => {
    expect(looksLikeChallenge('Please complete the reCAPTCHA')).toBe(true);
    expect(looksLikeChallenge('Contact us')).toBe(false);
  });
  describe('decideSubmit', () => {
    const base = { policy: 'safe' as const };
    it('blocks without --allow-submit', () => {
      const d = decideSubmit('medium', { ...base, allowSubmit: false, noSubmit: false });
      expect(d.allowed).toBe(false);
      expect(d.blockedReason).toMatch(/--allow-submit/);
    });
    it('allows an ordinary submit with --allow-submit', () => {
      expect(decideSubmit('medium', { ...base, allowSubmit: true, noSubmit: false }).allowed).toBe(true);
    });
    it('never allows a high-risk submit', () => {
      expect(decideSubmit('high', { ...base, allowSubmit: true, noSubmit: false }).allowed).toBe(false);
    });
    it('respects --no-submit', () => {
      expect(decideSubmit('medium', { ...base, allowSubmit: true, noSubmit: true }).allowed).toBe(false);
    });
  });
});
