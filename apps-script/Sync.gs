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
 */

var SHEET_NAMES = {
  permanent: '상시 프로모션',
  event: '행사 프로모션',
};

/** Apps Script 편집기에서 이 함수를 한 번 실행해 트리거를 등록한다. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncAll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(10).create();
  Logger.log('10분마다 syncAll()이 실행되도록 트리거를 등록했습니다.');
}

/** 두 Sheet를 순서대로 Sync한다. 트리거 또는 메뉴에서 호출된다. */
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
  var props = PropertiesService.getScriptProperties();
  var apiBaseUrl = props.getProperty('SYNC_API_BASE_URL');
  var apiSecret = props.getProperty('SYNC_API_SECRET');

  if (!apiBaseUrl || !apiSecret) {
    Logger.log('SYNC_API_BASE_URL / SYNC_API_SECRET이 Script Properties에 설정되지 않았습니다.');
    return;
  }

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
  // 실제 비활성화). sourceSheet도 같이 보내 엔드포인트 불일치를 서버가 걸러내게 한다.
  payload.sync_mode = 'full_snapshot';
  payload.source_sheet = sourceSheetKey;

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
      '[' + sheetName + '] ⚠️ 대량 비활성화 안전장치 발동 — Sync 중단됨. 관리자 확인 필요: ' +
        (body.deactivationGuard && body.deactivationGuard.reason),
    );
    return;
  }
  if (status !== 200) {
    Logger.log('[' + sheetName + '] Sync 실패 (HTTP ' + status + '): ' + JSON.stringify(body));
    return;
  }

  Logger.log(
    '[' + sheetName + '] 완료 — 신규 ' + body.insertedCount +
      ', 수정 ' + body.updatedCount +
      ', 비활성 ' + body.deactivatedCount +
      ', 실패 ' + body.failedCount,
  );
  if (body.errors && body.errors.length > 0) {
    Logger.log('[' + sheetName + '] 오류 목록: ' + JSON.stringify(body.errors));
  }

  // 서버가 새로 채번한 product_id를 해당 Row/컬럼에 되써준다 — 이 컬럼 1개만 예외적으로 쓴다.
  if (body.productIdAssignments && body.productIdAssignments.length > 0) {
    writeBackProductIds_(sheet, body.productIdAssignments);
  }
}

/** 헤더 1행 + 데이터 Row 전체를 API가 기대하는 형태로 직렬화한다. */
function buildPayload_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { headers: [], rows: [] };

  var headers = values[0];
  var rows = [];

  for (var r = 1; r < values.length; r++) {
    var rowValues = {};
    var hasAny = false;
    for (var c = 0; c < headers.length; c++) {
      var header = String(headers[c]).trim();
      if (!header) continue;
      var cell = values[r][c];
      if (cell instanceof Date) {
        cell = Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      rowValues[header] = cell === '' ? null : cell;
      if (cell !== '' && cell !== null && cell !== undefined) hasAny = true;
    }
    if (hasAny) {
      rows.push({ rowNumber: r + 1, values: rowValues }); // Sheet는 1-based, 헤더가 1행이므로 데이터는 r+1
    }
  }

  return { headers: headers, rows: rows };
}

/** product_id 컬럼의 정확한 열 위치를 찾아 새로 채번된 값만 되써준다. */
function writeBackProductIds_(sheet, assignments) {
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
  // 안전장치: payload를 만든 시점과 되쓰는 시점 사이에 사람이 행을 삽입/삭제하면
  // rowNumber가 다른 상품을 가리킬 수 있다. 그 대상 셀이 여전히 비어있을 때만
  // 쓴다 — 이미 값이 있다면(이미 채번됐거나 다른 상품이 그 자리로 밀려온 것)
  // 절대 덮어쓰지 않고 다음 Sync 실행 때 다시 판단하도록 건너뛴다.
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
}
