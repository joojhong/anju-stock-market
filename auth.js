// auth.js - 안주 주식 시장 인증 모듈
// Google OAuth 2.0 Implicit Flow (Redirect) + WebAuthn

const AUTH_CONFIG = {
  CLIENT_ID: '245414285873-fkhamod3vgam0viqpf4si2o7j3lqgrg3.apps.googleusercontent.com',
  REDIRECT_URI: 'https://joojhong.github.io/anju-stock-market/',
  SCOPE: 'email profile openid',
  STORAGE_KEY: 'anju_auth',
  WEBAUTHN_KEY: 'anju_webauthn_cred',
  TOKEN_KEY: 'anju_token',
  STATE_KEY: 'anju_oauth_state',
};

let _authState = null;

function _getBiometricLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return '🪪 Face ID / 지문 인증';
  if (/Android/i.test(ua)) return '🪪 지문 인증';
  return '🪪 Windows Hello / 지문 인증';
}

function _showAuthScreen(errorMsg) {
  document.body.innerHTML = `<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}.c{background:white;border-radius:20px;padding:40px 32px;max-width:360px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,.12);text-align:center}.logo{font-size:52px;margin-bottom:12px}.title{font-size:22px;font-weight:800;color:#1a1f2e;margin-bottom:6px}.sub{font-size:14px;color:#888;margin-bottom:32px}.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px 20px;background:white;border:2px solid #e0e0e0;border-radius:12px;font-size:15px;font-weight:600;color:#333;cursor:pointer}.btn img{width:20px;height:20px}.err{color:#e74c3c;font-size:13px;margin-top:16px;padding:10px;background:#fff0f0;border-radius:8px;${errorMsg?'':'display:none'}}</style><div class="c"><div class="logo">📊</div><div class="title">안주 주식 시장</div><div class="sub">Google 계정으로 로그인하세요</div><button class="btn" onclick="window._startGoogleRedirect()"><img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg">Google로 로그인</button><div class="err">${errorMsg||''}</div></div>`;
}

function _showFaceIdScreen(saved) {
  const lbl = _getBiometricLabel();
  document.body.innerHTML = `<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}.c{background:white;border-radius:20px;padding:40px 32px;max-width:360px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,.12);text-align:center}.logo{font-size:52px;margin-bottom:12px}.title{font-size:20px;font-weight:800;color:#1a1f2e;margin-bottom:6px}.sub{font-size:13px;color:#888;margin-bottom:8px}.email{font-size:13px;color:#6c63ff;font-weight:600;margin-bottom:28px}.b1{width:100%;padding:16px;background:#1a1f2e;color:white;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-bottom:12px}.b2{width:100%;padding:12px;background:white;border:2px solid #e0e0e0;border-radius:12px;font-size:14px;color:#666;cursor:pointer}.st{margin-top:16px;font-size:13px;color:#aaa;min-height:20px}</style><div class="c"><div class="logo">🔐</div><div class="title">다시 만나요!</div><div class="sub">생체 인증으로 빠르게 로그인</div><div class="email">${saved.email||''}</div><button class="b1" onclick="window._webAuthnSignIn()">${lbl}</button><button class="b2" onclick="window._startGoogleRedirect()">Google 계정으로 다시 로그인</button><div class="st" id="authStatus"></div></div>`;
}

function _showLoadingScreen(msg) {
  document.body.innerHTML = `<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px}.sp{font-size:48px;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.mg{font-size:15px;color:#888}</style><div class="sp">⏳</div><div class="mg">${msg||'처리 중...'}</div>`;
}

function _setStatus(msg) {
  const el = document.getElementById('authStatus');
  if (el) el.textContent = msg;
}

window._startGoogleRedirect = function() {
  const state = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now().toString(36);
  sessionStorage.setItem(AUTH_CONFIG.STATE_KEY, state);
  const p = new URLSearchParams({ client_id: AUTH_CONFIG.CLIENT_ID, redirect_uri: AUTH_CONFIG.REDIRECT_URI, response_type: 'token', scope: AUTH_CONFIG.SCOPE, state, prompt: 'select_account' });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
};

async function _handleOAuthCallback() {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  const p = new URLSearchParams(hash);
  const token = p.get('access_token'), state = p.get('state'), error = p.get('error');
  if (error) { history.replaceState(null,'',location.pathname); _showAuthScreen('로그인 취소: '+error); return true; }
  if (!token) return false;
  const ss = sessionStorage.getItem(AUTH_CONFIG.STATE_KEY);
  sessionStorage.removeItem(AUTH_CONFIG.STATE_KEY);
  if (ss && state && ss !== state) { history.replaceState(null,'',location.pathname); _showAuthScreen('보안 오류: 다시 로그인해주세요.'); return true; }
  history.replaceState(null,'',location.pathname);
  _showLoadingScreen('로그인 처리 중...');
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer '+token } });
    if (!r.ok) throw new Error('인증 실패 ('+r.status+')');
    const u = await r.json();
    if (!u.email) throw new Error('이메일 정보 없음');
    const saved = { email: u.email, name: u.name, picture: u.picture, role: 'editor' };
    localStorage.setItem(AUTH_CONFIG.STORAGE_KEY, JSON.stringify(saved));
    sessionStorage.setItem(AUTH_CONFIG.TOKEN_KEY, token);
    _authState = { user: u, token, role: 'editor' };
    if (!localStorage.getItem(AUTH_CONFIG.WEBAUTHN_KEY) && window.PublicKeyCredential) await _registerWebAuthn(u.email);
    _onAuthSuccess(_authState);
  } catch(e) { _showAuthScreen('오류: '+e.message); }
  return true;
}

async function _registerWebAuthn(email) {
  try {
    const ch = new Uint8Array(32); crypto.getRandomValues(ch);
    const cred = await navigator.credentials.create({ publicKey: { challenge: ch, rp: { name: '안주 주식 시장', id: location.hostname }, user: { id: new TextEncoder().encode(email), name: email, displayName: email }, pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'preferred', residentKey: 'preferred' }, timeout: 60000 } });
    localStorage.setItem(AUTH_CONFIG.WEBAUTHN_KEY, btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
  } catch(e) { console.log('WebAuthn 건너뜀:', e.message); }
}

window._webAuthnSignIn = async function() {
  _setStatus('인증 중...');
  try {
    const ch = new Uint8Array(32); crypto.getRandomValues(ch);
    const cs = localStorage.getItem(AUTH_CONFIG.WEBAUTHN_KEY);
    const opts = { publicKey: { challenge: ch, rpId: location.hostname, userVerification: 'preferred', timeout: 60000 } };
    if (cs) opts.publicKey.allowCredentials = [{ type: 'public-key', id: Uint8Array.from(atob(cs), c => c.charCodeAt(0)), transports: ['internal'] }];
    await navigator.credentials.get(opts);
    const sv = _getSaved();
    _authState = { user: { email: sv.email, name: sv.name, picture: sv.picture }, token: null, role: sv.role||'editor' };
    _onAuthSuccess(_authState);
  } catch(e) { _setStatus('인증 실패. Google 로그인을 이용해주세요.'); }
};

function _getSaved() { try { return JSON.parse(localStorage.getItem(AUTH_CONFIG.STORAGE_KEY)||'{}'); } catch { return {}; } }
function _onAuthSuccess(s) { if (typeof window.onAuthReady === 'function') window.onAuthReady(s); }

window.AUTH = {
  init() {
    return new Promise(async (resolve) => {
      if (location.hash.includes('access_token') || location.hash.includes('error=')) { window.onAuthReady = s => resolve(s); await _handleOAuthCallback(); return; }
      const st = sessionStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
      if (st) { const sv = _getSaved(); _authState = { user: sv, token: st, role: sv.role||'editor' }; resolve(_authState); _onAuthSuccess(_authState); return; }
      const sv = _getSaved();
      window.onAuthReady = s => resolve(s);
      if (sv.email && localStorage.getItem(AUTH_CONFIG.WEBAUTHN_KEY) && window.PublicKeyCredential) { _showFaceIdScreen(sv); } else { _showAuthScreen(); }
    });
  },
  getState: () => _authState,
  isEditor: () => _authState?.role === 'editor',
  isViewer: () => _authState && ['editor','viewer'].includes(_authState.role),
  logout() { [AUTH_CONFIG.TOKEN_KEY,AUTH_CONFIG.STORAGE_KEY,AUTH_CONFIG.WEBAUTHN_KEY,AUTH_CONFIG.STATE_KEY].forEach(k => { sessionStorage.removeItem(k); localStorage.removeItem(k); }); _authState = null; location.reload(); }
};
