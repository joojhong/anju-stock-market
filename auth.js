/**
 * auth.js - 안주주식마켓 인증 모듈
 *
 * iOS PWA 대응 전략:
 *  - sessionStorage: iOS PWA에서 앱 종료 후에도 유지됨 → 사용 안함
 *  - pagehide: iOS에서 hide 시각 기록이 불안정 → freeze/visibilitychange 병행
 *  - 잠금 판단: KEY_HIDE(숨긴 시각) vs KEY_BOOT(현재 실행 시각) 비교
 *
 * 잠금 규칙:
 *  - 최초 실행 → 구글 로그인
 *  - 앱 재실행 or 백그라운드 2분 이상 → PIN 요구
 *  - 백그라운드 2분 미만 → PIN 스킵
 *  - 페이지 이동(앱 내) → PIN 스킵
 *  - Google 토큰 만료 → PIN으로 해결 (구글 재로그인 불필요)
 */
(function () {
  'use strict';

  const CLIENT_ID    = '245414285873-fkhamod3vgam0viqpf4si2o7j3lqgrg3.apps.googleusercontent.com';
  const SHEET_ID     = '1BNEAoqxn4ZuTG8ZqRNI23Nnjh7rY5xQDpJUHyCLl1KA';
  const REDIRECT_URI = location.origin + '/anju-stock-market/';
  const SCOPE        = 'https://www.googleapis.com/auth/spreadsheets.readonly openid email profile';
  const BG_LOCK_MS   = 2 * 60 * 1000;

  const KEY_TOKEN  = 'anju_token';
  const KEY_EXPIRY = 'anju_expiry';
  const KEY_ROLE   = 'anju_role';
  const KEY_PIN    = 'anju_pin';
  const KEY_HIDE   = 'anju_hide';   // 마지막으로 숨긴 시각
  const KEY_BOOT   = 'anju_boot';   // 현재 앱 실행(boot) 시각
  const KEY_NAV    = 'anju_nav';    // 앱 내 페이지 이동 플래그 (localStorage)

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  const getToken     = () => localStorage.getItem(KEY_TOKEN);
  const getRole      = () => localStorage.getItem(KEY_ROLE);
  const getPin       = () => localStorage.getItem(KEY_PIN);
  const hasSession   = () => !!getRole();
  const isTokenValid = () => !!getToken() && Date.now() < parseInt(localStorage.getItem(KEY_EXPIRY)||'0',10);

  const saveHideTime  = () => localStorage.setItem(KEY_HIDE, String(Date.now()));
  const clearHideTime = () => localStorage.removeItem(KEY_HIDE);
  const getHideTime   = () => parseInt(localStorage.getItem(KEY_HIDE)||'0',10);

  // 앱 내 페이지 이동 감지
  // localStorage에 boot 시각을 기록하고, nav 플래그로 페이지 이동을 표시
  // boot 시각이 같은 nav 플래그만 유효 → 앱 재실행 시 boot 시각이 달라져서 무효화
  function isPageNav() {
    const nav = localStorage.getItem(KEY_NAV);
    const boot = localStorage.getItem(KEY_BOOT);
    if (!nav || !boot) return false;
    try {
      const parsed = JSON.parse(nav);
      return parsed.boot === boot;
    } catch(e) { return false; }
  }

  function markInApp() {
    const boot = localStorage.getItem(KEY_BOOT);
    if (boot) localStorage.setItem(KEY_NAV, JSON.stringify({boot}));
  }

  // 이번 실행의 boot 시각 기록 (init 시 최초 1회)
  function recordBoot() {
    // 이전 hide 기록이 있고 2분 미만이면 → 같은 세션(백그라운드 복귀)
    // 이전 hide 기록이 없거나 2분 이상이면 → 새 부팅
    const hide = getHideTime();
    const isSameSession = hide > 0 && (Date.now() - hide) < BG_LOCK_MS && isPageNav();
    if (!isSameSession) {
      // 새 부팅 → boot 시각 갱신, nav 플래그 초기화
      localStorage.setItem(KEY_BOOT, String(Date.now()));
      localStorage.removeItem(KEY_NAV);
    }
  }

  function isBgLocked() {
    const hide = getHideTime();
    return hide > 0 && (Date.now() - hide) >= BG_LOCK_MS;
  }

  function saveSession(token, expiresIn, role) {
    localStorage.setItem(KEY_TOKEN,  token);
    localStorage.setItem(KEY_EXPIRY, String(Date.now() + expiresIn * 1000));
    localStorage.setItem(KEY_ROLE,   role);
  }
  function clearSession() {
    [KEY_TOKEN, KEY_EXPIRY, KEY_ROLE, KEY_PIN, KEY_HIDE, KEY_BOOT, KEY_NAV].forEach(k => localStorage.removeItem(k));
  }

  function startGoogleLogin() {
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem('oauth_state', state);
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
      response_type: 'token', scope: SCOPE, state, prompt: 'select_account',
    });
  }

  function parseHashToken() {
    const hash = location.hash.slice(1);
    if (!hash) return null;
    const p = Object.fromEntries(new URLSearchParams(hash));
    if (!p.access_token) return null;
    const saved = sessionStorage.getItem('oauth_state');
    if (p.state && saved && p.state !== saved) return null;
    sessionStorage.removeItem('oauth_state');
    return { token: p.access_token, expiresIn: parseInt(p.expires_in || '3600', 10) };
  }

  async function checkSheetsRole(token) {
    try {
      const r = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=spreadsheetId`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      if (r.status === 200) return 'editor';
      if (r.status === 403) {
        const r2 = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/사용자!A1:A1`,
          { headers: { Authorization: 'Bearer ' + token } }
        );
        return r2.status === 200 ? 'viewer' : 'none';
      }
      return 'none';
    } catch { return 'none'; }
  }

  function injectStyles() {
    if (document.getElementById('auth-styles')) return;
    const s = document.createElement('style');
    s.id = 'auth-styles';
    s.textContent = `
      #auth-overlay{position:fixed;inset:0;z-index:9999;background:#f0f2f5;
        display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif}
      #auth-overlay .auth-card{background:white;border-radius:20px;padding:36px 28px;
        width:320px;max-width:90vw;box-shadow:0 4px 24px rgba(0,0,0,.10);text-align:center}
      #auth-overlay .auth-logo{font-size:48px;margin-bottom:12px}
      #auth-overlay .auth-title{font-size:20px;font-weight:800;color:#1a1f2e;margin-bottom:6px}
      #auth-overlay .auth-sub{font-size:13px;color:#888;margin-bottom:28px;line-height:1.5}
      #auth-overlay .btn-google{width:100%;padding:14px;background:#1a1f2e;color:white;border:none;
        border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;
        display:flex;align-items:center;justify-content:center;gap:10px}
      #auth-overlay .btn-google:active{opacity:.85}
      #auth-overlay .auth-msg{font-size:13px;color:#e74c3c;margin-top:14px;min-height:20px}
      #auth-overlay .pin-dots{display:flex;justify-content:center;gap:16px;margin:24px 0 20px}
      #auth-overlay .pin-dot{width:16px;height:16px;border-radius:50%;background:#e0e0e0;transition:background .15s}
      #auth-overlay .pin-dot.filled{background:#1a1f2e}
      #auth-overlay .pin-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
      #auth-overlay .pin-key{padding:16px 0;background:#f4f5f7;border:none;border-radius:12px;
        font-size:20px;font-weight:600;cursor:pointer;color:#1a1f2e}
      #auth-overlay .pin-key:active{background:#e0e2e5}
      #auth-overlay .pin-key.del{font-size:16px;color:#888}
      #auth-overlay .pin-key.wide{grid-column:span 3;padding:14px;margin-top:12px;font-size:14px;
        color:#888;width:100%;border:none;background:#f4f5f7;border-radius:12px;cursor:pointer}
      #auth-overlay .auth-spinner{width:36px;height:36px;border:3px solid #e0e0e0;
        border-top-color:#1a1f2e;border-radius:50%;animation:auth-spin .7s linear infinite;margin:20px auto}
      @keyframes auth-spin{to{transform:rotate(360deg)}}
      #viewer-banner{position:fixed;top:0;left:0;right:0;z-index:500;background:#fff3cd;
        color:#856404;font-size:12px;font-weight:600;text-align:center;
        padding:6px;border-bottom:1px solid #ffc107}
    `;
    document.head.appendChild(s);
  }

  function showOverlay(html) {
    injectStyles();
    let el = document.getElementById('auth-overlay');
    if (!el) { el = document.createElement('div'); el.id = 'auth-overlay'; document.body.appendChild(el); }
    el.innerHTML = `<div class="auth-card">${html}</div>`;
    el.style.display = 'flex';
  }
  const hideOverlay = () => { const el = document.getElementById('auth-overlay'); if (el) el.remove(); };

  const pinDots = () => '<div class="pin-dots">' +
    [0,1,2,3].map(i=>`<div class="pin-dot" id="d${i}"></div>`).join('') + '</div>';
  const updateDots = n => [0,1,2,3].forEach(i=>{
    const d=document.getElementById('d'+i); if(d) d.classList.toggle('filled',i<n);
  });
  function renderKeypad(onKey) {
    const g = document.getElementById('pg'); if (!g) return;
    g.innerHTML = ['1','2','3','4','5','6','7','8','9','','0','del'].map(k =>
      k==='' ? '<div></div>' :
      k==='del' ? `<button class="pin-key del" onclick="window.__ak('del')">⌫</button>` :
      `<button class="pin-key" onclick="window.__ak('${k}')">${k}</button>`
    ).join('');
    window.__ak = onKey;
  }

  function showLoginScreen() {
    showOverlay(`<div class="auth-logo">📊</div>
      <div class="auth-title">안주주식마켓</div>
      <div class="auth-sub">구글 계정으로 로그인하면<br>권한이 자동으로 확인돼요</div>
      <button class="btn-google" onclick="window.__auth_gl()"><span>🔑</span> Google 로그인</button>
      <div class="auth-msg"></div>`);
    window.__auth_gl = startGoogleLogin;
  }
  function showLoadingScreen(msg) {
    showOverlay(`<div class="auth-logo">📊</div>
      <div class="auth-title">안주주식마켓</div>
      <div class="auth-spinner"></div>
      <div class="auth-sub">${msg||'확인 중...'}</div>`);
  }
  function showNoAccessScreen() {
    showOverlay(`<div class="auth-logo">🚫</div>
      <div class="auth-title">접근 권한 없음</div>
      <div class="auth-sub">이 구글 계정은 안주주식마켓에<br>접근 권한이 없어요.</div>
      <button class="btn-google" onclick="window.__auth_retry()">다른 계정으로 로그인</button>`);
    window.__auth_retry = () => { clearSession(); startGoogleLogin(); };
  }

  function showPinSetupScreen(onDone) {
    let step='first', first='', cur='';
    const render = (msg='') => {
      showOverlay(`<div class="auth-logo">🔐</div>
        <div class="auth-title">${step==='first'?'PIN 설정':'PIN 확인'}</div>
        <div class="auth-sub">${step==='first'?'4자리 PIN을 설정해요':'같은 PIN을 다시 입력해주세요'}</div>
        ${pinDots()}<div class="pin-grid" id="pg"></div>
        <div class="auth-msg">${msg}</div>
        <button class="pin-key wide" onclick="window.__skip()">나중에 설정할게요</button>`);
      renderKeypad(onKey);
    };
    const onKey = v => {
      if (v==='del') cur=cur.slice(0,-1); else if (cur.length<4) cur+=v;
      updateDots(cur.length);
      if (cur.length===4) setTimeout(submit,100);
    };
    const submit = async () => {
      if (step==='first') { first=cur; cur=''; step='confirm'; render(); }
      else if (cur===first) { localStorage.setItem(KEY_PIN, await sha256(cur)); onDone(); }
      else { first=''; cur=''; step='first'; render('PIN이 달라요. 다시 설정해주세요.'); }
    };
    window.__skip = onDone;
    render();
  }

  function showPinUnlockScreen(onSuccess, onFail) {
    let cur='', tries=0;
    const render = (msg='') => {
      showOverlay(`<div class="auth-logo">🔒</div>
        <div class="auth-title">PIN 입력</div>
        <div class="auth-sub">4자리 PIN을 입력해주세요</div>
        ${pinDots()}<div class="pin-grid" id="pg"></div>
        <div class="auth-msg">${msg}</div>
        <button class="pin-key wide" onclick="window.__relogin()">구글 재로그인</button>`);
      renderKeypad(onKey);
      window.__relogin = () => { clearSession(); startGoogleLogin(); };
    };
    const onKey = v => {
      if (v==='del') cur=cur.slice(0,-1); else if (cur.length<4) cur+=v;
      updateDots(cur.length);
      if (cur.length===4) setTimeout(tryUnlock,100);
    };
    const tryUnlock = async () => {
      if (await sha256(cur)===getPin()) { onSuccess(); }
      else { tries++; cur=''; tries>=5 ? onFail() : render(`틀렸어요. ${5-tries}번 더 시도할 수 있어요.`); }
    };
    render();
  }

  function applyViewerRestrictions() {
    if (!document.getElementById('viewer-banner')) {
      const b=document.createElement('div'); b.id='viewer-banner';
      b.textContent='👀 조회 전용 모드 — 거래 입력 및 설정 변경이 불가해요';
      document.body.insertBefore(b,document.body.firstChild);
    }
    ['.save-btn','.del-ok-btn','.btn-del-trade','#btnSave','#btnManual','.btn-save-m','.btn-add','.btn-delete']
      .forEach(sel=>document.querySelectorAll(sel).forEach(btn=>{
        btn.disabled=true; btn.style.opacity='0.4'; btn.style.cursor='not-allowed';
      }));
  }

  function registerHideListeners() {
    // iOS PWA에서 확실히 동작하는 이벤트들 모두 등록
    const doHide = () => saveHideTime();
    window.addEventListener('pagehide',        doHide, {capture:true});
    window.addEventListener('freeze',          doHide, {capture:true}); // iOS 백그라운드 freeze
    document.addEventListener('visibilitychange', () => { if (document.hidden) doHide(); }, {capture:true});
    // blur: 앱 전환 시 발생
    window.addEventListener('blur', doHide, {capture:true});
  }

  function enterApp(role) {
    clearHideTime();
    hideOverlay();
    markInApp();
    if (role==='viewer') {
      const apply=()=>{
        applyViewerRestrictions();
        new MutationObserver(applyViewerRestrictions).observe(document.body,{childList:true,subtree:true});
      };
      document.readyState==='loading'?document.addEventListener('DOMContentLoaded',apply):apply();
    }
    registerHideListeners();
  }

  function proceedToApp(role) {
    if (!getPin()) { showPinSetupScreen(()=>enterApp(role)); return; }

    // 앱 내 페이지 이동 + 2분 미만 → PIN 스킵
    if (isPageNav() && !isBgLocked()) { enterApp(role); return; }

    // 그 외 → PIN 요구 (재실행, 2분 이상 백그라운드)
    clearHideTime();
    showPinUnlockScreen(()=>enterApp(role), ()=>{clearSession();startGoogleLogin();});
  }

  function warmupGAS() {
    try {
      const gasUrl = window.GAS_URL;
      if (gasUrl) fetch(gasUrl + '?action=ping', {method:'GET', cache:'no-store'}).catch(()=>{});
    } catch(e) {}
  }

  async function init() {
    injectStyles();
fix: iOS PWA PIN - freeze/blur events + localStorage boot flag
    const td = parseHashToken();
    if (td) {
      history.replaceState(null,'',location.pathname+location.search);
      showLoadingScreen('권한을 확인하는 중...');
      const role = await checkSheetsRole(td.token);
      if (role==='none') { showNoAccessScreen(); return; }
      saveSession(td.token, td.expiresIn, role);
      warmupGAS();
      proceedToApp(role);
      return;
    }
    if (hasSession()) { warmupGAS(); proceedToApp(getRole()); return; }
    clearSession();
    showLoginScreen();
  }

  document.readyState==='loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

  window.anjuAuth = {
    getRole, getToken,
    isEditor: ()=>getRole()==='editor',
    isViewer: ()=>getRole()==='viewer',
    logout: ()=>{clearSession();startGoogleLogin();},
  };
})();
