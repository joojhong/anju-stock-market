// ==========================================
// 안주주식마켓 - AppScript 자동화 (최종 수정 버전)
// ==========================================

// ==========================================
// Step 1: CacheService 기반 캐싱 헬퍼 (2026-09-18 추가)
// - 캐시 실패가 응답 실패로 이어지지 않도록 전부 try/catch로 감쌈
// - 캐시 미스 시 각 함수는 기존 로직을 그대로 실행 (폴백)
// ==========================================

function _getVer(name) {
  try {
    var props = PropertiesService.getScriptProperties();
    var v = props.getProperty(name);
    return v ? Number(v) : 1;
  } catch (e) {
    Logger.log('_getVer 실패 (' + name + '): ' + e.toString());
    return 1;
  }
}

function _bumpVer(name) {
  try {
    var props = PropertiesService.getScriptProperties();
    var v = _getVer(name) + 1;
    props.setProperty(name, String(v));
  } catch (e) {
    Logger.log('_bumpVer 실패 (' + name + '): ' + e.toString());
  }
}

function _invalidateAll() {
  _bumpVer('filters_ver');
  _bumpVer('labels_ver');
  _bumpVer('dashboard_ver');
}

function _cacheGet(key) {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(key);
    if (cached) {
      Logger.log('캐시 HIT: ' + key);
      return JSON.parse(cached);
    }
    Logger.log('캐시 MISS: ' + key);
    return null;
  } catch (e) {
    Logger.log('캐시 조회 실패 (' + key + '): ' + e.toString());
    return null;
  }
}

function _cachePut(key, value, ttlSeconds) {
  try {
    var cache = CacheService.getScriptCache();
    cache.put(key, JSON.stringify(value), ttlSeconds);
  } catch (e) {
    Logger.log('캐시 저장 실패 (' + key + '): ' + e.toString());
  }
}

function _bumpReadSheetVer(sheetName) {
  _bumpVer('readsheet_ver_' + sheetName);
}

function 현재가수식업데이트() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('현재가수식업데이트: lock busy, skip'); return; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var 종목시트 = ss.getSheetByName('종목');
    var 종목데이터 = 종목시트.getDataRange().getValues();
    var lastRow = 종목데이터.length;
    if (lastRow < 2) return;

    var range = 종목시트.getRange(2, 3, lastRow - 1, 2);
    var formulas = range.getFormulas();
    var changed = false;

    for (var i = 0; i < formulas.length; i++) {
      var 종목코드 = 종목데이터[i + 1][0];
      if (!종목코드) continue;
      if (!formulas[i][0]) {
        formulas[i][0] = '=GOOGLEFINANCE("' + 종목코드 + '","price")';
        changed = true;
      }
      if (!formulas[i][1]) {
        formulas[i][1] = '=GOOGLEFINANCE("' + 종목코드 + '","closeyest")';
        changed = true;
      }
    }

    if (changed) range.setFormulas(formulas);
    Logger.log('현재가 수식 업데이트 완료 (배치, 변경: ' + changed + ')');
  } finally {
    lock.releaseLock();
  }
}

function 보유종목업데이트(timeoutMs) {
  var lock = LockService.getScriptLock();
  var 락타임아웃 = (typeof timeoutMs === 'number') ? timeoutMs : 30000;
  if (!lock.tryLock(락타임아웃)) { Logger.log('보유종목업데이트: lock busy, skip (timeout=' + 락타임아웃 + 'ms)'); return; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var 거래시트 = ss.getSheetByName('거래내역');
    var 보유시트 = ss.getSheetByName('보유종목');

    var 거래데이터 = 거래시트.getDataRange().getValues();
    var 보유맵 = {};

    for (var i = 1; i < 거래데이터.length; i++) {
      var 행 = 거래데이터[i];
      var 사용자ID = 행[2];
      var 종목코드 = 행[4];
      var 거래유형 = 행[5];
      var 수량 = Number(행[6]);
      var 단가 = Number(행[7]);

      if (!사용자ID || !종목코드) continue;

      var 키 = 사용자ID + '_' + 종목코드;

      if (!보유맵[키]) {
        보유맵[키] = {
          사용자ID: 사용자ID,
          종목코드: 종목코드,
          보유수량: 0,
          총매수금액: 0,
          평균단가: 0
        };
      }

      if (거래유형 === '매수') {
        보유맵[키].총매수금액 += 수량 * 단가;
        보유맵[키].보유수량 += 수량;
        보유맵[키].평균단가 = 보유맵[키].총매수금액 / 보유맵[키].보유수량;
      } else if (거래유형 === '매도') {
        보유맵[키].총매수금액 -= 수량 * 보유맵[키].평균단가;
        보유맵[키].보유수량 -= 수량;
        if (보유맵[키].보유수량 > 0) {
          보유맵[키].평균단가 = 보유맵[키].총매수금액 / 보유맵[키].보유수량;
        }
      }
    }

    var rows = [['사용자ID', '종목코드', '보유수량', '평균단가', '매수총액']];
    for (var 키 in 보유맵) {
      var 항목 = 보유맵[키];
      if (항목.보유수량 > 0) {
        rows.push([항목.사용자ID, 항목.종목코드, 항목.보유수량, 항목.평균단가, 항목.총매수금액]);
      }
    }

    보유시트.clearContents();
    보유시트.getRange(1, 1, rows.length, 5).setValues(rows);
    Logger.log('보유종목 업데이트 완료 (배치)');
  } finally {
    lock.releaseLock();
  }
}

function 스냅샷저장() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('스냅샷저장: lock busy, skip'); return; }
  try {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var 거래시트 = ss.getSheetByName('거래내역');
  var 계좌시트 = ss.getSheetByName('계좌');
  var 종목시트 = ss.getSheetByName('종목');
  var 스냅샷시트 = ss.getSheetByName('스냅샷');

  var 오늘 = new Date();
  var 거래데이터 = 거래시트.getDataRange().getValues();
  var 계좌데이터 = 계좌시트.getDataRange().getValues();
  var 종목데이터 = 종목시트.getDataRange().getValues();

  var 현재가맵 = {};
  for (var i = 1; i < 종목데이터.length; i++) {
    현재가맵[종목데이터[i][0]] = Number(종목데이터[i][2]) || 0;
  }

  var 계좌맵 = {};
  for (var i = 1; i < 계좌데이터.length; i++) {
    var 계좌ID = 계좌데이터[i][0];
    if (!계좌ID) continue;
    계좌맵[계좌ID] = {
      금융기관ID: 계좌데이터[i][2],
      상품ID: 계좌데이터[i][3]
    };
  }

  var 보유맵 = {};

  for (var i = 1; i < 거래데이터.length; i++) {
    var 행 = 거래데이터[i];
    var 사용자ID = 행[2];
    var 계좌ID = 행[3];
    var 종목코드 = 행[4];
    var 거래유형 = 행[5];
    var 수량 = Number(행[6]);
    var 단가 = Number(행[7]);

    if (!사용자ID || !종목코드) continue;

    var 키 = 사용자ID + '_' + 계좌ID + '_' + 종목코드;

    if (!보유맵[키]) {
      var 계좌정보 = 계좌맵[계좌ID] || { 금융기관ID: '-', 상품ID: '-' };
      보유맵[키] = {
        사용자ID: 사용자ID,
        금융기관ID: 계좌정보.금융기관ID,
        상품ID: 계좌정보.상품ID,
        종목코드: 종목코드,
        보유수량: 0,
        총매수금액: 0,
        평균단가: 0
      };
    }

    if (거래유형 === '매수') {
      보유맵[키].총매수금액 += 수량 * 단가;
      보유맵[키].보유수량 += 수량;
      보유맵[키].평균단가 = 보유맵[키].총매수금액 / 보유맵[키].보유수량;
    } else if (거래유형 === '매도') {
      보유맵[키].총매수금액 -= 수량 * 보유맵[키].평균단가;
      보유맵[키].보유수량 -= 수량;
      if (보유맵[키].보유수량 > 0) {
        보유맵[키].평균단가 = 보유맵[키].총매수금액 / 보유맵[키].보유수량;
      }
    }
  }

  for (var 키 in 보유맵) {
    var 항목 = 보유맵[키];
    if (항목.보유수량 <= 0) continue;

    var 현재가 = 현재가맵[항목.종목코드] || 0;
    var 평가액 = 항목.보유수량 * 현재가;

    // 개별 보유 내역 행만 순수하게 기록합니다.
    스냅샷시트.appendRow([오늘, 항목.사용자ID, 항목.금융기관ID, 항목.상품ID, 항목.종목코드, 평가액]);
  }

  _bumpVer('snapshot_ver');
  Logger.log('스냅샷 저장 완료: ' + 오늘);
  } finally {
    lock.releaseLock();
  }
}

function 자동스냅샷트리거설정() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var 설정시트 = ss.getSheetByName('설정');
  var 설정데이터 = 설정시트.getDataRange().getValues();

  var 저장일문자열 = '1';
  var 저장시간 = 7;

  for (var i = 1; i < 설정데이터.length; i++) {
    if (설정데이터[i][0] === '스냅샷_자동저장일') 저장일문자열 = String(설정데이터[i][1] || '1').trim();
    if (설정데이터[i][0] === '스냅샷_저장시간') {
      var 시간값 = 설정데이터[i][1];
      if (typeof 시간값 === 'number') {
        저장시간 = Math.floor(Number(시간값));
      } else {
        저장시간 = Number(시간값.toString().split(':')[0]);
      }
    }
  }

  var 트리거목록 = ScriptApp.getProjectTriggers();
  for (var i = 0; i < 트리거목록.length; i++) {
    if (트리거목록[i].getHandlerFunction() === '스냅샷저장') {
      ScriptApp.deleteTrigger(트리거목록[i]);
    }
  }

  var 저장일배열 = 저장일문자열.split(',').map(function(d) { return parseInt(d.trim(), 10); }).filter(function(d) { return !isNaN(d) && d >= 1 && d <= 31; });
  if (저장일배열.length === 0) 저장일배열 = [1];

  for (var j = 0; j < 저장일배열.length; j++) {
    ScriptApp.newTrigger('스냅샷저장')
      .timeBased()
      .onMonthDay(저장일배열[j])
      .atHour(저장시간)
      .create();
  }

  Logger.log('트리거 설정 완료: 매월 ' + 저장일문자열 + '일 ' + 저장시간 + '시');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 안주주식마켓')
    .addItem('🔄 보유종목 업데이트', '보유종목업데이트')
    .addItem('💹 현재가 수식 업데이트', '현재가수식업데이트')
    .addToUi();
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  var callback = (e && e.parameter && e.parameter.callback) ? e.parameter.callback : '';

// action=checkRole 처리 추가
if (e.parameter.action === 'checkRole') {
  const email = e.parameter.email;
  const ss = SpreadsheetApp.openById('1BNEAoqxn4ZuTG8ZqRNI23Nnjh7rY5xQDpJUHyCLl1KA');
  const editors = ss.getEditors().map(u => u.getEmail().toLowerCase());
  const viewers = ss.getViewers().map(u => u.getEmail().toLowerCase());
  const target = email.toLowerCase();
  let role = 'none';
  if (editors.includes(target)) role = 'editor';
  else if (viewers.includes(target)) role = 'viewer';
  return ContentService.createTextOutput(role).setMimeType(ContentService.MimeType.TEXT);
}


  // GET 방식 CRUD (CORS 우회 - GitHub Pages에서 호출)
  if (action === 'readSheet') {
    var sheetName = e.parameter.sheet || '';
    // 명부류(계좌): 300초 TTL / 이력류(거래내역): 60초 TTL / 그 외: 캐시 미적용(기존 동작 유지)
    var READSHEET_TTL = { '계좌': 1800, '거래내역': 60 };
    var rsTtl = READSHEET_TTL[sheetName];
    var rsCacheKey = null;
    if (rsTtl) {
      rsCacheKey = 'readsheet_' + sheetName + '_v' + _getVer('readsheet_ver_' + sheetName);
      var rsCached = _cacheGet(rsCacheKey);
      if (rsCached) {
        return ContentService.createTextOutput(JSON.stringify(rsCached)).setMimeType(ContentService.MimeType.JSON);
      }
    }
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return ContentService.createTextOutput(JSON.stringify({error: 'sheet not found: ' + sheetName})).setMimeType(ContentService.MimeType.JSON);
      var data = sheet.getDataRange().getValues();
      var rsResult = {result: 'success', data: data};
      if (rsTtl) _cachePut(rsCacheKey, rsResult, rsTtl);
      return ContentService.createTextOutput(JSON.stringify(rsResult)).setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({error: err.toString()})).setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (action === 'write') {
    var bodyParam = e.parameter.body || '{}';
    try {
      var body = JSON.parse(decodeURIComponent(bodyParam));
      var writeAction = body.action || '';
      var writeType = body.type || '';
      var result;

      if (writeAction === 'add' && writeType === 'setting') {
        result = addSetting(body);
      } else if (writeAction === 'update' && writeType === 'setting') {
        result = updateSetting(body);
      } else if (writeAction === 'delete' && writeType === 'setting') {
        result = deleteSetting(body);
      } else if (writeAction === 'add' && writeType === 'trading') {
        result = addTrading(body);
      } else if (writeAction === 'update' && writeType === 'snapshot_config') {
        result = updateSnapshotConfig(body);
      } else if (writeAction === 'update' && writeType === 'snapshot_source') {
        result = updateSnapshotSource(body);
      } else if (writeAction === 'snapshot') {
        스냅샷저장();
        result = { result: 'success' };
      } else {
        result = { result: 'error', message: 'unknown write action: ' + writeAction + '/' + writeType };
      }
    } catch(err) {
      result = { result: 'error', message: err.toString() };
    }


    var json = JSON.stringify(result);
    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'snapshot') {
    스냅샷저장();
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;text-align:center;padding:40px;">' +
      '<h2>✅ 스냅샷 저장 완료!</h2>' +
      '<p>이 창을 닫으셔도 됩니다.</p>' +
      '</div>'
    );
  }

  if (action === 'api') {
    var type = (e.parameter.type) ? e.parameter.type : '';
    var filter = (e.parameter.filter) ? e.parameter.filter : '전체';
    var result;
    if (type === 'data') {
      result = getDashboardData(filter);
    } else if (type === 'filters') {
      result = getFilterOptions();
    } else if (type === 'snapshot') {
      result = getSnapshotData();
    } else if (type === 'labels') {
            result = getLabels();
    } else if (type === 'indices') {
      result = getMarketIndices();
    } else {
      result = { error: 'unknown type' };
    }
    var json = JSON.stringify(result);
    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }
}


function getFilterOptions() {
  var 캐시키 = 'filters_v' + _getVer('filters_ver');
  var 캐시값 = _cacheGet(캐시키);
  if (캐시값) return 캐시값;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var 사용자데이터 = ss.getSheetByName('사용자').getDataRange().getValues();
  var 계좌데이터 = ss.getSheetByName('계좌').getDataRange().getValues();
  var 금융기관데이터 = ss.getSheetByName('금융기관').getDataRange().getValues();
  var 상품데이터 = ss.getSheetByName('상품').getDataRange().getValues();

  var 사용자맵 = {};
  for (var i = 1; i < 사용자데이터.length; i++) {
    if (사용자데이터[i][0]) 사용자맵[사용자데이터[i][0]] = 사용자데이터[i][1];
  }

  var 금융기관맵 = {};
  for (var i = 1; i < 금융기관데이터.length; i++) {
    if (금융기관데이터[i][0]) 금융기관맵[금융기관데이터[i][0]] = 금융기관데이터[i][1];
  }

  var 상품맵 = {};
  for (var i = 1; i < 상품데이터.length; i++) {
    if (상품데이터[i][0]) 상품맵[상품데이터[i][0]] = 상품데이터[i][1];
  }

  var 사용자계좌맵 = {};
  for (var i = 1; i < 계좌데이터.length; i++) {
    var 계좌ID = 계좌데이터[i][0];
    var 사용자ID = 계좌데이터[i][1];
    var 금융기관ID = 계좌데이터[i][2];
    var 상품ID = 계좌데이터[i][3];
    if (!계좌ID || !사용자ID) continue;
    if (!사용자계좌맵[사용자ID]) 사용자계좌맵[사용자ID] = [];
    사용자계좌맵[사용자ID].push({
      계좌ID: 계좌ID,
      레이블: (금융기관맵[금융기관ID] || 금융기관ID) + ' ' + (상품맵[상품ID] || 상품ID)
    });
  }

  var options = [{ value: '전체', label: '👥 전체' }];

  for (var userId in 사용자계좌맵) {
    options.push({ value: userId, label: '👤 ' + (사용자맵[userId] || userId) });
    var accounts = 사용자계좌맵[userId];
    for (var j = 0; j < accounts.length; j++) {
      options.push({
        value: userId + '|' + accounts[j].계좌ID,
        label: ' ' + accounts[j].레이블
      });
    }
  }

  _cachePut(캐시키, options, 1800);
  return options;
}

function getDashboardData(filter) {
  var 필터키 = filter || '전체';
  var 캐시키 = 'dashboard_v' + _getVer('dashboard_ver') + '_' + 필터키;
  var 캐시값 = _cacheGet(캐시키);
  if (캐시값) return 캐시값;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var 거래데이터 = ss.getSheetByName('거래내역').getDataRange().getValues();
  var 종목데이터 = ss.getSheetByName('종목').getDataRange().getValues();
  var 사용자데이터 = ss.getSheetByName('사용자').getDataRange().getValues();

  var parts = (filter || '전체').split('|');
  var filterUserId = parts[0] === '전체' ? null : parts[0];
  var filterAccountId = parts.length > 1 ? parts[1] : null;

  var 종목맵 = {};
  for (var i = 1; i < 종목데이터.length; i++) {
    종목맵[종목데이터[i][0]] = {
      종목명: 종목데이터[i][1],
      현재가: Number(종목데이터[i][2]) || 0,
      전일종가: Number(종목데이터[i][3]) || 0
    };
  }

  var 사용자목록 = [];
  for (var i = 1; i < 사용자데이터.length; i++) {
    if (사용자데이터[i][0]) {
      사용자목록.push({ id: 사용자데이터[i][0], name: 사용자데이터[i][1] });
    }
  }

  var 보유맵 = {};
  for (var i = 1; i < 거래데이터.length; i++) {
    var 행 = 거래데이터[i];
    var 사용자ID = 행[2];
    var 계좌ID = 행[3];
    var 종목코드 = 행[4];
    var 거래유형 = 행[5];
    var 수량 = Number(행[6]);
    var 단가 = Number(행[7]);

    if (!사용자ID || !종목코드) continue;
    if (filterUserId && 사용자ID !== filterUserId) continue;
    if (filterAccountId && 계좌ID !== filterAccountId) continue;

    var 키 = 사용자ID + '_' + 계좌ID + '_' + 종목코드;

    if (!보유맵[키]) {
      보유맵[키] = { 종목코드: 종목코드, 보유수량: 0, 총매수금액: 0, 평균단가: 0 };
    }

    if (거래유형 === '매수') {
      보유맵[키].총매수금액 += 수량 * 단가;
      보유맵[키].보유수량 += 수량;
      보유맵[키].평균단가 = 보유맵[키].총매수금액 / 보유맵[키].보유수량;
    } else if (거래유형 === '매도') {
      보유맵[키].총매수금액 -= 수량 * 보유맵[키].평균단가;
      보유맵[키].보유수량 -= 수량;
      if (보유맵[키].보유수량 > 0) {
        보유맵[키].평균단가 = 보유맵[키].총매수금액 / 보유맵[키].보유수량;
      }
    }
  }

  var 종목별 = {};
  var 총평가액 = 0, 총매수금액 = 0, 전일합 = 0;

  for (var 키 in 보유맵) {
    var 항목 = 보유맵[키];
    if (항목.보유수량 <= 0) continue;

    var 정보 = 종목맵[항목.종목코드] || { 종목명: 항목.종목코드, 현재가: 0, 전일종가: 0 };
    var 평가액 = 항목.보유수량 * 정보.현재가;
    var 전일 = 항목.보유수량 * (정보.현재가 - 정보.전일종가);

    총평가액 += 평가액;
    총매수금액 += 항목.총매수금액;
    전일합 += 전일;

    if (!종목별[항목.종목코드]) {
      종목별[항목.종목코드] = { 종목명: 정보.종목명, 현재가: 정보.현재가, 평가액: 0, 매수총액: 0, 전일: 0, 보유수량: 0 };
    }
    종목별[항목.종목코드].평가액 += 평가액;
    종목별[항목.종목코드].매수총액 += 항목.총매수금액;
    종목별[항목.종목코드].전일 += 전일;
    종목별[항목.종목코드].보유수량 += 항목.보유수량;
  }

  var 손익금 = 총평가액 - 총매수금액;
  var 종목목록 = Object.keys(종목별).map(function(k) {
    var t = 종목별[k];
    var 손익 = t.평가액 - t.매수총액;
    return {
      종목명: t.종목명,
      현재가: t.현재가,
      평가액: t.평가액,
      손익금: 손익,
      손익률: t.매수총액 > 0 ? (손익 / t.매수총액 * 100) : 0,
      전일대비금액: t.전일,
      전일대비율: (t.평가액 - t.전일) > 0 ? (t.전일 / (t.평가액 - t.전일) * 100) : 0,
      보유수량: t.보유수량,
    };
  }).sort(function(a, b) { return b.평가액 - a.평가액; });

  var 결과 = {
    통계: {
      총평가액: 총평가액,
      손익금: 손익금,
      손익률: 총매수금액 > 0 ? (손익금 / 총매수금액 * 100) : 0,
      전일대비금액: 전일합,
      전일대비율: (총평가액 - 전일합) > 0 ? (전일합 / (총평가액 - 전일합) * 100) : 0
    },
    종목목록: 종목목록,
    사용자목록: 사용자목록
  };
  _cachePut(캐시키, 결과, 60);
  return 결과;
}

function 보유종목트리거설정() {
  var 트리거목록 = ScriptApp.getProjectTriggers();
  for (var i = 0; i < 트리거목록.length; i++) {
    if (트리거목록[i].getHandlerFunction() === '보유종목업데이트') {
      ScriptApp.deleteTrigger(트리거목록[i]);
    }
  }
  // 2026-09-17: onChange(GOOGLEFINANCE 재계산마다 발동)를 안전망 시간 기반으로 전환.
  // 실시간 반영은 doPost의 addTrading/deleteTrading 성공 직후 직접 호출로 처리하고,
  // 이 트리거는 doPost 경로를 거치지 않는 수정(시트 직접 편집 등)에 대비한 안전망만 담당.
  ScriptApp.newTrigger('보유종목업데이트')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();
  Logger.log('보유종목 안전망 트리거 설정 완료 (매일 04시)');
}

function 종목트리거설정() {
  var 트리거목록 = ScriptApp.getProjectTriggers();
  for (var i = 0; i < 트리거목록.length; i++) {
    if (트리거목록[i].getHandlerFunction() === '현재가수식업데이트') {
      ScriptApp.deleteTrigger(트리거목록[i]);
    }
  }
  // 2026-09-17: addSetting()이 종목 추가 시 수식을 바로 넣어주므로 상시 트리거 불필요.
  // 기존 누락분은 1회 수동 실행(현재가수식업데이트())으로 백필하고 트리거는 재생성하지 않음.
  Logger.log('현재가수식업데이트 트리거 해제 완료 (상시 트리거 없음)');
}

function getSnapshotData() {
  var 캐시키 = 'snapshot_v' + _getVer('snapshot_ver');
  var 캐시값 = _cacheGet(캐시키);
  if (캐시값) return 캐시값;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('스냅샷');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      if (val instanceof Date) val = Utilities.formatDate(val, 'Asia/Seoul', 'yyyy/MM/dd');
      obj[headers[j]] = val;
    }
    result.push(obj);
  }
  _cachePut(캐시키, result, 300);
  return result;
}

function getLabels() {
  var 캐시키 = 'labels_v' + _getVer('labels_ver');
  var 캐시값 = _cacheGet(캐시키);
  if (캐시값) return 캐시값;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var 사용자시트 = ss.getSheetByName('사용자').getDataRange().getValues();
  var 금융기관시트 = ss.getSheetByName('금융기관').getDataRange().getValues();
  var 상품시트 = ss.getSheetByName('상품').getDataRange().getValues();
  var 종목시트 = ss.getSheetByName('종목').getDataRange().getValues();
  var 사용자맵 = {};
  for (var i = 1; i < 사용자시트.length; i++) {
    if (사용자시트[i][0]) 사용자맵[사용자시트[i][0]] = 사용자시트[i][1];
  }
  var 금융기관맵 = {};
  for (var i = 1; i < 금융기관시트.length; i++) {
    if (금융기관시트[i][0]) 금융기관맵[금융기관시트[i][0]] = 금융기관시트[i][1];
  }
  var 상품맵 = {};
  for (var i = 1; i < 상품시트.length; i++) {
    if (상품시트[i][0]) 상품맵[상품시트[i][0]] = 상품시트[i][1];
  }
  var 종목맵 = {};
  for (var i = 1; i < 종목시트.length; i++) {
    if (종목시트[i][0]) 종목맵[종목시트[i][0]] = 종목시트[i][1];
  }
  var 결과 = { 사용자: 사용자맵, 금융기관: 금융기관맵, 상품: 상품맵, 종목: 종목맵 };
  _cachePut(캐시키, 결과, 1800);
  return 결과;
}

// ==========================================
// doPost - 설정 CRUD 처리 (add/update/delete)
// ==========================================

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || '';
    var type = body.type || '';
    var result;

    if (action === 'add' && type === 'trading') {
      result = addTrading(body);
      if (result && result.result === 'success') 보유종목업데이트(5000);
    } else if (action === 'add' && type === 'setting') {
      result = addSetting(body);
    } else if (action === 'update' && type === 'setting') {
      result = updateSetting(body);
    } else if (action === 'delete' && type === 'setting') {
      result = deleteSetting(body);
    } else if (action === 'delete' && type === 'trading') {
      result = deleteTrading(body);
      if (result && result.result === 'success') 보유종목업데이트(5000);
    } else if (action === 'update' && type === 'snapshot_config') {
      result = updateSnapshotConfig(body);
    } else if (action === 'update' && type === 'snapshot_source') {
      result = updateSnapshotSource(body);
    } else if (action === 'snapshot') {
      스냅샷저장();
      result = { result: 'success' };
    } else {
      result = { result: 'error', message: 'unknown action: ' + action + '/' + type };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function addTrading(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('거래내역');
  var data = sheet.getDataRange().getValues();

  // Generate next trade ID
  var maxId = 0;
  for (var i = 1; i < data.length; i++) {
    var rowId = String(data[i][0] || '').replace(/[^0-9]/g, '');
    if (rowId) maxId = Math.max(maxId, parseInt(rowId));
  }
  var newId = 'T' + String(maxId + 1).padStart(3, '0');

  var today = new Date();
  var dateStr = body['날짜'] || Utilities.formatDate(today, 'Asia/Seoul', 'yyyy/MM/dd');

  sheet.appendRow([
    newId,
    dateStr,
    body['사용자ID'] || '',
    body['금융기관ID'] || '',
    body['종목코드'] || '',
    body['거래유형'] || '',
    body['수량'] || 0,
    body['단가'] || 0,
    body['금액'] || 0,
    body['상품ID'] || ''
  ]);

  _invalidateAll();
  _bumpReadSheetVer('거래내역');
  return { result: 'success', id: newId };
}

function deleteTrading(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('거래내역');
  var data = sheet.getDataRange().getValues();
  var id = body.id;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      _invalidateAll();
      _bumpReadSheetVer('거래내역');
      return { result: 'success', message: id + ' 삭제 완료' };
    }
  }
  return { result: 'error', message: '해당 ID를 찾을 수 없습니다: ' + id };
}

function addSetting(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var category = body.category || '';

  var sheetMap = {
    'user': '사용자',
    'institution': '금융기관',
    'product': '상품',
    'account': '계좌',
    'stock': '종목'
  };

  var prefixMap = {
    'user': 'A',
    'institution': 'B',
    'product': 'D',
    'account': 'C'
  };

  var sheetName = sheetMap[category];
  if (!sheetName) return { result: 'error', message: '알 수 없는 카테고리: ' + category };

  var sheet = ss.getSheetByName(sheetName);
  var data = sheet.getDataRange().getValues();

  if (category === 'stock') {
    // 종목: 코드를 직접 사용 (고유ID 없음)
    var code = body.id || '';
    var name = body.name || '';
    if (!code || !name) return { result: 'error', message: '종목코드와 종목명 필요' };

    // Check if code already exists
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === code) return { result: 'error', message: '이미 존재하는 종목코드: ' + code };
    }

    var newRow = sheet.getLastRow() + 1;
    sheet.appendRow([code, name]);
    sheet.getRange(newRow, 3).setFormula('=GOOGLEFINANCE("' + code + '","price")');
    sheet.getRange(newRow, 4).setFormula('=GOOGLEFINANCE("' + code + '","closeyest")');
    _invalidateAll();
    return { result: 'success', id: code };
  }

  if (category === 'account') {
    // 계좌 추가
    var prefix = prefixMap[category] || 'C';
    var maxNum = 0;
    for (var i = 1; i < data.length; i++) {
      var rowId = String(data[i][0] || '');
      if (rowId.startsWith(prefix)) {
        var num = parseInt(rowId.substring(1));
        if (!isNaN(num)) maxNum = Math.max(maxNum, num);
      }
    }
    var newId = prefix + String(maxNum + 1).padStart(3, '0');
    sheet.appendRow([newId, body.user || '', body.bank || '', body.product || '']);
    _invalidateAll();
    _bumpReadSheetVer('계좌');
    return { result: 'success', id: newId };
  }

  // 사용자, 금융기관, 상품
  var prefix = prefixMap[category] || 'X';
  var maxNum = 0;
  for (var i = 1; i < data.length; i++) {
    var rowId = String(data[i][0] || '');
    if (rowId.startsWith(prefix)) {
      var num = parseInt(rowId.substring(1));
      if (!isNaN(num)) maxNum = Math.max(maxNum, num);
    }
  }
  var newId = prefix + String(maxNum + 1).padStart(3, '0');
  sheet.appendRow([newId, body.name || '']);
  _invalidateAll();
  return { result: 'success', id: newId };
}

function getNameById(sheetName, id) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === id) return data[i][1];
  }
  return id;
}

function updateSetting(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var category = body.category || '';

  var sheetMap = {
    'user': '사용자',
    'institution': '금융기관',
    'product': '상품',
    'account': '계좌',
    'stock': '종목'
  };

  var sheetName = sheetMap[category];
  if (!sheetName) return { result: 'error', message: '알 수 없는 카테고리: ' + category };

  var sheet = ss.getSheetByName(sheetName);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      if (category === 'account') {
        if (body.user) sheet.getRange(i + 1, 2).setValue(body.user);
        if (body.bank) sheet.getRange(i + 1, 3).setValue(body.bank);
        if (body.product) sheet.getRange(i + 1, 4).setValue(body.product);
      } else {
        sheet.getRange(i + 1, 2).setValue(body.name || '');
      }
      _invalidateAll();
      if (category === 'account') _bumpReadSheetVer('계좌');
      return { result: 'success' };
    }
  }
  return { result: 'error', message: '해당 ID를 찾을 수 없음: ' + body.id };
}

function deleteSetting(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var category = body.category || '';

  var sheetMap = {
    'user': '사용자',
    'institution': '금융기관',
    'product': '상품',
    'account': '계좌',
    'stock': '종목'
  };

  var sheetName = sheetMap[category];
  if (!sheetName) return { result: 'error', message: '알 수 없는 카테고리: ' + category };

  var sheet = ss.getSheetByName(sheetName);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      sheet.deleteRow(i + 1);
      _invalidateAll();
      if (category === 'account') _bumpReadSheetVer('계좌');
      return { result: 'success' };
    }
  }
  return { result: 'error', message: '해당 ID를 찾을 수 없음: ' + body.id };
}

function updateSnapshotConfig(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('설정');
  if (!sheet) return { result: 'error', message: '설정 시트 없음' };

  var data = sheet.getDataRange().getValues();
  var updated = { day: false, cycle: false, hour: false };

  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0] || '');
    if (key === '스냅샷_자동저장일' && body.day !== undefined) {
      sheet.getRange(i + 1, 2).setValue(body.day);
      updated.day = true;
    } else if (key === '스냅샷_반복주기' && body.cycle) {
      sheet.getRange(i + 1, 2).setValue(body.cycle);
      updated.cycle = true;
    } else if (key === '스냅샷_저장시간' && body.hour !== undefined) {
      sheet.getRange(i + 1, 2).setValue(body.hour);
      updated.hour = true;
    }
  }

  // If keys don't exist yet, append them
  if (!updated.day && body.day !== undefined) sheet.appendRow(['스냅샷_자동저장일', body.day]);
  if (!updated.cycle && body.cycle) sheet.appendRow(['스냅샷_반복주기', body.cycle]);
  if (!updated.hour && body.hour !== undefined) sheet.appendRow(['스냅샷_저장시간', body.hour]);

  자동스냅샷트리거설정();
  return { result: 'success' };
}

function updateSnapshotSource(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('설정');
  if (!sheet) return { result: 'error', message: '설정 시트 없음' };

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === '스냅샷_저장소스') {
      sheet.getRange(i + 1, 2).setValue(body.sourceUrl || '');
      return { result: 'success' };
    }
  }
  sheet.appendRow(['스냅샷_저장소스', body.sourceUrl || '']);
  return { result: 'success' };
}


function getMarketIndices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('지수');
  if (!sheet) return { error: '지수 시트 없음' };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return data
    .filter(function(r) { return r[0] !== ''; })
    .map(function(r) {
      var rate = typeof r[1] === 'number' ? r[1] * 100 : parseFloat(String(r[1]).replace('%', ''));
      return { name: r[0], rate: rate };
    });
}

// Updated: type=indices support added

// ==========================================
// 백업: 구글 드라이브 자동 백업 (2026-09-19 추가)
// - '설정' 시트의 '백업_저장시간' 값에 맞춰 매일 1회, DB(시트 사본)+백엔드(GitHub 미러)+
//   프론트엔드(GitHub raw) 전체를 지정 Drive 폴더 안 날짜별 하위폴더로 저장
// - 보관기간(백업_보관일수)이 지난 날짜 폴더는 자동으로 휴지통 이동
// - Node 하네스로 18개 시나리오 사전 검증 완료(트리거 재생성/시각불일치 skip/정상실행/
//   중복실행 방지/GitHub 일부 파일 실패 시에도 나머지는 계속 진행/보관기간 삭제)
// ==========================================

var 백업_상위폴더ID = '1Uto9314CRJg2q1VWvJU126Cp58DfpipN'; // 내 드라이브 > 투자 > Anjoo_stock_APP_file
var 백업_보관일수 = 15;
var 백업_GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/joojhong/anju-stock-market/main/';
var 백업_프론트엔드_파일목록 = ['index.html', 'trading.html', 'history.html', 'setting.html', 'snapshot.html', 'auth.js', 'manifest.json'];
var 백업_백엔드_파일목록 = ['apps-script/Code.gs', 'apps-script/appsscript.json'];

function 백업트리거설정() {
  var 트리거목록 = ScriptApp.getProjectTriggers();
  for (var i = 0; i < 트리거목록.length; i++) {
    if (트리거목록[i].getHandlerFunction() === '백업시각체크') {
      ScriptApp.deleteTrigger(트리거목록[i]);
    }
  }
  ScriptApp.newTrigger('백업시각체크')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('백업 시각 체크 트리거 설정 완료 (매시간 체크, 설정 시각에만 실제 실행)');
}

function 백업시각체크() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var 설정시트 = ss.getSheetByName('설정');
    var 설정데이터 = 설정시트.getDataRange().getValues();

    var 백업시각 = 23;
    for (var i = 1; i < 설정데이터.length; i++) {
      if (설정데이터[i][0] === '백업_저장시간') {
        var v = 설정데이터[i][1];
        백업시각 = typeof v === 'number' ? Math.floor(v) : Number(String(v).split(':')[0]);
      }
    }

    var 지금 = new Date();
    var 현재시 = 지금.getHours();
    if (현재시 !== 백업시각) return;

    var props = PropertiesService.getScriptProperties();
    var 오늘문자열 = Utilities.formatDate(지금, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (props.getProperty('마지막백업일') === 오늘문자열) return; // 이미 오늘 실행함

    백업실행(오늘문자열);
    props.setProperty('마지막백업일', 오늘문자열);
  } catch (e) {
    Logger.log('백업시각체크 실패: ' + e.toString());
  }
}

function 백업실행(오늘문자열) {
  var 상위폴더 = DriveApp.getFolderById(백업_상위폴더ID);
  var 오늘폴더 = 상위폴더.createFolder(오늘문자열);

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    DriveApp.getFileById(ss.getId()).makeCopy('DB_' + 오늘문자열, 오늘폴더);
  } catch (e) {
    Logger.log('DB 백업 실패: ' + e.toString());
  }

  백업_GitHub파일저장(백업_백엔드_파일목록, 오늘폴더, '백엔드_');
  백업_GitHub파일저장(백업_프론트엔드_파일목록, 오늘폴더, '프론트엔드_');
  백업_오래된폴더삭제();

  Logger.log('백업 완료: ' + 오늘문자열);
}

function 백업_GitHub파일저장(파일목록, 대상폴더, 접두어) {
  파일목록.forEach(function(path) {
    try {
      var res = UrlFetchApp.fetch(백업_GITHUB_RAW_BASE + path, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) {
        Logger.log('백업 파일 가져오기 실패 (' + path + '): HTTP ' + res.getResponseCode());
        return;
      }
      var 파일명 = 접두어 + path.replace(/\//g, '_');
      대상폴더.createFile(파일명, res.getContentText(), MimeType.PLAIN_TEXT);
    } catch (e) {
      Logger.log('백업 파일 저장 실패 (' + path + '): ' + e.toString());
    }
  });
}

function 백업_오래된폴더삭제() {
  var 상위폴더 = DriveApp.getFolderById(백업_상위폴더ID);
  var 하위폴더들 = 상위폴더.getFolders();
  var 기준일 = new Date();
  기준일.setDate(기준일.getDate() - 백업_보관일수);

  while (하위폴더들.hasNext()) {
    var 폴더 = 하위폴더들.next();
    if (폴더.getDateCreated() < 기준일) {
      폴더.setTrashed(true);
    }
  }
}

// 수동 테스트용 — 23시까지 기다리지 않고 지금 바로 백업 1회를 실행해보고 싶을 때
// 편집기 함수 목록에서 이 함수를 선택해 실행하면 됩니다.
// 폴더명 끝에 '_테스트'가 붙어서 실제 날짜 백업과 구분되며, 확인 후 Drive에서 지우면 됩니다.
function 백업테스트() {
  var 오늘문자열 = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  백업실행(오늘문자열 + '_테스트');
}
