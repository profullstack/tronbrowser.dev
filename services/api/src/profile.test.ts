import { createClient } from '@libsql/client';
import { createProfileStore } from '@profullstack/profile';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { mountProfile, saveSignup, signupProfileErrors, SIGNUP_FIELDS_SCRIPT } from './profile.js';

// The package's store on an in-memory SQLite: what actually lands in user_profiles.
const store = createProfileStore(createClient({ url: 'file::memory:' }));
beforeAll(async () => {
  await store.migrate();
});

const SIGNUP = {
  email: 'Ada@Acme.com',
  password: 'x'.repeat(12),
  first_name: 'Ada',
  last_name: 'Lovelace',
  company_domain: 'https://www.acme.com/about',
  job_title: 'VP Engineering',
  linkedin_url: 'in/ada-lovelace',
};

describe('signup profile fields', () => {
  it('refuses a signup without a name before any account exists', () => {
    const invalid = signupProfileErrors({ email: 'ada@acme.com', password: 'x'.repeat(12) });
    expect(invalid).not.toBeNull();
    expect(Object.keys(invalid!.errors)).toEqual(expect.arrayContaining(['first_name', 'last_name']));
    expect(signupProfileErrors(SIGNUP)).toBeNull();
  });

  it('a signup with the fields stores them, normalized', async () => {
    await saveSignup(store, 'user-1', SIGNUP, SIGNUP.email);
    expect(await store.get('user-1')).toMatchObject({
      email: 'ada@acme.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      company_domain: 'acme.com',
      job_title: 'VP Engineering',
      linkedin_url: 'https://www.linkedin.com/in/ada-lovelace',
    });
  });

  it('the static login page gets the five fields from the package, not email', () => {
    for (const name of ['first_name', 'last_name', 'company_domain', 'job_title', 'linkedin_url']) {
      expect(SIGNUP_FIELDS_SCRIPT).toContain(`name=\\"${name}\\"`);
    }
    expect(SIGNUP_FIELDS_SCRIPT).not.toContain('name=\\"email\\"');
  });
});

describe('/api/v1/me/profile', () => {
  const app = new Hono();
  mountProfile(app, {
    currentUser: async (c: any) =>
      c.req.header('authorization') === 'Bearer ok' ? { id: 'user-1', email: 'ada@acme.com' } : null,
    store: () => store,
  });

  it('is 401 without a session', async () => {
    expect((await app.request('/api/v1/me/profile')).status).toBe(401);
  });

  it('reads and patches the owner profile', async () => {
    const got = await app.request('/api/v1/me/profile', { headers: { authorization: 'Bearer ok' } });
    expect((await got.json()).profile.job_title).toBe('VP Engineering');
    const patched = await app.request('/api/v1/me/profile', {
      method: 'PATCH',
      headers: { authorization: 'Bearer ok', 'content-type': 'application/json' },
      body: JSON.stringify({ job_title: 'CTO' }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).profile.job_title).toBe('CTO');
  });
});
