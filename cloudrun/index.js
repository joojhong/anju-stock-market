'use strict';
/**
 * 안주주식마켓 백엔드 (Cloud Run)
 * Apps Script(Code.gs)와 같은 주소 형식(?action=...)을 그대로 지원해서
 * 화면(HTML) 쪽은 주소(GAS_URL)만 바꾸면 됩니다.
 *
 * 환경변수
 *   SPREADSHEET_ID  (필수) 구글 시트 ID
 *   CRON_SECRET     (선택) /cron/* 호출 보호용 비밀값
 *   EXTRA_EDITORS / EXTRA_VIEWERS (선택) checkRole 보조 허용 이메일(쉼표 구분)
 */
const http = require('http');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const PORT = process.env.PORT || 8080;
const TZ_OFFSET_MS = 9 * 3600 * 1000; // Asia/Seoul

const auth = new GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.metadata.readonly'
  ]
});

// ---------- 공통 유틸 ----------
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/' + SPREADSHEET_ID;

async function gapi(method, url, body) {
  const res = await auth.request({ url, method, data: body, retry: true });
  return res.data;
}

function q(name) { return encodeURIComponent("'" + name + "'"); }

// 쓰기 직렬화 (Apps Script LockService 대체) — max-instances=1 전제
let writeChain = Promise.resolve();
function withLock(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

// ---------- 캐시 (CacheService 대체, 메모리) ----------
const cache = new Map();
function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (e.exp < Date.now()) { cache.delete(k); return null; }
  return e.v;
}
function cachePut(k, v, sec) { cache.set(k, { v, exp: Date.now() + sec * 1000 }); }
function invalidateAll() {
  for (const k of Array.from(cache.keys())) if (!k.startsWith('readsheet_')) cache.delete(k);
}
function bumpReadSheet(name) { cache.delete('readsheet_' + name); }

// ---------- 시트 읽기/쓰기 ----------
function normalize(values) {
  const rows = values || [];
  let w = 0;
  rows.forEach(r => { if (r.length > w) w = r.length; });
  return rows.map(r => { const o = r.slice(); while (o.length < w) o.push(''); return o; });
}

async function readSheets(names) {
  const qs = names.map(n => 'ranges=' + q(n)).join('&');
  const d = await gapi('GET', SHEETS + '/values:batchGet?' + qs + '&valueRenderOption=UNFORMATTED_VALUE');
  const out = {};
  names.forEach((n, i) => { out[n] = normalize((d.valueRanges[i] || {}).values); });
  return out;
}
async function readSheet(name) { return (await readSheets([name]))[name]; }

async function appendRow(name, row) {
  return gapi('POST', SHEETS + '/values/' + q(name) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', { values: [row] });
}
async function setCell(name, row1, col1, value) {
  const a1 = colLetter(col1) + row1;
  return gapi('PUT', SHEETS + '/values/' + encodeURIComponent("'" + name + "'!" + a1) + '?valueInputOption=USER_ENTERED', { values: [[value]] });
}
function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

let sheetIdCache = null;
async function sheetId(name) {
  if (!sheetIdCache) {
    const d = await gapi('GET', SHEETS + '?fields=sheets.properties(sheetId,title)');
    sheetIdCache = {};
    d.sheets.forEach(s => { sheetIdCache[s.properties.title] = s.properties.sheetId; });
  }
  if (sheetIdCache[name] === undefined) throw new Error('sheet not found: ' + name);
  return sheetIdCache[name];
}
async function deleteRow(name, row1) {
  const id = await sheetId(name);
  return gapi('POST', SHEETS + ':batchUpdate', { requests: [{ deleteDimension: { range: { sheetId: id, dimension: 'ROWS', startIndex: row1 - 1, endIndex: row1 } } }] });
}

// ---------- 날짜 ----------
const pad2 = n => String(n).padStart(2, '0');
function serialToWallDate(serial) { return new Date(Math.round((serial - 25569) * 86400000)); } // UTC 필드 = 시트 시각
function serialToISO(serial) { return new Date(Math.round((serial - 25569) * 86400000) - TZ_OFFSET_MS).toISOString(); }
function serialToYmdSlash(serial) { const d = serialToWallDate(Math.floor(serial)); return d.getUTCFullYear() + '/' + pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate()); }
function nowKST() { return new Date(Date.now() + TZ_OFFSET_MS); }
function ymdSlashKST() { const d = nowKST(); return d.getUTCFullYear() + '/' + pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate()); }
function dateTimeKST() { const d = nowKST(); return ymdSlashKST() + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds()); }

// ---------- 보유 계산 (공통) ----------
function applyTrade(h, type, qty, price) {
  if (type === '매수') {
    h.총매수금액 += qty * price; h.보유수량 += qty; h.평균단가 = h.총매수금액 / h.보유수량;
  } else if (type === '매도') {
    h.총매수금액 -= qty * h.평균단가; h.보유수량 -= qty;
    if (h.보유수량 > 0) h.평균단가 = h.총매수금액 / h.보유수량;
  }
}

// ---------- 읽기 API ----------
async function getFilterOptions() {
  const ck = 'filters'; const c = cacheGet(ck); if (c) return c;
  const s = await readSheets(['사용자', '계좌', '금융기관', '상품']);
  const mapOf = rows => { const m = {}; for (let i = 1; i < rows.length; i++) if (rows[i][0]) m[rows[i][0]] = rows[i][1]; return m; };
  const 사용자맵 = mapOf(s['사용자']), 금융기관맵 = mapOf(s['금융기관']), 상품맵 = mapOf(s['상품']);
  const 사용자계좌맵 = {};
  const 계좌 = s['계좌'];
  for (let i = 1; i < 계좌.length; i++) {
    const [계좌ID, 사용자ID, 금융기관ID, 상품ID] = 계좌[i];
    if (!계좌ID || !사용자ID) continue;
    (사용자계좌맵[사용자ID] = 사용자계좌맵[사용자ID] || []).push({ 계좌ID, 레이블: (금융기관맵[금융기관ID] || 금융기관ID) + ' ' + (상품맵[상품ID] || 상품ID) });
  }
  const options = [{ value: '전체', label: '👥 전체' }];
  Object.keys(사용자계좌맵).forEach(userId => {
    options.push({ value: userId, label: '👤 ' + (사용자맵[userId] || userId) });
    사용자계좌맵[userId].forEach(a => options.push({ value: userId + '|' + a.계좌ID, label: ' ' + a.레이블 }));
  });
  cachePut(ck, options, 1800);
  return options;
}

async function getDashboardData(filter) {
  const 필터키 = filter || '전체';
  const ck = 'dashboard_' + 필터키; const c = cacheGet(ck); if (c) return c;
  const s = await readSheets(['거래내역', '종목', '사용자']);
  const 거래 = s['거래내역'], 종목 = s['종목'], 사용자 = s['사용자'];
  const parts = 필터키.split('|');
  const fUser = parts[0] === '전체' ? null : parts[0];
  const fAcc = parts.length > 1 ? parts[1] : null;

  const 종목맵 = {};
  for (let i = 1; i < 종목.length; i++) {
    종목맵[종목[i][0]] = { 종목명: 종목[i][1], 현재가: Number(종목[i][2]) || 0, 전일종가: Number(종목[i][3]) || 0 };
  }
  const 사용자목록 = [];
  for (let i = 1; i < 사용자.length; i++) if (사용자[i][0]) 사용자목록.push({ id: 사용자[i][0], name: 사용자[i][1] });

  const 보유맵 = {};
  for (let i = 1; i < 거래.length; i++) {
    const r = 거래[i];
    const 사용자ID = r[2], 계좌ID = r[3], 종목코드 = r[4], 유형 = r[5];
    const 수량 = Number(r[6]), 단가 = Number(r[7]);
    if (!사용자ID || !종목코드) continue;
    if (fUser && 사용자ID !== fUser) continue;
    if (fAcc && 계좌ID !== fAcc) continue;
    const k = 사용자ID + '_' + 계좌ID + '_' + 종목코드;
    if (!보유맵[k]) 보유맵[k] = { 종목코드, 보유수량: 0, 총매수금액: 0, 평균단가: 0 };
    applyTrade(보유맵[k], 유형, 수량, 단가);
  }

  const 종목별 = {};
  let 총평가액 = 0, 총매수금액 = 0, 전일합 = 0;
  Object.keys(보유맵).forEach(k => {
    const h = 보유맵[k];
    if (h.보유수량 <= 0) return;
    const 정보 = 종목맵[h.종목코드] || { 종목명: h.종목코드, 현재가: 0, 전일종가: 0 };
    const 평가액 = h.보유수량 * 정보.현재가;
    const 전일 = h.보유수량 * (정보.현재가 - 정보.전일종가);
    총평가액 += 평가액; 총매수금액 += h.총매수금액; 전일합 += 전일;
    const t = 종목별[h.종목코드] = 종목별[h.종목코드] || { 종목명: 정보.종목명, 현재가: 정보.현재가, 평가액: 0, 매수총액: 0, 전일: 0, 보유수량: 0 };
    t.평가액 += 평가액; t.매수총액 += h.총매수금액; t.전일 += 전일; t.보유수량 += h.보유수량;
  });

  const 손익금 = 총평가액 - 총매수금액;
  const 종목목록 = Object.keys(종목별).map(k => {
    const t = 종목별[k]; const 손익 = t.평가액 - t.매수총액;
    return {
      종목명: t.종목명, 현재가: t.현재가, 평가액: t.평가액, 손익금: 손익,
      손익률: t.매수총액 > 0 ? (손익 / t.매수총액 * 100) : 0,
      전일대비금액: t.전일,
      전일대비율: (t.평가액 - t.전일) > 0 ? (t.전일 / (t.평가액 - t.전일) * 100) : 0,
      보유수량: t.보유수량
    };
  }).sort((a, b) => b.평가액 - a.평가액);

  const 결과 = {
    통계: {
      총평가액, 손익금,
      손익률: 총매수금액 > 0 ? (손익금 / 총매수금액 * 100) : 0,
      전일대비금액: 전일합,
      전일대비율: (총평가액 - 전일합) > 0 ? (전일합 / (총평가액 - 전일합) * 100) : 0
    },
    종목목록, 사용자목록
  };
  cachePut(ck, 결과, 60);
  return 결과;
}

async function getSnapshotData() {
  const ck = 'snapshot'; const c = cacheGet(ck); if (c) return c;
  const data = await readSheet('스냅샷');
  if (!data.length) return [];
  const headers = data[0]; const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const obj = {};
    headers.forEach((h, j) => {
      let v = row[j];
      if (h === '날짜' && typeof v === 'number') v = serialToYmdSlash(v);
      obj[h] = v;
    });
    result.push(obj);
  }
  cachePut(ck, result, 300);
  return result;
}

async function getLabels() {
  const ck = 'labels'; const c = cacheGet(ck); if (c) return c;
  const s = await readSheets(['사용자', '금융기관', '상품', '종목']);
  const mapOf = rows => { const m = {}; for (let i = 1; i < rows.length; i++) if (rows[i][0]) m[rows[i][0]] = rows[i][1]; return m; };
  const 결과 = { 사용자: mapOf(s['사용자']), 금융기관: mapOf(s['금융기관']), 상품: mapOf(s['상품']), 종목: mapOf(s['종목']) };
  cachePut(ck, 결과, 1800);
  return 결과;
}

async function getMarketIndices() {
  let data;
  try { data = await readSheet('지수'); } catch (e) { return { error: '지수 시트 없음' }; }
  if (data.length < 2) return [];
  return data.slice(1).filter(r => r[0] !== '').map(r => {
    const rate = typeof r[1] === 'number' ? r[1] * 100 : parseFloat(String(r[1]).replace('%', ''));
    return { name: r[0], rate };
  });
}

async function readSheetAction(sheetName) {
  const TTL = { '계좌': 1800, '거래내역': 60 };
  const ttl = TTL[sheetName]; const ck = 'readsheet_' + sheetName;
  if (ttl) { const c = cacheGet(ck); if (c) return c; }
  let data;
  try { data = await readSheet(sheetName); } catch (e) { return { error: 'sheet not found: ' + sheetName }; }
  // Apps Script는 날짜 셀을 ISO 문자열로 내려줬음 → 같은 모양으로 맞춤
  const di = data.length ? data[0].indexOf('날짜') : -1;
  if (di >= 0) data.forEach((r, i) => { if (i > 0 && typeof r[di] === 'number') r[di] = serialToISO(r[di]); });
  const res = { result: 'success', data };
  if (ttl) cachePut(ck, res, ttl);
  return res;
}

// ---------- checkRole ----------
async function checkRole(email) {
  const target = String(email || '').toLowerCase();
  if (!target) return 'none';
  let perms = cacheGet('perms');
  if (!perms) {
    const d = await gapi('GET', 'https://www.googleapis.com/drive/v3/files/' + SPREADSHEET_ID + '/permissions?fields=permissions(emailAddress,role,type)&supportsAllDrives=true&pageSize=100');
    perms = (d.permissions || []).filter(p => p.type === 'user' && p.emailAddress);
    cachePut('perms', perms, 300);
  }
  const list = s => (s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const editors = perms.filter(p => ['owner', 'organizer', 'fileOrganizer', 'writer'].includes(p.role)).map(p => p.emailAddress.toLowerCase()).concat(list(process.env.EXTRA_EDITORS));
  const viewers = perms.filter(p => ['commenter', 'reader'].includes(p.role)).map(p => p.emailAddress.toLowerCase()).concat(list(process.env.EXTRA_VIEWERS));
  if (editors.includes(target)) return 'editor';
  if (viewers.includes(target)) return 'viewer';
  return 'none';
}

// ---------- 쓰기 ----------
const SHEET_MAP = { user: '사용자', institution: '금융기관', product: '상품', account: '계좌', stock: '종목' };
const PREFIX_MAP = { user: 'A', institution: 'B', product: 'D', account: 'C' };

async function rebuildHoldings() {
  const s = await readSheets(['거래내역']);
  const 거래 = s['거래내역']; const 보유맵 = {};
  for (let i = 1; i < 거래.length; i++) {
    const r = 거래[i]; const 사용자ID = r[2], 종목코드 = r[4];
    if (!사용자ID || !종목코드) continue;
    const k = 사용자ID + '_' + 종목코드;
    if (!보유맵[k]) 보유맵[k] = { 사용자ID, 종목코드, 보유수량: 0, 총매수금액: 0, 평균단가: 0 };
    applyTrade(보유맵[k], r[5], Number(r[6]), Number(r[7]));
  }
  const rows = [['사용자ID', '종목코드', '보유수량', '평균단가', '매수총액']];
  Object.keys(보유맵).forEach(k => { const h = 보유맵[k]; if (h.보유수량 > 0) rows.push([h.사용자ID, h.종목코드, h.보유수량, h.평균단가, h.총매수금액]); });
  await gapi('POST', SHEETS + '/values/' + q('보유종목') + ':clear', {});
  await gapi('PUT', SHEETS + '/values/' + encodeURIComponent("'보유종목'!A1") + '?valueInputOption=USER_ENTERED', { values: rows });
}

async function addTrading(b) {
  const data = await readSheet('거래내역');
  let maxId = 0;
  for (let i = 1; i < data.length; i++) {
    const rid = String(data[i][0] || '').replace(/[^0-9]/g, '');
    if (rid) maxId = Math.max(maxId, parseInt(rid, 10));
  }
  const newId = 'T' + String(maxId + 1).padStart(3, '0');
  await appendRow('거래내역', [newId, b['날짜'] || ymdSlashKST(), b['사용자ID'] || '', b['금융기관ID'] || '', b['종목코드'] || '', b['거래유형'] || '', b['수량'] || 0, b['단가'] || 0, b['금액'] || 0, b['상품ID'] || '']);
  invalidateAll(); bumpReadSheet('거래내역');
  return { result: 'success', id: newId };
}

async function deleteTrading(b) {
  const data = await readSheet('거래내역');
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === b.id) {
      await deleteRow('거래내역', i + 1);
      invalidateAll(); bumpReadSheet('거래내역');
      return { result: 'success', message: b.id + ' 삭제 완료' };
    }
  }
  return { result: 'error', message: '해당 ID를 찾을 수 없습니다: ' + b.id };
}

async function addSetting(b) {
  const category = b.category || '';
  const sheetName = SHEET_MAP[category];
  if (!sheetName) return { result: 'error', message: '알 수 없는 카테고리: ' + category };
  const data = await readSheet(sheetName);

  if (category === 'stock') {
    const code = b.id || '', name = b.name || '';
    if (!code || !name) return { result: 'error', message: '종목코드와 종목명 필요' };
    for (let i = 1; i < data.length; i++) if (data[i][0] === code) return { result: 'error', message: '이미 존재하는 종목코드: ' + code };
    await appendRow(sheetName, [code, name, '=GOOGLEFINANCE("' + code + '","price")', '=GOOGLEFINANCE("' + code + '","closeyest")']);
    invalidateAll();
    return { result: 'success', id: code };
  }

  const prefix = PREFIX_MAP[category] || 'X';
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const rid = String(data[i][0] || '');
    if (rid.startsWith(prefix)) { const n = parseInt(rid.substring(1), 10); if (!isNaN(n)) maxNum = Math.max(maxNum, n); }
  }
  const newId = prefix + String(maxNum + 1).padStart(3, '0');
  if (category === 'account') {
    await appendRow(sheetName, [newId, b.user || '', b.bank || '', b.product || '']);
    invalidateAll(); bumpReadSheet('계좌');
  } else {
    await appendRow(sheetName, [newId, b.name || '']);
    invalidateAll();
  }
  return { result: 'success', id: newId };
}

async function updateSetting(b) {
  const category = b.category || '';
  const sheetName = SHEET_MAP[category];
  if (!sheetName) return { result: 'error', message: '알 수 없는 카테고리: ' + category };
  const data = await readSheet(sheetName);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(b.id)) {
      if (category === 'account') {
        if (b.user) await setCell(sheetName, i + 1, 2, b.user);
        if (b.bank) await setCell(sheetName, i + 1, 3, b.bank);
        if (b.product) await setCell(sheetName, i + 1, 4, b.product);
      } else {
        await setCell(sheetName, i + 1, 2, b.name || '');
      }
      invalidateAll();
      if (category === 'account') bumpReadSheet('계좌');
      return { result: 'success' };
    }
  }
  return { result: 'error', message: '해당 ID를 찾을 수 없음: ' + b.id };
}

async function deleteSetting(b) {
  const category = b.category || '';
  const sheetName = SHEET_MAP[category];
  if (!sheetName) return { result: 'error', message: '알 수 없는 카테고리: ' + category };
  const data = await readSheet(sheetName);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(b.id)) {
      await deleteRow(sheetName, i + 1);
      invalidateAll();
      if (category === 'account') bumpReadSheet('계좌');
      return { result: 'success' };
    }
  }
  return { result: 'error', message: '해당 ID를 찾을 수 없음: ' + b.id };
}

async function upsertConfig(key, value) {
  const data = await readSheet('설정');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '') === key) { await setCell('설정', i + 1, 2, value); return; }
  }
  await appendRow('설정', [key, value]);
}

async function updateSnapshotConfig(b) {
  // 자동 저장 시각은 Cloud Scheduler(/cron/snapshot)가 매시간 설정 시트를 읽어 판단하므로 트리거 재설정이 필요 없음
  if (b.day !== undefined) await upsertConfig('스냅샷_자동저장일', b.day);
  if (b.cycle) await upsertConfig('스냅샷_반복주기', b.cycle);
  if (b.hour !== undefined) await upsertConfig('스냅샷_저장시간', b.hour);
  return { result: 'success' };
}

async function updateSnapshotSource(b) {
  await upsertConfig('스냅샷_저장소스', b.sourceUrl || '');
  return { result: 'success' };
}

async function takeSnapshot() {
  const s = await readSheets(['거래내역', '계좌', '종목']);
  const 현재가맵 = {}; for (let i = 1; i < s['종목'].length; i++) 현재가맵[s['종목'][i][0]] = Number(s['종목'][i][2]) || 0;
  const 계좌맵 = {}; for (let i = 1; i < s['계좌'].length; i++) { const r = s['계좌'][i]; if (r[0]) 계좌맵[r[0]] = { 금융기관ID: r[2], 상품ID: r[3] }; }
  const 보유맵 = {};
  for (let i = 1; i < s['거래내역'].length; i++) {
    const r = s['거래내역'][i]; const 사용자ID = r[2], 계좌ID = r[3], 종목코드 = r[4];
    if (!사용자ID || !종목코드) continue;
    const k = 사용자ID + '_' + 계좌ID + '_' + 종목코드;
    if (!보유맵[k]) { const a = 계좌맵[계좌ID] || { 금융기관ID: '-', 상품ID: '-' }; 보유맵[k] = { 사용자ID, 금융기관ID: a.금융기관ID, 상품ID: a.상품ID, 종목코드, 보유수량: 0, 총매수금액: 0, 평균단가: 0 }; }
    applyTrade(보유맵[k], r[5], Number(r[6]), Number(r[7]));
  }
  const now = dateTimeKST(); const rows = [];
  Object.keys(보유맵).forEach(k => {
    const h = 보유맵[k]; if (h.보유수량 <= 0) return;
    rows.push([now, h.사용자ID, h.금융기관ID, h.상품ID, h.종목코드, h.보유수량 * (현재가맵[h.종목코드] || 0)]);
  });
  if (rows.length) await gapi('POST', SHEETS + '/values/' + q('스냅샷') + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', { values: rows });
  cache.delete('snapshot');
  return rows.length;
}

async function handleWrite(b) {
  const a = b.action || '', t = b.type || '';
  if (a === 'add' && t === 'trading') { const r = await withLock(() => addTrading(b)); if (r.result === 'success') await withLock(rebuildHoldings).catch(e => console.error('holdings', e)); return r; }
  if (a === 'delete' && t === 'trading') { const r = await withLock(() => deleteTrading(b)); if (r.result === 'success') await withLock(rebuildHoldings).catch(e => console.error('holdings', e)); return r; }
  if (a === 'add' && t === 'setting') return withLock(() => addSetting(b));
  if (a === 'update' && t === 'setting') return withLock(() => updateSetting(b));
  if (a === 'delete' && t === 'setting') return withLock(() => deleteSetting(b));
  if (a === 'update' && t === 'snapshot_config') return withLock(() => updateSnapshotConfig(b));
  if (a === 'update' && t === 'snapshot_source') return withLock(() => updateSnapshotSource(b));
  if (a === 'snapshot') { await withLock(takeSnapshot); return { result: 'success' }; }
  return { result: 'error', message: 'unknown action: ' + a + '/' + t };
}

// ---------- 크론 (Cloud Scheduler 호출용) ----------
async function cronSnapshot() {
  const cfg = await readSheet('설정');
  let days = '1', hour = 7;
  cfg.forEach((r, i) => {
    if (i === 0) return;
    if (r[0] === '스냅샷_자동저장일') days = String(r[1] || '1').trim();
    if (r[0] === '스냅샷_저장시간') hour = typeof r[1] === 'number' ? Math.floor(r[1] < 1 ? r[1] * 24 : r[1]) : Number(String(r[1]).split(':')[0]);
  });
  const dayList = days.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d >= 1 && d <= 31);
  if (!dayList.length) dayList.push(1);
  const n = nowKST();
  if (!dayList.includes(n.getUTCDate()) || n.getUTCHours() < hour) return { result: 'skip', reason: 'not scheduled now' };
  const snap = await readSheet('스냅샷');
  const last = snap.length > 1 ? snap[snap.length - 1][0] : null;
  if (typeof last === 'number' && serialToYmdSlash(last) === ymdSlashKST()) return { result: 'skip', reason: 'already done today' };
  const cnt = await withLock(takeSnapshot);
  return { result: 'success', rows: cnt };
}

// ---------- HTTP ----------
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' };

function send(res, status, body, type) {
  const isStr = typeof body === 'string';
  res.writeHead(status, Object.assign({ 'Content-Type': type || (isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8') }, CORS));
  res.end(isStr ? body : JSON.stringify(body));
}
function sendJson(res, obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) return send(res, 200, callback + '(' + json + ')', 'application/javascript; charset=utf-8');
  send(res, 200, json, 'application/json; charset=utf-8');
}

async function route(req, res, url, rawBody) {
  const p = url.searchParams;
  const action = p.get('action') || '';
  const callback = p.get('callback') || '';

  if (url.pathname === '/healthz') return send(res, 200, 'ok');

  if (url.pathname.startsWith('/cron/')) {
    if (!CRON_SECRET || p.get('secret') !== CRON_SECRET) return send(res, 403, { error: 'forbidden' });
    if (url.pathname === '/cron/snapshot') return sendJson(res, await cronSnapshot());
    if (url.pathname === '/cron/holdings') { await withLock(rebuildHoldings); return sendJson(res, { result: 'success' }); }
    return send(res, 404, { error: 'not found' });
  }

  if (req.method === 'POST') {
    let body;
    try { body = JSON.parse(rawBody || '{}'); } catch (e) { return sendJson(res, { result: 'error', message: 'bad json' }); }
    try { return sendJson(res, await handleWrite(body)); }
    catch (e) { console.error(e); return sendJson(res, { result: 'error', message: String(e && e.message || e) }); }
  }

  if (action === 'checkRole') return send(res, 200, await checkRole(p.get('email')));
  if (action === 'readSheet') return sendJson(res, await readSheetAction(p.get('sheet') || ''), callback);

  if (action === 'write') {
    let result;
    try { result = await handleWrite(JSON.parse(decodeURIComponent(p.get('body') || '{}'))); }
    catch (e) { result = { result: 'error', message: String(e && e.message || e) }; }
    return sendJson(res, result, callback);
  }

  if (action === 'snapshot') {
    await withLock(takeSnapshot);
    return send(res, 200, '<div style="font-family:sans-serif;text-align:center;padding:40px;"><h2>✅ 스냅샷 저장 완료!</h2><p>이 창을 닫으셔도 됩니다.</p></div>', 'text/html; charset=utf-8');
  }

  if (action === 'api') {
    const type = p.get('type') || '';
    const filter = p.get('filter') || '전체';
    let result;
    if (type === 'data') result = await getDashboardData(filter);
    else if (type === 'filters') result = await getFilterOptions();
    else if (type === 'snapshot') result = await getSnapshotData();
    else if (type === 'labels') result = await getLabels();
    else if (type === 'indices') result = await getMarketIndices();
    else result = { error: 'unknown type' };
    return sendJson(res, result, callback);
  }

  return send(res, 200, 'anju-stock-market api');
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    try {
      const url = new URL(req.url, 'http://localhost');
      await route(req, res, url, Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: String(e && e.message || e) });
    }
  });
}).listen(PORT, () => console.log('listening on ' + PORT));
