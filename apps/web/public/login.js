// TronBrowser login — email/password against the same-origin /api. CoinPay is a
// plain link (full-page redirect through the OAuth flow).
const $ = (id) => document.getElementById(id);

// Sign up also asks for the shared profile fields (@profullstack/profile),
// written into #signup-fields by /api/v1/profile/signup-fields.js. Log in never does.
const PROFILE_FIELDS = ['first_name', 'last_name', 'company_domain', 'job_title', 'linkedin_url'];

function profileBody() {
  const out = {};
  for (const name of PROFILE_FIELDS) {
    const input = document.querySelector(`#signup-fields [name="${name}"]`);
    if (input) out[name] = input.value;
  }
  return out;
}

function markErrors(errors) {
  for (const input of document.querySelectorAll('#signup-fields input')) {
    if (errors && errors[input.name]) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

async function go(path) {
  $('msg').textContent = '…';
  $('msg').className = 'msg';
  const signup = path.endsWith('signup');
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      email: $('email').value,
      password: $('password').value,
      ...(signup ? profileBody() : {}),
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (signup) markErrors(d.errors);
  if (r.ok) {
    $('msg').textContent = d.message || 'Signed in.';
    $('msg').className = 'msg ok';
    if (path.endsWith('login')) location.href = '/';
  } else {
    $('msg').textContent = d.error || ('error ' + r.status);
    $('msg').className = 'msg err';
  }
}

$('login').onclick = () => go('/api/auth/login');
$('signup').onclick = () => {
  const fields = $('signup-fields');
  // First press shows the signup fields; the second sends them.
  if (fields.hidden) {
    fields.hidden = false;
    $('password').autocomplete = 'new-password';
    $('msg').textContent = 'Add your name, then press Sign up again.';
    $('msg').className = 'msg';
    document.querySelector('#signup-fields [name="first_name"]')?.focus();
    return;
  }
  go('/api/auth/signup');
};

// Surface notices (e.g. expired verification link).
const msg = new URLSearchParams(location.search).get('msg');
if (msg === 'link-expired') {
  $('msg').textContent = 'That verification link expired — log in, or sign up again to get a new one.';
  $('msg').className = 'msg err';
}
