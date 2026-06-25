// TronBrowser login — email/password against the same-origin /api. CoinPay is a
// plain link (full-page redirect through the OAuth flow).
const $ = (id) => document.getElementById(id);

async function go(path) {
  $('msg').textContent = '…';
  $('msg').className = 'msg';
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email: $('email').value, password: $('password').value }),
  });
  const d = await r.json().catch(() => ({}));
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
$('signup').onclick = () => go('/api/auth/signup');
