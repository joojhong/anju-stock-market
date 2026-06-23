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
