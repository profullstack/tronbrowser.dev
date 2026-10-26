import {
  COLUMNS,
  createProfileHandlers,
  createProfileStore,
  renderProfileFields,
  saveSignupProfile,
  validateProfile,
  type ProfileStore,
} from '@profullstack/profile';
import type { Hono } from 'hono';
import { db } from './db.js';

/**
 * The shared Profullstack profile (@profullstack/profile): email, first and
 * last name, company domain, job title and LinkedIn URL, in `user_profiles`.
 * Asked for on email signup only (never on log in, never for CoinPay accounts),
 * and readable/editable by the owner at /api/v1/me/profile.
 */

let _store: ProfileStore | null = null;
export function profileStore(): ProfileStore {
  _store ??= createProfileStore(db());
  return _store;
}

/** Signup shows the five fields beside the page's own email box. */
export const SIGNUP_FIELDS = COLUMNS.filter((f) => f !== 'email');

/**
 * Check a signup body's profile fields before any account exists. Returns the
 * error response body, or null when it is fine.
 */
export function signupProfileErrors(body: unknown): { error: string; errors: Record<string, string> } | null {
  const check = validateProfile(body as Record<string, unknown>);
  if (check.ok) return null;
  const errors = check.errors as Record<string, string>;
  return { error: Object.values(errors)[0] ?? 'Some fields need fixing.', errors };
}

/** Save them once the user exists. Logged, never fatal: the API can fill them later. */
export async function saveSignup(
  store: ProfileStore,
  userId: string,
  body: unknown,
  email: string,
): Promise<void> {
  try {
    await saveSignupProfile(store, userId, body as Record<string, unknown>, { email });
  } catch (e) {
    console.error('[signup] profile save failed:', (e as Error).message);
  }
}

/**
 * The login page is static, so its signup fields come from here: a same-origin
 * script (the CSP allows no inline script) that writes the package's own
 * markup into #signup-fields.
 */
export const SIGNUP_FIELDS_SCRIPT = `(()=>{const el=document.getElementById('signup-fields');if(el)el.innerHTML=${JSON.stringify(
  renderProfileFields({ fields: SIGNUP_FIELDS }),
)};})();\n`;

/** GET/PUT/PATCH /api/v1/me/profile plus the signup-fields script. */
export function mountProfile(
  app: Hono,
  { currentUser, store = profileStore }: { currentUser: (c: any) => Promise<{ id: string; email: string | null } | null>; store?: () => ProfileStore },
): void {
  let handlers: ReturnType<typeof createProfileHandlers> | null = null;
  const h = () =>
    (handlers ??= createProfileHandlers({
      store: store(),
      getUser: async (_req, c) => {
        const user = await currentUser(c);
        return user ? { id: user.id, email: user.email } : null;
      },
    }));
  app.get('/api/v1/me/profile', (c) => h().GET(c.req.raw, c));
  app.put('/api/v1/me/profile', (c) => h().PUT(c.req.raw, c));
  app.patch('/api/v1/me/profile', (c) => h().PATCH(c.req.raw, c));
  app.get('/api/v1/profile/signup-fields.js', (c) =>
    c.body(SIGNUP_FIELDS_SCRIPT, 200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
    }),
  );
}
