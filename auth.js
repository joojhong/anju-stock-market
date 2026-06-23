// auth.js - 안주주식마켓 공통 인증 모듈
// Google Identity Services (GIS) + WebAuthn (Face ID/지문)

const AUTH_CONFIG = {
  CLIENT_ID: '245414285873-fkhamod3vgam0viqpf4si2o7j3lqgrg3.apps.googleusercontent.com',
  SHEETS_ID: '1BNEAoqxn4ZuTG8ZqRNI23Nnjh7rY5xQDpJUHyCLl1KA',
  STORAGE_KEY: 'anju_auth',
  WEBAUTHN_KEY: 'anju_webauthn_cred',
  TOKEN_KEY: 'anju_token',
};

let _authState = null;

function _showAuthScreen() {
  document.body.innerHTML = `
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,sans-serif; background:#f0f2f5;
             display:flex; align-items:center; justify-content:center; min-height:100vh; }
      .auth-card { background:white; border-radius:20px; padding:40px 32px;
                   max-width:360px; width:90%; box-shadow:0 4px 24px rgba(0,0,0,0.12); text-align:center; }
      .auth-logo { font-size:52px; margin-bottom:12px; }
      .auth-title { font-size:22px; font-weight:800; color:#1a1f2e; margin-bottom:6px; }
      .auth-sub { font-size:14px; color:#888; margin-bottom:32px; }
      .btn-google { display:flex; align-items:center; justify-content:center; gap:10px;
                    width:100%; padding:14px 20px; background:white; border:2px solid #e0e0e0;
                    border-radius:12px; font-size:15px; font-weight:600; color:#333; cursor:pointer; }
      .btn-google:hover { border-color:#1a1f2e; background:#f8f9fa; }
      .btn-google img { width:20px; height:20px; }
      .auth-status { margin-top:20px; font-size:13px; color:#aaa; min-height:20px; }
      .auth-error { color:#e74c3c; font-size:13px; margin-top:16px; padding:10px;
                    background:#fff0f0; border-radius:8px; display:none; }
    </style>
    <div class="auth-card">
      <div class="auth-logo">📊</div>
      <div class="auth-title">안주주식마켓</div>
      <div class="auth-sub">Google 계정으로 로그인하세요</div>
      <button class="btn-google" onclick="window._googleSignIn()">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google">
        Google로 로그인
      </button>
      <div class="auth-status" id="authStatus"></div>
      <div class="auth-error" id="authError"></div>
    </div>
  `;
}

function _showFaceIdScreen(user) {
  document.body.innerHTML = `
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,sans-serif; background:#f0f2f5;
             display:flex; align-items:center; justify-content:center; min-height:100vh; }
      .auth-card { background:white; border-radius:20px; padding:40px 32px;
                   max-width:360px; width:90%; box-shadow:0 4px 24px rgba(0,0,0,0.12); text-align:center; }
      .auth-logo { font-size:52px; margin-bottom:12px; }
      .auth-title { font-size:20px; font-weight:800; color:#1a1f2e; margin-bottom:6px; }
      .auth-sub { font-size:13px; color:#888; margin-bottom:8px; }
      .user-email { font-size:13px; color:#6c63ff; font-weight:600; margin-bottom:28px; }
      .btn-faceid { width:100%; padding:14px; background:#1a1f2e; color:white;
                    border:none; border-radius:12px; font-size:16px; font-weight:700; cursor:pointer; margin-bottom:12px; }
      .btn-google-fallback { width:100%; padding:12px; background:white; border:2px solid #e0e0e0;
                              border-radius:12px; font-size:14px; color:#666; cursor:pointer; }
      .auth-status { margin-top:16px; font-size:13px; color:#aaa; }
    </style>
    <div class="auth-card">
      <div class="auth-logo">🔐</div>
      <div class="auth-title">다시 오셨군요!</div>
      <div class="auth-sub">빠른 인증으로 접속하세요</div>
      <div class="user-email">${user.email}</div>
      <button class="btn-faceid" onclick="window._webAuthnSignIn()">Face ID / 지문으로 인증</button>
      <button class="btn-google-fallback" onclick="window._googleSignIn()">Google 계정으로 재로그인</button>
      <div class="auth-status" id="authStatus">인증 버튼을 눌러주세요</div>
    </div>
  `;
}

function _showBlockedScreen() {
  document.body.innerHTML = `
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,sans-serif; background:#f0f2f5;
             display:flex; align-items:center; justify-content:center; min-height:100vh; }
      .card { background:white; border-radius:20px; padding:40px 32px;
              max-width:360px; width:90%; text-align:center; box-shadow:0 4px 24px rgba(0,0,0,0.12); }
      h2 { color:#1a1f2e; margin-bottom:10px; }
      p { color:#888; font-size:14px; line-height:1.6; }
      .btn { margin-top:24px; padding:12px 24px; background:#f0f2f5; border:none; border-radius:10px; cursor:pointer; font-size:14px; }
    </style>
    <div class="card">
      <div style="font-size:48px;margin-bottom:16px">🚫</div>
      <h2>접근 권한 없음</h2>
      <p>이 앱에 접근할 권한이 없습니다.<br>Sheets 공유 권한을 확인해주세요.</p>
      <button class="btn" onclick="window._googleSignIn()">다른 계정으로 로그인</button>
    </div>
  `;
}

function _setStatus(msg) { const el = document.getElementById('authStatus'); if (el) el.textContent = msg; }
function _setError(msg) { const el = document.getElementById('authError'); if (el) { el.textContent = msg; el.style.display = 'block'; } }

window._googleSignIn = function() {
  _setStatus('Google 로그인 중...');
  google.accounts.oauth2.initTokenClient({
    client_id: AUTH_CONFIG.CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly email profile openid',
    callback: async (tokenResponse) => {
      if (tokenResponse.error) { _setStatus(''); _setError('로그인 실패: ' + tokenResponse.error); return; }
      _setStatus('권한 확인 중...');
      const token = tokenResponse.access_token;
      try {
        const role = await _checkSheetsPermission(token);
        if (role === 'none') { _showBlockedScreen(); return; }
        const userInfo = await _getUserInfo(token);
        _authState = { user: userInfo, token, role };
        sessionStorage.setItem(AUTH_CONFIG.TOKEN_KEY, token);
        localStorage.setItem(AUTH_CONFIG.STORAGE_KEY, JSON.stringify({
          email: userInfo.email, name: userInfo.name, picture: userInfo.picture, role
        }));
        const hasCred = localStorage.getItem(AUTH_CONFIG.WEBAUTHN_KEY);
        if (!hasCred && window.PublicKeyCredential) await _registerWebAuthn(userInfo.email);
        _onAuthSuccess(_authState);
      } catch(e) { _setStatus(''); _setError('오류: ' + e.message); }
    }
  }).requestAccessToken();
};

async function _checkSheetsPermission(token) {
  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${AUTH_CONFIG.SHEETS_ID}?fields=spreadsheetId`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (res.status === 403 || res.status === 404) return 'none';
    if (!res.ok) return 'none';
    const data = await res.json();
    return data.spreadsheetId ? 'editor' : 'none';
  } catch(e) { return 'none'; }
}

async function _getUserInfo(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + token }
  });
  return await res.json();
}

async function _registerWebAuthn(email) {
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: '안주주식마켓', id: location.hostname },
        user: { id: new TextEncoder().encode(email), name: email, displayName: email },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'preferred', residentKey: 'preferred' },
        timeout: 10000,
      }
    });
    localStorage.setItem(AUTH_CONFIG.WEBAUTHN_KEY, btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
  } catch(e) { console.log('WebAuthn 등록 건너뜀:', e.message); }
}

window._webAuthnSignIn = async function() {
  _setStatus('생체 인증 중...');
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const credIdStr = localStorage.getItem(AUTH_CONFIG.WEBAUTHN_KEY);
    const opts = { publicKey: { challenge, rpId: location.hostname, userVerification: 'preferred', timeout: 10000 } };
    if (credIdStr) {
      const credIdBytes = Uint8Array.from(atob(credIdStr), c => c.charCodeAt(0));
      opts.publicKey.allowCredentials = [{ type: 'public-key', id: credIdBytes, transports: ['internal'] }];
    }
    await navigator.credentials.get(opts);
    const saved = JSON.parse(localStorage.getItem(AUTH_CONFIG.STORAGE_KEY) || '{}');
    _authState = { user: { email: saved.email, name: saved.name, picture: saved.picture }, token: null, role: saved.role || 'editor' };
    _onAuthSuccess(_authState);
  } catch(e) { _setStatus('생체 인증 실패. Google 로그인을 사용해주세요.'); }
};

function _onAuthSuccess(state) {
  if (typeof window.onAuthReady === 'function') window.onAuthReady(state);
  else location.reload();
}

window.AUTH = {
  init: function() {
    return new Promise((resolve) => {
      const token = sessionStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
      if (token) {
        const saved = JSON.parse(localStorage.getItem(AUTH_CONFIG.STORAGE_KEY) || '{}');
        _authState = { user: saved, token, role: saved.role || 'editor' };
        resolve(_authState);
        _onAuthSuccess(_authState);
        return;
      }
      const saved = JSON.parse(localStorage.getItem(AUTH_CONFIG.STORAGE_KEY) || '{}');
      const hasCred = localStorage.getItem(AUTH_CONFIG.WEBAUTHN_KEY);
      if (saved.email && hasCred) {
        _showFaceIdScreen(saved);
        window.onAuthReady = (state) => resolve(state); return;
      }
      _showAuthScreen();
      window.onAuthReady = (state) => resolve(state);
    });
  },
  getState: () => _authState,
  isEditor: () => _authState && _authState.role === 'editor',
  isViewer: () => _authState && (_authState.role === 'editor' || _authState.role === 'viewer'),
  logout: function() {
    sessionStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY);
    localStorage.removeItem(AUTH_CONFIG.WEBAUTHN_KEY);
    _authState = null; location.reload();
  }
};
