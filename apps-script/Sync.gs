/**
 * 링크맘 매장 운영 — Google Sheet → Supabase Sync (Google Apps Script)
 *
 * 이 파일은 Google Sheet의 확장 프로그램 > Apps Script 편집기에 그대로
 * 붙여넣는 코드다(직접 실행되지 않는다 — 설치 방법은 apps-script/README.md 참조).
 *
 * 절대 원칙 (CLAUDE.md):
 * - 이 스크립트는 Supabase Service/Secret Key를 절대 갖지 않는다.
 * - 여기서 아는 비밀은 SYNC_API_SECRET 하나뿐이며, 그마저도 코드에 하드코딩하지
 *   않고 Script Properties(파일 > 프로젝트 설정 > 스크립트 속성)에 둔다.
 * - Google Sheet → Supabase 단방향(One-way)만 수행한다. 유일한 예외는 서버가
 *   새로 채번한 product_id를 해당 셀에 되써주는 것 — 그 외 어떤 컬럼도 덮어쓰지 않는다.
 *
 * 두 가지 Sync 경로 (2026-09-14 도입):
 * 1) 설치형 onEdit 트리거(handleEditTrigger) — [상시 프로모션]/[행사 프로모션] 시트가
 *    수정되면 수 초 내로 수정된 Row만 골라 sync_mode="partial"로 즉시 반영한다.
 *    누락 상품을 비활성화하지 않는 안전한 모드이므로 기본 경로로 쓴다.
 * 2) 10분 주기 syncAll (시간 기반 트리거) — Apps Script onEdit 트리거는 네트워크 오류/
 *    Apps Script 재시작/Quota 등으로 간헐적으로 누락될 수 있으므로, 전체 Sheet를 다시
 *    읽어 sync_mode="full_snapshot"으로 보내는 Safety Net으로 유지한다. 이 경로만
 *    안전장치(Row parse 확인, 누락 비율/절대값 임계치 — docs/sync-design.md §10)를
 *    통과했을 때 실제 비활성화를 한다.
 */

var SHEET_NAMES = {
  permanent: '상시 프로모션',
  event: '행사 프로모션',
};

/** onEdit → flushPendingSync까지의 디바운스(마이크로배칭) 대기 시간. */
var DEBOUNCE_DELAY_MS = 3000;

// =====================================================================
// 1) 설치 함수 — Apps Script 편집기에서 사람이 직접 한 번씩 실행한다.
// =====================================================================

/** 10분 주기 syncAll(Safety Net Full Snapshot) 트리거를 등록한다. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncAll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(10).create();
  Logger.log('10분마다 syncAll()(Full Snapshot Safety Net)이 실행되도록 트리거를 등록했습니다.');
}

/**
 * [상시 프로모션]/[행사 프로모션] 시트 수정을 감지하는 설치형 onEdit 트리거를 등록한다.
 * 이 함수를 실행해야만 handleEditTrigger가 실제 시트 수정에 반응한다 — 반드시
 * "설치형(installable)"으로 등록해야 하는 이유는, 방금 편집된 값 하나만 보고 즉시
 * 반응하는 단순(simple) onEdit(e) 트리거는 UrlFetchApp 같은 인증이 필요한 서비스를
 * 쓸 수 없기 때문이다(Apps Script 권한 제약). 설치형 트리거는 이 함수를 실행하는
 * 사람의 권한으로 동작하므로 외부 API 호출이 가능하다.
 */
function installOnEditTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'handleEditTrigger') ScriptApp.deleteTrigger(t);
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('handleEditTrigger').forSpreadsheet(ss).onEdit().create();
  Logger.log('설치형 onEdit 트리거를 등록했습니다 — 이제 시트 수정 시 handleEditTrigger가 실행됩니다.');
}

// =====================================================================
// 2) 설치형 onEdit 트리거 본체 + 디바운스(마이크로배칭)
// =====================================================================

/**
 * 설치형 onEdit 트리거 핸들러. 시트가 수정될 때마다 Google이 이벤트 객체(e)와
 * 함께 이 함수를 호출한다. 여기서는 "어떤 Row가 바뀌었는지"만 Script Properties에
 * 누적해두고, 실제 API 호출은 뒤에서(flushPendingSync) 한 번에 처리한다 — 같은
 * Row/시트를 짧은 시간에 여러 번 고쳐도 Sync API를 매번 부르지 않기 위함이다.
 */
function handleEditTrigger(e) {
  if (!e || !e.range) return; // 드롭다운에서 직접 실행하는 등 이벤트 객체가 없으면 무시

  var sheet = e.range.getSheet();
  var sheetName = sheet.getName();
  var sourceSheetKey = null;
  for (var key in SHEET_NAMES) {
    if (SHEET_NAMES[key] === sheetName) {
      sourceSheetKey = key;
      break;
    }
  }
  if (!sourceSheetKey) return; // [상시 프로모션]/[행사 프로모션] 외 다른 Sheet 수정은 완전히 무시

  var props = PropertiesService.getScriptProperties();

  // Loop 방지: 이 스크립트가 방금 product_id를 되쓰는 중에 발생한 편집이면 무시한다.
  // (Apps Script는 스크립트가 직접 쓴 값 변경으로는 onEdit을 발생시키지 않는 것이
  // 공식 문서상 정상 동작이지만, 만약을 대비한 이중 안전장치다 — 실제로 Loop가
  // 발생하지 않는지는 설치 후 README.md §9 체크리스트로 반드시 직접 확인한다.)
  if (props.getProperty('WRITEBACK_IN_PROGRESS_' + sourceSheetKey) === '1') return;

  var startRow = e.range.getRow();
  var endRow = e.range.getLastRow();
  if (endRow < 2) return; // 편집 범위가 전부 헤더 행(1행)이면 무시
  if (startRow < 2) startRow = 2; // 헤더+데이터가 함께 포함된 범위면 데이터 행부터만 처리

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (lockError) {
    // Lock을 못 얻으면 이 편집은 그냥 넘어간다 — 데이터가 사라지는 게 아니라, 다음
    // 편집이나 10분 Full Snapshot Safety Net이 결국 반영한다(지연만 발생).
    Logger.log('handleEditTrigger: Lock 획득 실패 — 이번 편집은 다음 편집 또는 10분 Full Snapshot에서 반영됩니다.');
    return;
  }
  try {
    var pendingKey = 'PENDING_ROWS_' + sourceSheetKey;
    var pendingSet = {};
    JSON.parse(props.getProperty(pendingKey) || '[]').forEach(function (r) {
      pendingSet[r] = true;
    });
    for (var r = startRow; r <= endRow; r++) pendingSet[r] = true; // 여러 Row 붙여넣기도 전부 포함
    props.setProperty(pendingKey, JSON.stringify(Object.keys(pendingSet).map(Number)));

    // 이미 flush가 예약돼 있으면 새로 예약하지 않는다 — 짧은 시간 내 여러 번 수정해도
    // 트리거가 여러 개 쌓이지 않고, 예약된 시점에 누적된 Row를 한 번에 처리한다.
    if (props.getProperty('FLUSH_SCHEDULED') !== '1') {
      props.setProperty('FLUSH_SCHEDULED', '1');
      ScriptApp.newTrigger('flushPendingSync').timeBased().after(DEBOUNCE_DELAY_MS).create();
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * 디바운스 대기 후 실제로 Partial Sync를 실행한다. DEBOUNCE_DELAY_MS 후 1회성
 * 시간 기반 트리거로 자동 호출되며, Google Apps Script는 1회성 트리거를 실행 후
 * 자동으로 삭제하므로 별도 정리가 필요 없다.
 */
function flushPendingSync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    // 다른 flush가 이미 진행 중이면 이번 실행은 건너뛴다 — 처리 못한 Row는 pending에
    // 그대로 남아있으므로 데이터 손실 없이 다음 편집 때 다시 flush가 예약된다.
    Logger.log('flushPendingSync: 다른 실행이 Lock을 보유 중이라 건너뜁니다.');
    return;
  }
  try {
    props_deleteFlushScheduledFlag_();
    for (var sourceSheetKey in SHEET_NAMES) {
      flushPendingSyncForSheet_(sourceSheetKey);
    }
  } finally {
    lock.releaseLock();
  }
}

function props_deleteFlushScheduledFlag_() {
  PropertiesService.getScriptProperties().deleteProperty('FLUSH_SCHEDULED');
}

function flushPendingSyncForSheet_(sourceSheetKey) {
  var props = PropertiesService.getScriptProperties();
  var pendingKey = 'PENDING_ROWS_' + sourceSheetKey;
  var pendingRaw = props.getProperty(pendingKey);
  props.deleteProperty(pendingKey);
  if (!pendingRaw) return;

  var rowNumbers = JSON.parse(pendingRaw);
  if (!rowNumbers || rowNumbers.length === 0) return;

  var sheetName = SHEET_NAMES[sourceSheetKey];
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return;

  // flush 시점 기준 시트의 "현재" 값을 다시 읽는다(onEdit 발생 시점이 아니라) — 디바운스
  // 대기 중 같은 Row가 또 바뀌었어도 최신 값이 반영된다.
  var payload = buildPayloadForRows_(sheet, rowNumbers);
  if (payload.rows.length === 0) {
    Logger.log('[' + sheetName + '] Partial Sync — 보낼 데이터가 없습니다(빈 Row만 수정됨).');
    return;
  }
  payload.sync_mode = 'partial'; // 수정된 Row만 보내는 부분 목록 — 누락 상품을 절대 비활성화하지 않는다
  payload.source_sheet = sourceSheetKey;

  sendSyncPayload_(sourceSheetKey, sheetName, sheet, payload);
}

// =====================================================================
// 3) 기존 수동/주기 실행 경로 (Full Snapshot Safety Net)
// =====================================================================

/** 두 Sheet를 순서대로 Full Snapshot Sync한다. 10분 트리거 또는 메뉴에서 호출된다. */
function syncAll() {
  syncSheet('permanent');
  syncSheet('event');
}

/** Apps Script 편집기 상단 드롭다운에서 개별 실행/디버그할 때 사용. */
function syncPermanentOnly() {
  syncSheet('permanent');
}
function syncEventOnly() {
  syncSheet('event');
}

function syncSheet(sourceSheetKey) {
  var sheetName = SHEET_NAMES[sourceSheetKey];
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('시트를 찾을 수 없습니다: ' + sheetName);
    return;
  }

  var payload = buildPayload_(sheet);
  if (payload.rows.length === 0) {
    Logger.log('[' + sheetName + '] 보낼 데이터가 없습니다.');
    return;
  }
  // syncPermanentOnly/syncEventOnly/syncAll은 항상 Sheet 전체를 읽어 보내는
  // 정상적인 전체 Sync이므로 "full_snapshot"을 명시한다 — 이 값이 있어야만
  // 서버가 누락된 기존 상품을 비활성화 대상으로 검토한다(안전장치 통과 시에만
  // 실제 비활성화). source_sheet도 같이 보내 엔드포인트 불일치를 서버가 걸러내게 한다.
  payload.sync_mode = 'full_snapshot';
  payload.source_sheet = sourceSheetKey;

  sendSyncPayload_(sourceSheetKey, sheetName, sheet, payload);
}

// =====================================================================
// 4) 공통 — API 호출/응답 처리, payload 직렬화, product_id 되쓰기
// =====================================================================

function sendSyncPayload_(sourceSheetKey, sheetName, sheet, payload) {
  var props = PropertiesService.getScriptProperties();
  var apiBaseUrl = props.getProperty('SYNC_API_BASE_URL');
  var apiSecret = props.getProperty('SYNC_API_SECRET');

  if (!apiBaseUrl || !apiSecret) {
    Logger.log('SYNC_API_BASE_URL / SYNC_API_SECRET이 Script Properties에 설정되지 않았습니다.');
    return;
  }

  var endpoint = apiBaseUrl.replace(/\/$/, '') + '/api/sync/' + sourceSheetKey;

  var response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiSecret,
      // ngrok 무료 플랜은 브라우저가 아닌 요청(Apps Script의 UrlFetchApp 포함)에
      // 기본적으로 경고 인터스티셜 HTML을 반환한다 — 이 헤더가 없으면 JSON 대신
      // 그 경고 페이지가 와서 아래 JSON.parse가 깨진다. DEV 터널 전용이며 실제
      // 배포(Vercel 등) 앞단에는 ngrok이 없으므로 무해하다.
      'ngrok-skip-browser-warning': 'true',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var status = response.getResponseCode();
  var body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log('[' + sheetName + '] 응답 파싱 실패: ' + response.getContentText());
    return;
  }

  if (status === 409) {
    Logger.log(
      '[' + sheetName + '] ⚠️ 대량 비활성화 안전장치 발동(' + payload.sync_mode + ') — Sync 중단됨. 관리자 확인 필요: ' +
        (body.deactivationGuard && body.deactivationGuard.reason),
    );
    return;
  }
  if (status !== 200) {
    Logger.log('[' + sheetName + '] Sync 실패 (HTTP ' + status + ', mode=' + payload.sync_mode + '): ' + JSON.stringify(body));
    return;
  }

  Logger.log(
    '[' + sheetName + '] 완료(' + payload.sync_mode + ', ' + payload.rows.length + '행) — 신규 ' + body.insertedCount +
      ', 수정 ' + body.updatedCount +
      ', 비활성 ' + body.deactivatedCount +
      ', 실패 ' + body.failedCount,
  );
  if (body.errors && body.errors.length > 0) {
    Logger.log('[' + sheetName + '] 오류 목록: ' + JSON.stringify(body.errors));
  }

  // 서버가 새로 채번한 product_id를 해당 Row/컬럼에 되써준다 — 이 컬럼 1개만 예외적으로 쓴다.
  if (body.productIdAssignments && body.productIdAssignments.length > 0) {
    writeBackProductIds_(sourceSheetKey, sheet, body.productIdAssignments);
  }
}

/** 헤더+데이터 값 1개 Row를 API가 기대하는 { rowNumber, values } 형태로 직렬화한다. */
function serializeRow_(headers, rowValues, rowNumber) {
  var values = {};
  var hasAny = false;
  for (var c = 0; c < headers.length; c++) {
    var header = String(headers[c]).trim();
    if (!header) continue;
    var cell = rowValues[c];
    if (cell instanceof Date) {
      cell = Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    values[header] = cell === '' ? null : cell;
    if (cell !== '' && cell !== null && cell !== undefined) hasAny = true;
  }
  return hasAny ? { rowNumber: rowNumber, values: values } : null;
}

/** 헤더 1행 + 데이터 Row 전체를 직렬화한다(Full Snapshot 경로 전용). */
function buildPayload_(sheet) {
  var allValues = sheet.getDataRange().getValues();
  if (allValues.length < 2) return { headers: [], rows: [] };

  var headers = allValues[0];
  var rows = [];
  for (var r = 1; r < allValues.length; r++) {
    var row = serializeRow_(headers, allValues[r], r + 1); // Sheet는 1-based, 헤더가 1행이므로 데이터는 r+1
    if (row) rows.push(row);
  }
  return { headers: headers, rows: rows };
}

/** 지정된 Row 번호들만 골라 직렬화한다(Partial Sync 경로 전용) — flush 시점의 최신 값을 다시 읽는다. */
function buildPayloadForRows_(sheet, rowNumbers) {
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var rows = [];
  rowNumbers
    .filter(function (r) {
      return r >= 2 && r <= lastRow; // 편집 이후 Row가 삭제됐을 수 있으므로 현재 범위 밖이면 제외
    })
    .sort(function (a, b) {
      return a - b;
    })
    .forEach(function (r) {
      var rowValues = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
      var row = serializeRow_(headers, rowValues, r);
      if (row) rows.push(row);
    });

  return { headers: headers, rows: rows };
}

/** product_id 컬럼의 정확한 열 위치를 찾아 새로 채번된 값만 되써준다. */
function writeBackProductIds_(sourceSheetKey, sheet, assignments) {
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var productIdCol = -1;
  for (var i = 0; i < headerRow.length; i++) {
    if (String(headerRow[i]).trim() === 'product_id') {
      productIdCol = i + 1; // 1-based
      break;
    }
  }
  if (productIdCol === -1) {
    Logger.log('product_id 컬럼을 찾을 수 없어 되쓰기를 건너뜁니다. 헤더에 "product_id" 컬럼을 추가해주세요.');
    return;
  }

  var props = PropertiesService.getScriptProperties();
  var flagKey = 'WRITEBACK_IN_PROGRESS_' + sourceSheetKey;
  // onEdit Loop 방지 플래그. Apps Script 공식 동작상 스크립트가 직접 쓴 값 변경은
  // onEdit을 발생시키지 않으므로 이 플래그 없이도 Loop는 일어나지 않아야 하지만,
  // 설치 후 README.md §9 체크리스트에서 실제로 handleEditTrigger가 재호출되지
  // 않는지 반드시 실행 로그로 직접 확인한다 — 이 플래그는 그 보장이 깨지는 경우에
  // 대한 방어선이다.
  props.setProperty(flagKey, '1');
  try {
    // 안전장치: payload를 만든 시점과 되쓰는 시점 사이에 사람이 행을 삽입/삭제하면
    // rowNumber가 다른 상품을 가리킬 수 있다. 그 대상 셀이 여전히 비어있을 때만
    // 쓴다 — 이미 값이 있다면(이미 채번됐거나 다른 상품이 그 자리로 밀려온 것)
    // 절대 덮어쓰지 않고 다음 Sync 실행 때 다시 판단하도록 건너뛴다. Partial Sync는
    // 이 Row 번호 드리프트를 자체적으로 완전히 해결하지 않지만, 10분 Full Snapshot
    // Safety Net이 product_id 기준으로 다시 확인해 결국 정합성을 맞춘다.
    var written = 0;
    assignments.forEach(function (a) {
      var cell = sheet.getRange(a.rowNumber, productIdCol);
      if (String(cell.getValue()).trim() === '') {
        cell.setValue(a.productId);
        written += 1;
      } else {
        Logger.log(
          'Row ' + a.rowNumber + '의 product_id 칸이 비어있지 않아 되쓰기를 건너뜁니다(이미 값 존재: "' +
            cell.getValue() + '"). 다음 Sync에서 재확인됩니다.',
        );
      }
    });
    Logger.log(written + '/' + assignments.length + '개 product_id를 시트에 기록했습니다.');
  } finally {
    props.deleteProperty(flagKey);
  }
}
