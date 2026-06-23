/**
 * auth.js - 안주주식마켓 인증 모듈
 *
 * 흐름:
 *  1) 첫 방문 → Google OAuth redirect
 *  2) 콜백 처리 → Sheets API로 권한 확인 (editor / viewer / none)
 *  3) 앱 진입 후 PIN 설정 안내
 *  4) 이후 방문 → PIN 입력으로 잠금 해제
 *  5) 백그라운드→포그라운드 전환 시 PIN 재요구
 */

(function () {
  'use strict';

  /* ── 상수 ─────────────────────────────────────────── */
  const CLIENT_ID   = '245414285873-fkhamod3vgam0viqpf4si2o7j3lqgrg3.apps.googleusercontent.com';
  const SHEET_ID    = '1BNEAoqxn4ZuTG8ZqRNI23Nnjh7rY5xQDpJUHyCLl1KA';
  const REDIRECT_URI = location.origin + '/anju-stock-market/';
  const SCOPE       = 'https://www.googleapis.com/auth/spreadsheets.readonly openid email profile';

  const KEY_TOKEN   = 'anju_token';
  const KEY_EXPIRY  = 'anju_expiry';
  const KEY_ROLE    = 'anju_role';
  const KEY_PIN     = 'anju_pin';
  const KEY_LOCKED  = 'anju_locked';

  /* ── 유틸 ─────────────────────────────────────────── */
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function getToken()  { return localStorage.getItem(KEY_TOKEN); }
  function getExpiry() { return parseInt(localStorage.getItem(KEY_EXPIRY) || '0', 10); }
  function getRole()   { return localStorage.getItem(KEY_ROLE); }
  function getPin()    { return localStorage.getItem(KEY_PIN); }
  function isLocked()  { return localStorage.getItem(KEY_LOCKED) === '1'; }

  function saveSession(token, expiresIn, role) {
    localStorage.setItem(KEY_TOKEN,  token);
    localStorage.setItem(KEY_EXPIRY, Date.now() + expiresIn * 1000);
    localStorage.setItem(KEY_ROLE,   role);
  }

  function clearSession() {
    [KEY_TOKEN, KEY_EXPIRY, KEY_ROLE, KEY_PIN, KEY_LOCKED].forEach(k => localStorage.removeItem(k));
  }

  function isTokenValid() {
    return !!getToken() && Date.now() < getExpiry();
  }

  /* ── OAuth redirect ────────────────────────────────── */
  function startGoogleLogin() {
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem('oauth_state', state);
    const params = new URLSearchParams({
      client_id:     CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      response_type: 'token',
      scope:         SCOPE,
      state:         state,
      prompt:        'select_account',
    });
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
  }

  /* ── 해시에서 토큰 파싱 ────────────────────────────── */
  function parseHashToken() {
    const hash = location.hash.slice(1);
    if (!hash) return null;
    const p = Object.fromEntries(new URLSearchParams(hash));
    if (!p.access_token) return null;
    const savedState = sessionStorage.getItem('oauth_state');
    if (p.state && savedState && p.state !== savedState) return null;
    sessionStorage.removeItem('oauth_state');
    return { token: p.access_token, expiresIn: parseInt(p.expires_in || '3600', 10) };
  }

  /* ── Sheets API로 권한 확인 ────────────────────────── */
  async function checkSheetsRole(token) {
    try {
      const resp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=spreadsheetId`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      if (resp.status === 200) return 'editor';
      if (resp.status === 403) {
        const resp2 = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/사용자!A1:A1`,
          { headers: { Authorization: 'Bearer ' + token } }
        );
        return resp2.status === 200 ? 'viewer' : 'none';
      }
      return 'none';
    } catch {
      return 'none';
    }
  }

  /* ── UI 빌더 ───────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('auth-styles')) return;
    const style = document.createElement('style');
    style.id = 'auth-styles';
    style.textContent = `
      #auth-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: #f0f2f5;
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, sans-serif;
      }
      #auth-overlay .auth-card {
        background: white; border-radius: 20px;
        padding: 36px 28px; width: 320px; max-width: 90vw;
        box-shadow: 0 4px 24px rgba(0,0,0,0.10);
        text-align: center;
      }
      #auth-overlay .auth-logo { font-size: 48px; margin-bottom: 12px; }
      #auth-overlay .auth-title {
        font-size: 20px; font-weight: 800; color: #1a1f2e; margin-bottom: 6px;
      }
      #auth-overlay .auth-sub {
        font-size: 13px; color: #888; margin-bottom: 28px; line-height: 1.5;
      }
      #auth-overlay .btn-google {
        width: 100%; padding: 14px;
        background: #1a1f2e; color: white;
        border: none; border-radius: 12px;
        font-size: 15px; font-weight: 700; cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 10px;
      }
      #auth-overlay .btn-google:active { opacity: 0.85; }
      #auth-overlay .auth-msg {
        font-size: 13px; color: #e74c3c; margin-top: 14px; min-height: 20px;
      }
      #auth-overlay .pin-dots {
        display: flex; justify-content: center; gap: 16px; margin: 24px 0 20px;
      }
      #auth-overlay .pin-dot {
        width: 16px; height: 16px; border-radius: 50%;
        background: #e0e0e0; transition: background 0.15s;
      }
      #auth-overlay .pin-dot.filled { background: #1a1f2e; }
      #auth-overlay .pin-grid {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
      }
      #auth-overlay .pin-key {
        padding: 16px 0; background: #f4f5f7; border: none; border-radius: 12px;
        font-size: 20px; font-weight: 600; cursor: pointer; color: #1a1f2e;
      }
      #auth-overlay .pin-key:active { background: #e0e2e5; }
      #auth-overlay .pin-key.del { font-size: 16px; color: #888; }
      #auth-overlay .pin-key.wide {
        grid-column: span 3; padding: 14px;
        font-size: 14px; color: #888;
      }
      #auth-overlay .auth-spinner {
        width: 36px; height: 36px; border: 3px solid #e0e0e0;
        border-top-color: #1a1f2e; border-radius: 50%;
        animation: auth-spin 0.7s linear infinite; margin: 20px auto;
      }
      @keyframes auth-spin { to { transform: rotate(360deg); } }
      #viewer-banner {
        position: fixed; top: 0; left: 0; right: 0; z-index: 500;
        background: #fff3cd; color: #856404;
        font-size: 12px; font-weight: 600;
        text-align: center; padding: 6px;
        border-bottom: 1px solid #ffc107;
      }
    `;
    document.head.appendChild(style);
  }

  function showOverlay(html) {
    injectStyles();
    let el = document.getElementById('auth-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'auth-overlay';
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="auth-card">${html}</div>`;
    el.style.display = 'flex';
  }

  function hideOverlay() {
    const el = document.getElementById('auth-overlay');
    if (el) el.remove();
  }

  /* ── 화면: 로그인 ──────────────────────────────────── */
  function showLoginScreen(msg) {
    showOverlay(`
      <div class="auth-logo">📊</div>
      <div class="auth-title">안주주식마켓</div>
      <div class="auth-sub">구글 계정으로 로그인하면<br>권한이 자동으로 확인돼요</div>
      <button class="btn-google" onclick="window.__auth_googleLogin()">
        <span>🔑</span> Google 로그인
      </button>
      <div class="auth-msg">${msg || ''}</div>
    `);
    window.__auth_googleLogin = startGoogleLogin;
  }

  /* ── 화면: 로딩 ────────────────────────────────────── */
  function showLoadingScreen(msg) {
    showOverlay(`
      <div class="auth-logo">📊</div>
      <div class="auth-title">안주주식마켓</div>
      <div class="auth-spinner"></div>
      <div class="auth-sub">${msg || '확인 중...'}</div>
    `);
  }

  /* ── 화면: 권한 없음 ───────────────────────────────── */
  function showNoAccessScreen() {
    showOverlay(`
      <div class="auth-logo">🚫</div>
      <div class="auth-title">접근 권한 없음</div>
      <div class="auth-sub">이 구글 계정은 안주주식마켓에<br>접근 권한이 없어요.<br><br>재홍님께 공유 요청을 해주세요.</div>
      <button class="btn-google" onclick="window.__auth_retry()">
        다른 계정으로 로그인
      </button>
    `);
    window.__auth_retry = () => { clearSession(); startGoogleLogin(); };
  }

  /* ── 키패드 렌더 ───────────────────────────────────── */
  function renderKeypad(containerId, onKey) {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    const keys = ['1','2','3','4','5','6','7','8','9','','0','del'];
    grid.innerHTML = keys.map(k => {
      if (k === '') return `<div></div>`;
      if (k === 'del') return `<button class="pin-key del" onclick="window.__auth_key('del')">⌫</button>`;
      return `<button class="pin-key" onclick="window.__auth_key('${k}')">${k}</button>`;
    }).join('');
    window.__auth_key = onKey;
  }

  /* ── 화면: PIN 설정 ────────────────────────────────── */
  function showPinSetupScreen(role, onDone) {
    let step = 'first';
    let firstPin = '';
    let current = '';

    function render(msg) {
      const title = step === 'first' ? 'PIN 설정' : 'PIN 확인';
      const sub   = step === 'first'
        ? '앱 잠금에 사용할 4자리 PIN을 설정해요'
        : '같은 PIN을 다시 입력해주세요';
      showOverlay(`
        <div class="auth-logo">🔐</div>
        <div class="auth-title">${title}</div>
        <div class="auth-sub">${sub}</div>
        <div class="pin-dots">
          <div class="pin-dot" id="d0"></div>
          <div class="pin-dot" id="d1"></div>
          <div class="pin-dot" id="d2"></div>
          <div class="pin-dot" id="d3"></div>
        </div>
        <div class="pin-grid" id="pinGrid"></div>
        <div class="auth-msg" id="pinMsg">${msg || ''}</div>
        <button class="pin-key wide" style="margin-top:12px;width:100%;" onclick="window.__auth_skipPin()">나중에 설정할게요</button>
      `);
      renderKeypad('pinGrid', onKey);
    }

    function updateDots() {
      for (let i = 0; i < 4; i++) {
        const d = document.getElementById('d' + i);
        if (d) d.classList.toggle('filled', i < current.length);
      }
    }

    function onKey(val) {
      if (val === 'del') { current = current.slice(0, -1); }
      else if (current.length < 4) { current += val; }
      updateDots();
      if (current.length === 4) setTimeout(submit, 100);
    }

    async function submit() {
      if (step === 'first') {
        firstPin = current; current = ''; step = 'confirm'; render();
      } else {
        if (current === firstPin) {
          const hash = await sha256(current);
          localStorage.setItem(KEY_PIN, hash);
          localStorage.removeItem(KEY_LOCKED);
          onDone();
        } else {
          firstPin = ''; current = ''; step = 'first';
          render('PIN이 달라요. 다시 설정해주세요.');
        }
      }
    }

    window.__auth_skipPin = onDone;
    current = '';
    render();
  }

  /* ── 화면: PIN 입력 (잠금 해제) ────────────────────── */
  function showPinUnlockScreen(onSuccess, onFail) {
    let current = '';
    let attempts = 0;

    function render(msg) {
      showOverlay(`
        <div class="auth-logo">🔒</div>
        <div class="auth-title">PIN 입력</div>
        <div class="auth-sub">4자리 PIN을 입력해주세요</div>
        <div class="pin-dots">
          <div class="pin-dot" id="d0"></div>
          <div class="pin-dot" id="d1"></div>
          <div class="pin-dot" id="d2"></div>
          <div class="pin-dot" id="d3"></div>
        </div>
        <div class="pin-grid" id="pinGrid"></div>
        <div class="auth-msg" id="pinMsg">${msg || ''}</div>
        <button class="pin-key wide" style="margin-top:12px;width:100%;" onclick="window.__auth_relogin()">구글 재로그인</button>
      `);
      renderKeypad('pinGrid', onKey);
      window.__auth_relogin = () => { clearSession(); startGoogleLogin(); };
    }

    function updateDots() {
      for (let i = 0; i < 4; i++) {
        const d = document.getElementById('d' + i);
        if (d) d.classList.toggle('filled', i < current.length);
      }
    }

    function onKey(val) {
      if (val === 'del') { current = current.slice(0, -1); }
      else if (current.length < 4) { current += val; }
      updateDots();
      if (current.length === 4) setTimeout(tryUnlock, 100);
    }

    async function tryUnlock() {
      const hash = await sha256(current);
      if (hash === getPin()) {
        localStorage.removeItem(KEY_LOCKED);
        onSuccess();
      } else {
        attempts++;
        current = '';
        if (attempts >= 5) {
          onFail();
        } else {
          render(`틀렸어요. ${5 - attempts}번 더 시도할 수 있어요.`);
        }
      }
    }

    current = '';
    render();
  }

  /* ── 뷰어 제한 ─────────────────────────────────────── */
  function applyViewerRestrictions() {
    if (!document.getElementById('viewer-banner')) {
      const banner = document.createElement('div');
      banner.id = 'viewer-banner';
      banner.textContent = '👀 조회 전용 모드 — 거래 입력 및 설정 변경이 불가해요';
      document.body.insertBefore(banner, document.body.firstChild);
      document.body.style.paddingTop = (parseInt(document.body.style.paddingTop || '0') + 32) + 'px';
    }
    const writeSelectors = [
      '.save-btn', '.del-ok-btn', '.btn-del-trade',
      '#btnSave', '#btnManual',
      '.btn-save-m', '.btn-add', '.btn-delete',
    ];
    writeSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(btn => {
        btn.disabled = true;
        btn.title = '조회 전용 모드';
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
      });
    });
  }

  /* ── 앱 진입 ───────────────────────────────────────── */
  function enterApp(role) {
    hideOverlay();
    if (role === 'viewer') {
      const apply = () => {
        applyViewerRestrictions();
        new MutationObserver(applyViewerRestrictions).observe(document.body, { childList: true, subtree: true });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
      else apply();
    }

    let hiddenAt = null;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        if (getPin()) localStorage.setItem(KEY_LOCKED, '1');
      } else {
        if (hiddenAt && Date.now() - hiddenAt > 2000 && getPin() && isLocked()) {
          showPinUnlockScreen(
            () => { hideOverlay(); },
            () => { clearSession(); startGoogleLogin(); }
          );
        }
        hiddenAt = null;
      }
    });
  }

  /* ── PIN 확인 후 진입 ──────────────────────────────── */
  function proceedToApp(role) {
    if (!getPin()) {
      showPinSetupScreen(role, () => enterApp(role));
    } else if (isLocked()) {
      showPinUnlockScreen(
        () => enterApp(role),
        () => { clearSession(); startGoogleLogin(); }
      );
    } else {
      enterApp(role);
    }
  }

  /* ── 메인 ──────────────────────────────────────────── */
  async function init() {
    injectStyles();

    const tokenData = parseHashToken();
    if (tokenData) {
      history.replaceState(null, '', location.pathname + location.search);
      showLoadingScreen('권한을 확인하는 중...');
      const role = await checkSheetsRole(tokenData.token);
      if (role === 'none') { showNoAccessScreen(); return; }
      saveSession(tokenData.token, tokenData.expiresIn, role);
      proceedToApp(role);
      return;
    }

    if (isTokenValid()) {
      proceedToApp(getRole());
      return;
    }

    clearSession();
    showLoginScreen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.anjuAuth = {
    getRole, getToken,
    isEditor: () => getRole() === 'editor',
    isViewer: () => getRole() === 'viewer',
    logout:   () => { clearSession(); startGoogleLogin(); },
  };

})();
