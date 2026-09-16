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
 *
 * Partial 경로의 실패/재시도 규칙 (2026-09-15 도입 — DEV localhost가 잠깐 죽어있는 동안
 * onEdit 편집이 그대로 유실된 사고를 계기로 도입):
 * - pending Row 목록은 API 요청이 HTTP 2xx로 성공했을 때만 지운다. 연결 실패/timeout/
 *   5xx/429처럼 "다시 시도하면 될 수 있는" 실패는 pending을 그대로 두고 15초→30초→60초
 *   (최대 3회) 백오프로 재시도한다. 401/403(인증 오류)·409(안전장치 차단)·400(잘못된
 *   요청)처럼 "다시 시도해도 똑같이 실패할" 경우는 재시도하지 않고 로그만 남긴다 —
 *   두 경우 모두 pending은 지우지 않으므로, 다음 편집이나 10분 Full Snapshot Safety Net이
 *   결국 반영한다.
 *
 * flushPendingSync 트리거 생명주기 규칙 (2026-09-16 도입 — 재부팅 후 "사용 중지됨" 상태의
 * flushPendingSync 1회성 트리거가 여러 개 누적돼 있던 것을 발견하고 도입):
 * - "예약돼 있다고 믿는" Property 플래그가 아니라, `ScriptApp.getProjectTriggers()`로
 *   실제 트리거 목록을 매번 직접 확인한다 — 트리거가 예상과 다르게 사라지거나(수동 삭제,
 *   Apps Script 자체 오류 처리 등) 남아있어도 상태가 꼬이지 않는다.
 * - flushPendingSync는 실행될 때마다 시작 시점에 동일 handler의 트리거를 전부 지운다
 *   (자신을 호출한 트리거 포함) — "실행된 1회성 트리거는 항상 즉시 지워진다"는 가정에만
 *   기대지 않고, 재시도가 필요하면 그 다음에 정확히 1개만 새로 만든다. 항상 0개 또는
 *   1개만 존재하도록 이 함수가 스스로 보장한다.
 */

var SHEET_NAMES = {
  permanent: '상시 프로모션',
  event: '행사 프로모션',
};

/** onEdit → flushPendingSync까지의 디바운스(마이크로배칭) 대기 시간. */
var DEBOUNCE_DELAY_MS = 3000;

/** Partial Sync 실패 시 재시도 대기 시간(15초 → 30초 → 60초, 최대 3회). */
var RETRY_BACKOFF_MS = [15000, 30000, 60000];
/** 최초 시도 1회 + 재시도 RETRY_BACKOFF_MS.length회. */
var MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/**
 * Sync 요청 실패를 "재시도할 가치가 있는지"로 분류한다. 외부 서비스(UrlFetchApp,
 * PropertiesService 등)에 전혀 의존하지 않는 순수 함수 — scripts/test-apps-script-retry.ts가
 * 동일한 로직을 복제해 Node에서 격리 테스트한다(이 함수를 고치면 그쪽도 함께 고칠 것).
 */
function classifySyncFailure_(opts) {
  if (opts.networkError) return { retryable: true, reason: 'network' };
  if (opts.jsonParseFailed) return { retryable: true, reason: 'bad_response' };
  var status = opts.httpStatus;
  if (status === 401 || status === 403) return { retryable: false, reason: 'auth' };
  if (status === 409) return { retryable: false, reason: 'guard_blocked' };
  if (status === 429) return { retryable: true, reason: 'rate_limited' };
  if (typeof status === 'number' && status >= 500) return { retryable: true, reason: 'server_error' };
  return { retryable: false, reason: 'client_error' };
}

/**
 * retryCount(이미 실패한 횟수, 1부터 시작)에 대응하는 다음 재시도까지의 대기 시간(ms).
 * 한도를 넘으면 null — 순수 함수, classifySyncFailure_와 같은 이유로 격리 테스트한다.
 */
function nextRetryDelayMs_(retryCount) {
  if (retryCount < 1 || retryCount > RETRY_BACKOFF_MS.length) return null;
  return RETRY_BACKOFF_MS[retryCount - 1];
}

/** 현재 flushPendingSync 1회성 트리거가 실제로 존재하는지(Property 플래그가 아니라 실제 목록 기준). */
function hasScheduledFlushTrigger_() {
  return ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'flushPendingSync';
  });
}

/** flushPendingSync 1회성 트리거를 전부 지운다(중복/stale/disabled 상태 무관하게 전부). */
function deleteFlushPendingSyncTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'flushPendingSync') ScriptApp.deleteTrigger(t);
  });
}

/**
 * onEdit/디바운스/재시도 관련 Script Properties를 전부 초기화한다. pending Row 자체를
 * 지워도 안전한 이유: 10분 Full Snapshot Safety Net은 이 pending 추적과 무관하게 매번
 * Sheet 전체를 다시 읽으므로, 여기서 잊어버린 편집도 결국 다시 반영된다.
 */
function resetPendingSyncState_() {
  var props = PropertiesService.getScriptProperties();
  for (var key in SHEET_NAMES) {
    props.deleteProperty('PENDING_ROWS_' + key);
    props.deleteProperty('WRITEBACK_IN_PROGRESS_' + key);
  }
  props.deleteProperty('SYNC_RETRY_COUNT');
  props.deleteProperty('FLUSH_SCHEDULED'); // 이전 버전이 쓰던 Property — 더 이상 안 쓰지만 남아있으면 지운다
}

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
  // 재부팅/재설치 등으로 남아있을 수 있는 stale·disabled flushPendingSync 트리거와 그
  // 관련 Property 상태를 함께 정리한다 — pending Row를 잊어도 10분 Full Snapshot이
  // 결국 다시 잡아오므로 안전하게 초기화할 수 있다.
  deleteFlushPendingSyncTriggers_();
  resetPendingSyncState_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('handleEditTrigger').forSpreadsheet(ss).onEdit().create();
  Logger.log('설치형 onEdit 트리거를 등록했습니다 — 이제 시트 수정 시 handleEditTrigger가 실행됩니다. (stale flushPendingSync 트리거/상태도 함께 정리됨)');
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

    // 이미 flush 트리거가 실제로 존재하면 새로 예약하지 않는다 — 짧은 시간 내 여러 번
    // 수정해도 트리거가 여러 개 쌓이지 않고, 예약된 시점에 누적된 Row를 한 번에 처리한다.
    // Property 플래그가 아니라 실제 트리거 목록을 직접 확인한다 — 플래그만 믿으면
    // 트리거가 수동으로 지워지거나 예상과 다르게 사라졌을 때 pending이 영원히 묶여있는
    // 사고가 날 수 있다(2026-09-16, 재부팅 후 disabled 트리거를 수동 삭제한 뒤 실제로
    // 겪을 뻔한 상황).
    if (!hasScheduledFlushTrigger_()) {
      ScriptApp.newTrigger('flushPendingSync').timeBased().after(DEBOUNCE_DELAY_MS).create();
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * 디바운스(또는 재시도) 대기 후 실제로 Partial Sync를 실행한다. DEBOUNCE_DELAY_MS 또는
 * RETRY_BACKOFF_MS 후 1회성 시간 기반 트리거로 자동 호출된다. Google Apps Script가
 * 1회성 트리거를 실행 후 항상 즉시 지워준다는 보장에 기대지 않고, 이 함수가 시작하자마자
 * 스스로 동일 handler 트리거를 전부 지운다(아래 deleteFlushPendingSyncTriggers_ 호출).
 *
 * 재시도 여부 판단: 두 Sheet 중 하나라도 "재시도할 가치가 있는" 실패(연결 실패/timeout/
 * 5xx/429)로 끝났으면, 전체를 하나의 재시도 사이클로 보고 공유 카운터(SYNC_RETRY_COUNT)를
 * 올려 백오프 후 이 함수 자체를 다시 예약한다 — 두 Sheet를 매번 같이 재시도하는 단순한
 * 방식을 택했다(실제 원인이 보통 서버/네트워크처럼 두 Sheet에 공통으로 걸리는 문제이기
 * 때문 — 완전히 독립된 재시도 카운터를 각 Sheet마다 두는 것은 과한 설계로 보고 생략).
 */
function flushPendingSync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    // 다른 flush가 이미 진행 중이면 이번 실행은 건너뛴다 — 처리 못한 Row는 pending에
    // 그대로 남아있으므로 데이터 손실 없이 다음 편집 때 다시 flush가 예약된다.
    Logger.log('flushPendingSync: 다른 실행이 Lock을 보유 중이라 건너뜁니다.');
    return;
  }
  var props = PropertiesService.getScriptProperties();
  try {
    // 지금 나를 호출한 1회성 트리거를 포함해 동일 handler의 트리거를 전부 지운다 —
    // "실행된 1회성 트리거는 Apps Script가 알아서 지워준다"는 가정에만 기대지 않고,
    // 이 함수가 스스로 항상 정확히 0개/1개 상태를 보장한다(재시도가 필요하면 바로
    // 아래서 정확히 1개만 새로 만든다). 재부팅 후 disabled 상태로 여러 개 누적됐던
    // 사고의 재발 방지 — Apps Script가 정확히 언제 트리거를 지우는지 문서만으로는
    // 완전히 보장할 수 없으므로, 실행될 때마다 직접 정리하는 쪽을 택했다.
    deleteFlushPendingSyncTriggers_();

    var anyRetryNeeded = false;
    for (var sourceSheetKey in SHEET_NAMES) {
      if (flushPendingSyncForSheet_(sourceSheetKey)) anyRetryNeeded = true;
    }

    if (!anyRetryNeeded) {
      props.deleteProperty('SYNC_RETRY_COUNT');
      return;
    }

    var retryCount = Number(props.getProperty('SYNC_RETRY_COUNT') || '0') + 1;
    var delay = nextRetryDelayMs_(retryCount);
    if (delay === null) {
      Logger.log(
        'Sync 재시도 한도(' + RETRY_BACKOFF_MS.length + '회) 초과 — 이번 편집은 10분 Full Snapshot Safety Net이 최종 복구합니다.',
      );
      props.deleteProperty('SYNC_RETRY_COUNT'); // pending Row 자체는 지우지 않는다 — 다음 편집이나 Full Snapshot이 이어받는다.
    } else {
      props.setProperty('SYNC_RETRY_COUNT', String(retryCount));
      // 위에서 이미 동일 handler 트리거를 전부 지웠으므로, 지금 정확히 1개만 새로 생긴다.
      ScriptApp.newTrigger('flushPendingSync').timeBased().after(delay).create();
      Logger.log(delay / 1000 + '초 후 Sync 재시도(' + (retryCount + 1) + '/' + MAX_ATTEMPTS + ') 예정.');
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * 이 Sheet의 pending Row를 Partial Sync로 전송한다.
 * 반환값: 재시도할 가치가 있는 실패로 pending이 그대로 남았으면 true, 그 외(성공/재시도
 * 불필요/보낼 데이터 없음)는 false.
 */
function flushPendingSyncForSheet_(sourceSheetKey) {
  var props = PropertiesService.getScriptProperties();
  var pendingKey = 'PENDING_ROWS_' + sourceSheetKey;
  var pendingRaw = props.getProperty(pendingKey);
  if (!pendingRaw) return false; // 이 Sheet는 대기 중인 편집이 없음

  var rowNumbers = JSON.parse(pendingRaw);
  if (!rowNumbers || rowNumbers.length === 0) {
    props.deleteProperty(pendingKey);
    return false;
  }

  var sheetName = SHEET_NAMES[sourceSheetKey];
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    props.deleteProperty(pendingKey);
    return false;
  }

  // flush 시점 기준 시트의 "현재" 값을 다시 읽는다(onEdit 발생 시점이 아니라) — 디바운스/
  // 재시도 대기 중 같은 Row가 또 바뀌었어도 최신 값이 반영된다.
  var payload = buildPayloadForRows_(sheet, rowNumbers);
  if (payload.rows.length === 0) {
    Logger.log('[' + sheetName + '] Partial Sync — 보낼 데이터가 없습니다(빈 Row만 수정됨).');
    props.deleteProperty(pendingKey);
    return false;
  }
  payload.sync_mode = 'partial'; // 수정된 Row만 보내는 부분 목록 — 누락 상품을 절대 비활성화하지 않는다
  payload.source_sheet = sourceSheetKey;

  var attempt = Number(props.getProperty('SYNC_RETRY_COUNT') || '0') + 1; // 1 = 최초 시도
  var result = sendSyncPayload_(sourceSheetKey, sheetName, sheet, payload, attempt, MAX_ATTEMPTS);

  if (result.ok) {
    props.deleteProperty(pendingKey); // pending은 API 요청이 2xx 성공했을 때만 지운다
    return false;
  }
  if (!result.retryable) {
    // 인증 오류/안전장치 차단/잘못된 요청 등 — 재시도해도 결과가 달라지지 않는다.
    // pending은 지우지 않고 그대로 둔다(다음 편집 또는 10분 Full Snapshot이 이어받는다).
    return false;
  }
  return true; // 연결 실패/5xx/429 — 재시도 대상, pending도 그대로 유지
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

  // Full Snapshot 경로는 재시도하지 않는다 — 실패해도 10분 뒤 다음 syncAll 실행 자체가
  // 사실상의 재시도이므로, 여기서 추가로 백오프 재시도를 걸 필요가 없다.
  sendSyncPayload_(sourceSheetKey, sheetName, sheet, payload, 1, 1);
}

// =====================================================================
// 4) 공통 — API 호출/응답 처리, payload 직렬화, product_id 되쓰기
// =====================================================================

/**
 * Sync API를 1회 호출한다. 성공/실패와 그 사유를 구조화된 값으로 반환해서, 호출부가
 * (재시도할지/pending을 지울지)를 결정할 수 있게 한다. 매 시도마다 실행 로그에
 * source sheet / mode / row count / attempt(재시도 횟수) / HTTP status / 성공-실패를
 * 한 줄로 남긴다(§4 요구사항).
 *
 * 반환값: { ok, status, retryable, reason }
 */
function sendSyncPayload_(sourceSheetKey, sheetName, sheet, payload, attempt, maxAttempts) {
  var props = PropertiesService.getScriptProperties();
  var apiBaseUrl = props.getProperty('SYNC_API_BASE_URL');
  var apiSecret = props.getProperty('SYNC_API_SECRET');

  var label = '[' + sheetName + '] Sync attempt=' + attempt + '/' + maxAttempts +
    ' mode=' + payload.sync_mode + ' rows=' + payload.rows.length;

  if (!apiBaseUrl || !apiSecret) {
    Logger.log(label + ' status=(설정없음) → 실패(config) — SYNC_API_BASE_URL/SYNC_API_SECRET이 Script Properties에 설정되지 않았습니다. 재시도하지 않음.');
    return { ok: false, status: null, retryable: false, reason: 'config' };
  }

  var endpoint = apiBaseUrl.replace(/\/$/, '') + '/api/sync/' + sourceSheetKey;

  var response;
  try {
    response = UrlFetchApp.fetch(endpoint, {
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
      muteHttpExceptions: true, // HTTP 상태코드로는 예외를 던지지 않음 — 아래에서 status로 직접 분기
    });
  } catch (fetchError) {
    // muteHttpExceptions는 HTTP 오류 상태코드에만 적용된다 — 서버 자체가 죽어있거나(연결
    // 거부), DNS/timeout처럼 진짜 네트워크 장애면 UrlFetchApp.fetch가 예외를 던진다.
    // DEV localhost가 잠깐 내려가 있었을 때 이 경로로 편집이 유실됐던 사고를 계기로
    // 반드시 잡아서 재시도 대상으로 분류한다.
    var netResult = classifySyncFailure_({ networkError: true });
    Logger.log(label + ' status=연결실패 → 실패(' + netResult.reason + ') — ' + fetchError.message);
    return { ok: false, status: null, retryable: netResult.retryable, reason: netResult.reason };
  }

  var status = response.getResponseCode();
  var body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (parseError) {
    var parseResult = classifySyncFailure_({ jsonParseFailed: true });
    Logger.log(label + ' status=' + status + ' → 실패(' + parseResult.reason + ') — 응답 파싱 실패: ' + response.getContentText());
    return { ok: false, status: status, retryable: parseResult.retryable, reason: parseResult.reason };
  }

  if (status === 200) {
    Logger.log(
      label + ' status=200 → 성공 — 신규 ' + body.insertedCount +
        ', 수정 ' + body.updatedCount +
        ', 비활성 ' + body.deactivatedCount +
        ', 실패 ' + body.failedCount +
        ', 스킵 ' + body.skippedCount, // 빈 Row 등 정상 스킵 — 실패 아님(§18)
    );
    if (body.skipped && body.skipped.length > 0) {
      Logger.log('[' + sheetName + '] 스킵된 Row 목록: ' + JSON.stringify(body.skipped));
    }
    if (body.errors && body.errors.length > 0) {
      Logger.log('[' + sheetName + '] 오류 목록: ' + JSON.stringify(body.errors));
    }
    // 서버가 새로 채번한 product_id를 해당 Row/컬럼에 되써준다 — 이 컬럼 1개만 예외적으로 쓴다.
    if (body.productIdAssignments && body.productIdAssignments.length > 0) {
      writeBackProductIds_(sourceSheetKey, sheet, body.productIdAssignments);
    }
    return { ok: true, status: status, retryable: false, reason: null };
  }

  var result = classifySyncFailure_({ httpStatus: status });
  if (status === 409) {
    Logger.log(
      label + ' status=409 → 실패(guard_blocked) — 대량 비활성화 안전장치 발동, 재시도하지 않음. 관리자 확인 필요: ' +
        (body.deactivationGuard && body.deactivationGuard.reason),
    );
  } else if (status === 401 || status === 403) {
    Logger.log(label + ' status=' + status + ' → 실패(auth) — 인증 오류, 재시도하지 않음. SYNC_API_SECRET이 서버 .env.local과 일치하는지 확인하세요.');
  } else if (result.retryable) {
    Logger.log(label + ' status=' + status + ' → 실패(' + result.reason + ') — 재시도 대상: ' + JSON.stringify(body));
  } else {
    Logger.log(label + ' status=' + status + ' → 실패(' + result.reason + '), 재시도하지 않음: ' + JSON.stringify(body));
  }
  return { ok: false, status: status, retryable: result.retryable, reason: result.reason };
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
