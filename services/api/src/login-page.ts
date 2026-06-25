export function loginPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in — TronBrowser</title>
<style>
  :root{--bg:#05070d;--panel:#0b1020;--line:#1b2540;--cyan:#34e7ff;--fg:#cfe8ff;--muted:#6f86b3}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(1000px 500px at 50% -10%,#0a1430,var(--bg) 60%);color:var(--fg);
    font:15px/1.5 ui-monospace,Menlo,monospace;padding:20px}
  .card{width:100%;max-width:380px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:28px}
  .brand{font-size:26px;font-weight:800;text-align:center;color:#fff;text-shadow:0 0 16px var(--cyan)}
  .brand span{color:var(--cyan)}
  .sub{color:var(--muted);text-align:center;margin:6px 0 22px;font-size:13px}
  .cp{display:block;width:100%;background:var(--cyan);color:#04060c;border:0;border-radius:10px;
    padding:12px;font:inherit;font-weight:700;text-align:center;text-decoration:none;cursor:pointer}
  .or{display:flex;align-items:center;gap:10px;color:var(--muted);margin:18px 0;font-size:12px}
  .or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}
  label{display:block;color:var(--muted);font-size:12px;margin:10px 0 4px}
  input{width:100%;padding:10px;background:#04060c;color:var(--fg);border:1px solid var(--line);border-radius:8px;font:inherit}
  .row{display:flex;gap:8px;margin-top:14px}
  .row button{flex:1;background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit;cursor:pointer}
  .row button.primary{background:var(--cyan);color:#04060c;border:0;font-weight:700}
  .msg{margin-top:12px;font-size:13px;min-height:18px}
  .ok{color:var(--cyan)} .err{color:#ff8a9b}
  a{color:var(--cyan)}
</style></head>
<body>
  <div class="card">
    <div class="brand">Tron<span>Browser</span></div>
    <div class="sub">Anonymous by default. Email is optional.</div>
    <a class="cp" href="/api/auth/coinpay/login">Sign in with CoinPay</a>
    <div class="or">or email</div>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="email" />
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" />
    <div class="row">
      <button id="login" class="primary">Log in</button>
      <button id="signup">Sign up</button>
    </div>
    <div id="msg" class="msg"></div>
  </div>
  <script>
    const $=id=>document.getElementById(id);
    async function go(path){
      $('msg').textContent='…';$('msg').className='msg';
      const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},
        credentials:'include',body:JSON.stringify({email:$('email').value,password:$('password').value})});
      const d=await r.json().catch(()=>({}));
      if(r.ok){$('msg').textContent=d.message||'Signed in.';$('msg').className='msg ok';
        if(path.endsWith('login')) location.href='/api/auth/me';}
      else{$('msg').textContent=d.error||('error '+r.status);$('msg').className='msg err';}
    }
    $('login').onclick=()=>go('/api/auth/login');
    $('signup').onclick=()=>go('/api/auth/signup');
  </script>
</body></html>`;
}
