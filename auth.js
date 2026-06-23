// auth.js - ìì£¼ì£¼ìë§ì¼ ê³µíµ ì¸ì¦ ëª¨ë
// Google Identity Services (GIS) + WebAuthn (Face ID/ì§ë¬¸)

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
      <div class="auth-logo">ð</div>
      <div class="auth-title">ìì£¼ì£¼ìë§ì¼</div>
      <div class="auth-sub">Google ê³ì ì¼ë¡ ë¡ê·¸ì¸íì¸ì</div>
      <button class="btn-google" onclick="window._googleSignIn()">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google">
        Googleë¡ ë¡ê·¸ì¸
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
      <div class="auth-logo">ð</div>
      <div class="auth-title">ë¤ì ì¤ì¨êµ°ì!</div>
      <div class="auth-sub">ë¹ ë¥¸ ì¸ì¦ì¼ë¡ ì ìíì¸ì</div>
      <div class="user-email">${user.email}</div>
      <button class="btn-faceid" onclick="window._webAuthnSignIn()">Face ID / ì§ë¬¸ì¼ë¡ ì¸ì¦</button>
      <button class="btn-google-fallback" onclick="window._googleSignIn()">Google ê³ì ì¼ë¡ ì¬ë¡ê·¸ì¸</button>
      <div class="auth-status" id="authStatus">ì¸ì¦ ë²í¼ì ëë¬ì£¼ì¸ì</div>
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
      <div style="font-size:48px;margin-bottom:16px">ð«</div>
      <h2>ì ê·¼ ê¶í ìì</h2>
      <p>ì´ ì±ì ì ê·¼í  ê¶íì´ ììµëë¤.<br>Sheets ê³µì  ê¶íì íì¸í´ì£¼ì¸ì.</p>
      <button class="btn" onclick="window._googleSignIn()">ë¤ë¥¸ ê³ì ì¼ë¡ ë¡ê·¸ì¸</button>
    </div>
  `;
}

function _setStatus(msg) { const el = document.getElementById('authStatus'); if (el) el.textContent = msg; }
function _setError(msg) { const el = document.getElementById('authError'); if (el) { el.textContent = msg; el.style.display = 'block'; } }

window._googleSignIn = function() {
  _setStatus('Google ë¡ê·¸ì¸ ì¤...');
  google.accounts.oauth2.initTokenClient({
    client_id: AUTH_CONFIG.CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly email profile openid',
    callback: async (tokenResponse) => {
      if (tokenResponse.error) { _setStatus(''); _setError('ë¡ê·¸ì¸ ì¤í¨: ' + tokenResponse.error); return; }
      _setStatus('ê¶í íì¸ ì¤...');
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
      } catch(e) { _setStatus(''); _setError('ì¤ë¥: ' + e.message); }
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
        rp: { name: 'ìì£¼ì£¼ìë§ì¼', id: location.hostname },
        user: { id: new TextEncoder().encode(email), name: email, displayName: email },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'preferred', residentKey: 'preferred' },
        timeout: 60000,
      }
    });
    localStorage.setItem(AUTH_CONFIG.WEBAUTHN_KEY, btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
  } catch(e) { console.log('WebAuthn ë±ë¡ ê±´ëë:', e.message); }
}

window._webAuthnSignIn = async function() {
  _setStatus('ìì²´ ì¸ì¦ ì¤...');
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const credIdStr = localStorage.getItem(AUTH_CONFIG.WEBAUTHN_KEY);
    const opts = { publicKey: { challenge, rpId: location.hostname, userVerification: 'preferred', timeout: 60000 } };
    if (credIdStr) {
      const credIdBytes = Uint8Array.from(atob(credIdStr), c => c.charCodeAt(0));
      opts.publicKey.allowCredentials = [{ type: 'public-key', id: credIdBytes, transports: ['internal'] }];
    }
    await navigator.credentials.get(opts);
    const saved = JSON.parse(localStorage.getItem(AUTH_CONFIG.STORAGE_KEY) || '{}');
    _authState = { user: { email: saved.email, name: saved.name, picture: saved.picture }, token: null, role: saved.role || 'editor' };
    _onAuthSuccess(_authState);
  } catch(e) { _setStatus('ìì²´ ì¸ì¦ ì¤í¨. Google ë¡ê·¸ì¸ì ì¬ì©í´ì£¼ì¸ì.'); }
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
        resolve(_authState); return;
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
