import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  createUser, userByCoinpaySub, userByEmail, createSession, userBySession,
  deleteSession, putEmailToken, consumeEmailToken, setEmailVerified,
  getSettings, putSettings, type User,
} from './db.js';
import { token, uuid, hashPassword, verifyPassword, SESSION_TTL, EMAIL_TOKEN_TTL } from './auth.js';
import { sendEmail } from './email.js';
import { loginPage } from './login-page.js';

const CP = {
  clientId: process.env.COINPAY_CLIENT_ID || '',
  clientSecret: process.env.COINPAY_CLIENT_SECRET || '',
  redirectUri: process.env.COINPAY_REDIRECT_URI || 'https://tronbrowser.com/api/auth/coinpay/callback',
  authorizeUrl: process.env.COINPAY_AUTHORIZE_URL || 'https://coinpay.profullstack.com/oauth/authorize',
  tokenUrl: process.env.COINPAY_TOKEN_URL || 'https://coinpay.profullstack.com/oauth/token',
  userinfoUrl: process.env.COINPAY_USERINFO_URL || 'https://coinpay.profullstack.com/oauth/userinfo',
  scopes: ['wallet:read', 'payments:x402'],
};
const APP_URL = process.env.APP_URL || 'https://tronbrowser.dev';

const app = new Hono();
app.use('*', cors({ origin: (o) => o || '*', credentials: true }));

const cookieOpts = { httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/', maxAge: SESSION_TTL };

async function currentUser(c: any): Promise<User | null> {
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const sess = bearer || getCookie(c, 'tb_session');
  return sess ? userBySession(sess) : null;
}

async function startSession(c: any, userId: string, redirect?: string) {
  const sess = token();
  await createSession(sess, userId, SESSION_TTL);
  setCookie(c, 'tb_session', sess, cookieOpts);
  if (redirect) {
    const sep = redirect.includes('#') ? '&' : '#';
    return c.redirect(`${redirect}${sep}token=${sess}`);
  }
  return sess;
}

app.get('/healthz', (c) => c.json({ ok: true }));
app.get('/', (c) => c.redirect('/login'));
app.get('/login', (c) => c.html(loginPage()));

/* ---------- CoinPay OAuth (preferred) ---------- */
app.get('/api/auth/coinpay/login', (c) => {
  if (!CP.clientId) return c.text('CoinPay not configured', 500);
  const state = token();
  const redirect = c.req.query('redirect') || '';
  setCookie(c, 'cp_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 600 });
  setCookie(c, 'cp_redirect', redirect, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 600 });
  const u = new URL(CP.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', CP.clientId);
  u.searchParams.set('redirect_uri', CP.redirectUri);
  u.searchParams.set('scope', CP.scopes.join(' '));
  u.searchParams.set('state', state);
  return c.redirect(u.toString());
});

app.get('/api/auth/coinpay/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || state !== getCookie(c, 'cp_state')) return c.text('invalid oauth state', 400);
  const redirect = getCookie(c, 'cp_redirect') || '';

  const tokRes = await fetch(CP.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: CP.redirectUri,
      client_id: CP.clientId, client_secret: CP.clientSecret,
    }),
  });
  if (!tokRes.ok) return c.text('coinpay token exchange failed: ' + (await tokRes.text()), 502);
  const tok: any = await tokRes.json();

  let info: any = {};
  try {
    const r = await fetch(CP.userinfoUrl, { headers: { authorization: `Bearer ${tok.access_token}` } });
    if (r.ok) info = await r.json();
  } catch { /* ignore */ }
  const sub = info.sub || info.id || tok.sub;
  if (!sub) return c.text('coinpay userinfo missing subject', 502);

  let user = await userByCoinpaySub(String(sub));
  if (!user) {
    const id = uuid();
    await createUser({ id, authMethod: 'coinpay', coinpaySub: String(sub), email: info.email ?? null, emailVerified: !!info.email });
    user = { id, auth_method: 'coinpay', coinpay_sub: String(sub), email: info.email ?? null, email_verified: info.email ? 1 : 0 };
  }
  deleteCookie(c, 'cp_state'); deleteCookie(c, 'cp_redirect');
  const r = await startSession(c, user.id, redirect);
  return redirect ? r : c.redirect(`${APP_URL}/?signedin=1`);
});

/* ---------- Email + password ---------- */
app.post('/api/auth/signup', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!email || !password || password.length < 8) return c.json({ error: 'email and 8+ char password required' }, 400);
  if (await userByEmail(email)) return c.json({ error: 'email already registered' }, 409);
  const id = uuid();
  await createUser({ id, authMethod: 'password', email, passwordHash: hashPassword(password), emailVerified: false });
  const vtok = token();
  await putEmailToken(vtok, id, 'verify', EMAIL_TOKEN_TTL);
  const link = `${baseUrl(c)}/api/auth/verify?token=${vtok}`;
  await sendEmail(email, 'Verify your TronBrowser email', `<p>Welcome to TronBrowser. Confirm your email:</p><p><a href="${link}">${link}</a></p>`);
  return c.json({ ok: true, message: 'verification email sent' });
});

app.get('/api/auth/verify', async (c) => {
  const t = c.req.query('token');
  const userId = t ? await consumeEmailToken(t, 'verify') : null;
  if (!userId) return c.text('invalid or expired verification link', 400);
  await setEmailVerified(userId);
  await startSession(c, userId);
  return c.redirect(`${APP_URL}/?verified=1`);
});

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  const user = email ? await userByEmail(email) : null;
  if (!user || !verifyPassword(password || '', user.password_hash)) return c.json({ error: 'invalid credentials' }, 401);
  const sess = await startSession(c, user.id);
  return c.json({ ok: true, token: sess, emailVerified: !!user.email_verified });
});

app.post('/api/auth/logout', async (c) => {
  const sess = getCookie(c, 'tb_session');
  if (sess) await deleteSession(sess);
  deleteCookie(c, 'tb_session');
  return c.json({ ok: true });
});

app.get('/api/auth/me', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ signedIn: false });
  return c.json({ signedIn: true, id: user.id, authMethod: user.auth_method, email: user.email, emailVerified: !!user.email_verified });
});

/* ---------- Settings sync ---------- */
app.get('/v1/settings', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json(await getSettings(user.id));
});
app.put('/v1/settings', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  await putSettings(user.id, await c.req.json().catch(() => ({})));
  return c.json({ ok: true });
});

function baseUrl(c: any): string {
  return process.env.PUBLIC_URL || new URL(c.req.url).origin;
}

const port = Number(process.env.PORT || 8080);
serve({ fetch: app.fetch, port }, () => console.log(`tronbrowser api on :${port}`));
