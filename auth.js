// auth.js - 안주 주식 시장 인증 모듈
// Google OAuth 2.0 Implicit Flow (Redirect 방식, 팝업 없음) + WebAuthn

const AUTH_CONFIG = {
  CLIENT_ID: '245414285873-fkhamod3vgam0viqpf4si2o7j3lqgrg3.apps.googleusercontent.com',
  SHEETS_ID: '1BNEAoqxn4ZuTG8ZqRNI23Nnjh7rY5xQDpJUHyCLl1KA',
  REDIRECT_URI: 'https://joojhong.github.io/anju-stock-market/',
  SCOPE: 'https://www.googleapis.com/auth/spreadsheets.readonly email profile openid',
  STORAGE_KEY: 'anju_auth',
  WEBAUTHN_KEY: 'anju_webauthn_cred',
  TOKEN_KEY: 'anju_token',
  STATE_KEY: 'anju_oauth_state',
};

let _authState = null;

// ─────────────────────────────────────────
// UI 렌더링 함수들
// ─────────────────────────────────────────

function _showAuthScreen(errorMsg) {
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
                    border-radius:12px; font-size:15px; font-weight:600; color:#333; cursor:pointer;
                    transition:all 0.2s; }
      .btn-google:hover { border-color:#1a1f2e; background:#f8f9fa; }
      .btn-google:active { transform:scale(0.98); }
      .btn-google img { width:20px; height:20px; }
      .auth-error { color:#e74c3c; font-size:13px; margin-top:16px; padding:10px;
                    background:#fff0f0; border-radius:8px; ${errorMsg ? '' : 'display:none;'} }
      .auth-note { font-size:11px; color:#bbb; margin-top:20px; }
    </style>
    <div class="auth-card">
      <div class="auth-logo">📊</div>
      <div class="auth-title">안주 주식 시장</div>
      <div class="auth-sub">Google 계정으로 로그인하세요</div>
      <button class="btn-google" onclick="window._startGoogleRedirect()">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google">
        Google로 로그인
      </button>
      <div class="auth-error" id="authError">${errorMsg || ''}</div>
      <div class="auth-note">로그인 후 홈 화면에 추가하면 앱처럼 사용할 수 있어요</div>
    </div>
  `;
}

function _showFaceIdScreen(saved) {
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
      .btn-biometric { width:100%; padding:16px; background:#1a1f2e; color:white;
                        border:none; border-radius:12px; font-size:16px; font-weight:700;
                        cursor:pointer; margin-bottom:12px; transition:all 0.2s; }
      .btn-biometric:hover { background:#2d3450; }
      .btn-biometric:active { transform:scale(0.98); }
      .btn-google-fallback { width:100%; padding:12px; background:white; border:2px solid #e0e0e0;
                              border-radius:12px; font-size:14px; color:#666; cursor:pointer;
                              transition:all 0.2s; }
      .btn-google-fallback:hover { border-color:#888; }
      .auth-status { margin-top:16px; font-size:13px; color:#aaa; min-height:20px; }
    </style>
    <div class="auth-card">
      <div class="auth-logo">🔐</div>
      <div class="auth-title">다시 만나요!</div>
      <div class="auth-sub">생체 인증으로 빠르게 로그인</div>
      <div class="user-email">${saved.email || ''}</div>
      <button class="btn-biometric" onclick="window._webAuthnSignIn()">
        🪪 Windows Hello / 지문 인증
      </button>
      <button class="btn-google-fallback" onclick="window._startGoogleRedirect()">
        Google 계정으로 다시 로그인
      </button>
      <div class="auth-status" id="authStatus">인증을 기다리는 중...</div>
    </div>
  `;
}

function _showLoadingScreen(msg) {
  document.body.innerHTML = `
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,sans-serif; background:#f0f2f5;
             display:flex; align-items:center; justify-content:center; min-height:100vh; flex-direction:column; gap:16px; }
      .spinner { font-size:48px; animation:spin 1s linear infinite; }
      @keyframes spin { to { transform:rotate(360deg); } }
      .msg { font-size:15px; color:#888; }
    </style>
    <div class="spinner">⏳</div>
    <div class="msg">${msg || '인증 처리 중...'}</div>
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
      .btn { margin-top:24px; padding:12px 24px; background:#f0f2f5; border:none;
             border-radius:10px; cursor:pointer; font-size:14px; }
    </style>
    <div class="card">
      <div style="font-size:48px;margin-bottom:16px">🚫</div>
      <h2>접근 권한 없음</h2>
      <p>이 계정은 안주 주식 시장에<br>접근 권한이 없습니다.<br>
         Sheets 공유 설정을 확인해주세요.</p>
      <button class="btn" onclick="window._startGoogleRedirect()">다른 계정으로 로그인</button>
    </div>
  `;
}

function _setStatus(msg) {
  const el = document.getElementById('authStatus');
  if (el) el.textContent = msg;
}

// ─────────────────────────────────────────
// Google OAuth Redirect (Implicit Flow)
// ─────────────────────────────────────────

window._startGoogleRedirect = function() {
  const state = (crypto.randomUUID ? crypto.randomUUID() :
    Math.random().toString(36).substring(2) + Date.now().toString(36));
  sessionStorage.setItem(AUTH_CONFIG.STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: AUTH_CONFIG.CLIENT_ID,
    redirect_uri: AUTH_CONFIG.REDIRECT_URI,
    response_type: 'token',
    scope: AUTH_CONFIG.SCOPE,
    state: state,
    prompt: 'select_account',
  });

  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
};

// ─────────────────────────────────────────
// OAuth 콜백 처리
// ─────────────────────────────────────────

async function _handleOAuthCallback() {
  const hash = window.location.hash.substring(1);
  if (!hash) return false;

  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const state = params.get('state');
  const error = params.get('error');

  if (error) {
    history.replaceState(null, '', window.location.pathname);
    _showAuthScreen('로그인 취소됨: ' + error);
    return true;
  }

  if (!accessToken) return false;

  // State 검증
  const savedState = sessionStorage.getItem(AUTH_CONFIG.STATE_KEY);
  sessionStorage.removeItem(AUTH_CONFIG.STATE_KEY);
  if (savedState && state && savedState !== state) {
    history.replaceState(null, '', window.location.pathname);
    _showAuthScreen('보안 오류: 다시 로그인해주세요.');
    return true;
  }

  history.replaceState(null, '', window.location.pathname);
  _showLoadingScreen('권한 확인 중...');

  try {
    const role = await _checkSheetsPermission(accessToken);
    if (role === 'none') { _showBlockedScreen(); return true; }

    const userInfo = await _getUserInfo(accessToken);
    const saved = { email: userInfo.email, name: userInfo.name, picture: userInfo.picture, role };
    localStorage.setItem(AUTH_CONFIG.STORAGE_KEY, JSON.stringify(saved));
    sessionStorage.setItem(AUTH_CONFIG.TOKEN_KEY, accessToken);

    _authState = { user: userInfo, token: accessToken, role };

    const hasCred = localStorage.getItem(AUTH_CONFIG.WEBAUTHN_KEY);
    if (!hasCred && window.PublicKeyCredential) {
      await _registerWebAuthn(userInfo.email);
    }

    _onAuthSuccess(_authState);
  } catch(e) {
    _showAuthScreen('오류: ' + e.message);
  }

  return true;
}

// ─────────────────────────────────────────
// Sheets 권한 확인
// ─────────────────────────────────────────

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
  if (!res.ok) throw new Error('유저 정보 조회 실패');
  return await res.json();
}

// ─────────────────────────────────────────
// WebAuthn 등록
// ─────────────────────────────────────────

async function _registerWebAuthn(email) {
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: '안주 주식 시장', id: location.hostname },
        user: { id: new TextEncoder().encode(email), name: email, displayName: email },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'preferred',
          residentKey: 'preferred'
        },
        timeout: 60000,
      }
    });
    localStorage.setItem(AUTH_CONFIG.WEBAUTHN_KEY,
      btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
    console.log('✅ WebAuthn 등록 완료');
  } catch(e) {
    console.log('WebAuthn 등록 건너뜀:', e.message);
  }
}

// ─────────────────────────────────────────
// WebAuthn 로그인
// ─────────────────────────────────────────

window._webAuthnSignIn = async function() {
  _setStatus('생체 인증 중...');
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const credIdStr = localStorage.getItem(AUTH_CONFIG.WEBAUTHN_KEY);
    const opts = {
      publicKey: {
        challenge,
        rpId: location.hostname,
        userVerification: 'preferred',
        timeout: 60000
      }
    };
    if (credIdStr) {
      const credIdBytes = Uint8Array.from(atob(credIdStr), c => c.charCodeAt(0));
      opts.publicKey.allowCredentials = [{ type: 'public-key', id: credIdBytes, transports: ['internal'] }];
    }
    await navigator.credentials.get(opts);

    const saved = _getSaved();
    _authState = {
      user: { email: saved.email, name: saved.name, picture: saved.picture },
      token: null,
      role: saved.role || 'editor'
    };
    _onAuthSuccess(_authState);
  } catch(e) {
    _setStatus('생체 인증 실패. Google 로그인으로 시도해주세요.');
  }
};

// ─────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────

function _getSaved() {
  try { return JSON.parse(localStorage.getItem(AUTH_CONFIG.STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function _onAuthSuccess(state) {
  if (typeof window.onAuthReady === 'function') {
    window.onAuthReady(state);
  }
}

// ─────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────

window.AUTH = {
  init: function() {
    return new Promise(async (resolve) => {

      // ① OAuth 콜백 처리 (redirect 후 복귀)
      if (window.location.hash.includes('access_token') || window.location.hash.includes('error=')) {
        window.onAuthReady = (state) => resolve(state);
        await _handleOAuthCallback();
        return;
      }

      // ② 세션 토큰 살아있으면 바로 진입
      const sessionToken = sessionStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
      if (sessionToken) {
        const saved = _getSaved();
        _authState = { user: saved, token: sessionToken, role: saved.role || 'editor' };
        resolve(_authState);
        _onAuthSuccess(_authState);
        return;
      }

      // ③ 저장된 유저 + WebAuthn 있으면 생체 인증 화면
      const saved = _getSaved();
      const hasCred = localStorage.getItem(AUTH_CONFIG.WEBAUTHN_KEY);

      window.onAuthReady = (state) => resolve(state);

      if (saved.email && hasCred && window.PublicKeyCredential) {
        _showFaceIdScreen(saved);
      } else {
        _showAuthScreen();
      }
    });
  },

  getState: () => _authState,
  isEditor: () => _authState && _authState.role === 'editor',
  isViewer: () => _authState && (_authState.role === 'editor' || _authState.role === 'viewer'),

  logout: function() {
    sessionStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEY);
    localStorage.removeItem(AUTH_CONFIG.WEBAUTHN_KEY);
    sessionStorage.removeItem(AUTH_CONFIG.STATE_KEY);
    _authState = null;
    location.reload();
  }
};
