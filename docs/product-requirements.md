# Product Requirements (Phase 1)

> 전제: 이 문서는 [current-system-analysis.md](./current-system-analysis.md)의 실측 결과를 기반으로 작성되었다. 상세 DB 구조는 [database-schema.md](./database-schema.md), 권한은 [permissions.md](./permissions.md), Sync는 [sync-design.md](./sync-design.md), Push는 [push-design.md](./push-design.md) 참조.

## 1. 직원(STAFF/STORE_MANAGER) User Journey

```
출근 → PWA 홈 화면 아이콘 실행 (자동 로그인 유지)
  → 홈: 긴급/필독 공지, 진행중 행사, 최근 72시간 중요 변경 요약 확인
  → (고객 응대 중) 하단 검색 or 프로모션 탭에서 브랜드/제품명/컬러 검색
  → 상품 상세: 가격 2종, 사은품, 구성품, 매장별 운영조건, 포토후기 혜택 확인
  → (행사 기간 중) 행사 프로모션 탭에서 진행중 행사상품 별도 확인
  → Push 수신 시 딥링크로 변경된 상품/공지 바로 진입
  → 필독공지(신상품 교육 공지 포함, §4.6 참조)는 [확인 완료] 처리
```

## 2. 관리자(ADMIN) User Journey

```
Google Spreadsheet에서 [상시 프로모션] 또는 [행사 프로모션] 수정
  → Apps Script가 변경 감지 → 서버 Sync API 호출 → Supabase 반영
  → (선택) 관리자 웹에서 Sync 상태/실패 확인
  → 공지 작성(대상 매장/Role 지정) → Push 발송(배치/즉시)
  → 신상품 입고 시 "교육" 유형 공지 등록(필독 지정 + 첨부파일/영상URL/상세페이지URL) — §4.6 참조
  → 필요 시 행사 노출 ON/OFF, Dynamic Field 표시 설정 조정
  → 변경이력/열람현황/Sync 오류를 Admin 화면에서 확인
```

## 3. Navigation

**직원 (Mobile, Bottom Navigation)** — ✅ Phase 9 SKIP 결정(2026-09-17)으로 4개 탭 확정, §4.6 참조
```
[ 홈 ] [ 프로모션 ] [ 공지 ] [ MY ]
```
- 프로모션 탭 내부: `상시` / `행사` / `NEW` 서브탭 (행사가 하나도 활성화되지 않은 기간에는 `행사` 서브탭을 숨기거나 "진행중인 행사 없음" 상태로 처리)
- 공지에 미확인 항목이 있으면 Bottom Nav에 Count Badge 표시(신상품 교육 공지 포함)

**관리자 (Desktop First, Sidebar Navigation)**
```
사용자 | 매장 | 공지 | 프로모션(상시/행사/변경이력/Sync상태) | 행사 캠페인 | Dynamic Field 설정 | Push | Audit
```

## 4. 기능 요구사항 (Functional Requirements)

### 4.1 홈
- 우선순위: 긴급공지 > 필독공지(신상품 교육 공지 포함) > 중요공지 > 미확인공지 > 현재 진행중 행사 배너 > 최근 72시간 주요 변경 요약 > 종료임박 행사 > 통계(전체 상시 건수/활성 행사 건수/최근 Sync 시각)
- 통합 검색바 상시 노출(브랜드/제품명/컬러)

### 4.2 프로모션 — 상시
- 실측 18개 컬럼 중 Core 15개 + Softr 전용 메타 3개(NEW/수정일/최근수정건수 — 신규 시스템에서는 자체 계산으로 대체, 원본 그대로 노출하지 않음) 반영
- 브랜드 검색/필터, 통합검색, NEW 필터, 최근 변경 필터
- Mobile: Card View / Desktop: Table View 겸용

### 4.3 프로모션 — 행사
- `event_campaigns` 단위로 그룹핑하여 표시 (예: "링크맘 전국 베이비페어 9/20~10/4, 행사상품 37개")
- 노출 조건을 만족하는 캠페인만 노출 (§6 참조)
- 상시와 시각적으로 명확히 구분 (배지/색상/섹션 분리)
- 다중 캠페인 동시 운영 지원 (하드코딩 금지)

### 4.4 NEW (최근 72시간)
- 신규 상품(등록 후 72시간 이내) 또는 중요 필드 변경(가격/프로모션/혜택/사은품/행사기간/판매조건) 발생 시 노출
- Rolling 72h, 자동 만료, `last_important_change_at DESC` 정렬
- 무엇이 바뀌었는지(before → after) 카드에 직접 표시
- minor 수정(공백/오타/내부관리 필드/타임스탬프만 변경)은 제외 — 실측 데이터의 `"재고 소진"` vs `"재고소진"` 같은 표기 차이가 대표 사례

### 4.5 공지사항
- 유형: 일반/중요/긴급/필독/행사/발주/판매가변경/공급가변경/운영/시스템/**교육**(Phase 9 SKIP 결정으로 추가, §4.6)
- 대상: 전체/특정매장/복수매장/특정Role/특정사용자
- 필독공지 [확인 완료] 액션, ADMIN은 열람/확인 현황(대상 대비 열람/미열람/확인/미확인) 조회

### 4.6 교육자료 → Notice System으로 통합 (Phase 9 SKIP, 2026-09-17 확정)
별도 Training Material System(전용 테이블/탭/Admin UI)은 구현하지 않는다. 신상품 교육/제품 가이드/상담 가이드/브랜드 교육 등 기존 교육자료의 용도는 전부 4.5 공지사항으로 대체한다.

- 공지 유형에 `교육`을 추가해 교육 목적 공지를 구분한다(변경 중요도는 다른 일반 정보성 유형과 동일하게 `minor`).
- 첨부(PDF/이미지/PPT/문서)와 외부링크(영상URL/상세페이지URL 등)는 4.5 공지사항의 첨부파일(`attachments`)/`external_link` 필드를 그대로 사용한다 — 교육자료 전용 파일 구조를 별도로 만들지 않는다.
- "필수교육"은 공지의 `requires_confirmation`(필독)을 그대로 사용한다: 신상품 교육 공지 → 필독 지정 → 직원 상세 열람(read) → [확인 완료](confirmed). 별도 교육 이수 시스템은 만들지 않는다.
- 대상 지정(전체/매장/복수매장/Role)도 공지 Targeting을 그대로 사용한다.
- 근거: 신상품 교육자료가 요구하는 기능(자료 첨부, 필독 확인, 매장/Role별 배포, 열람 현황)이 공지사항과 완전히 동일한 구조라 별도 시스템을 유지할 이유가 없다고 판단.

### 4.7 Push / Notification Center
- Web Push(VAPID), Foreground는 Supabase Realtime + Toast, Background는 OS Push
- 대상 Field 변경 시에만 발송(경미한 변경 제외), 다건 변경은 Summary Batch로 통합
- Deep Link로 상품/공지/캠페인 상세 진입(교육 공지도 `/notices/{notice_id}`로 통합)
- 알림센터에서 Push 놓친 내역도 확인 가능, App Badge

### 4.8 MY
- 프로필, 소속 매장, Push 수신 설정, 로그아웃, 비밀번호 변경

### 4.9 Admin
§69 전체 항목(사용자/매장/공지/프로모션/행사/Field/Notification/System) 구현. 상세는 [database-schema.md](./database-schema.md) 및 [permissions.md](./permissions.md).

## 5. 비기능 요구사항 (Non-functional)

- **PWA**: manifest, Service Worker, standalone, iOS/Android 홈 화면 설치 안내
- **성능**: 188~수천 SKU 규모까지 서버사이드 검색/페이지네이션, 전체 로드 후 client filter 방식 지양
- **보안**: RLS 전면 적용, Service Role Key/VAPID Private Key 서버 전용, Public Sign-up 금지
- **캐시 신선도**: 가격/프로모션 데이터는 Stale Cache 금지 (배포 시 새 가격이 즉시 반영되어야 함 — §74)
- **운영 지속성**: 본사 담당자가 Spreadsheet만 고치면 되고, Claude Code/재배포가 일상 운영에 개입하지 않아야 함(§3 절대 원칙)
- **확장성**: 매장 수, 직원 수, Spreadsheet 컬럼 수 증가를 기본 가정으로 설계 (Dynamic Field 구조)

## 6. 상시/행사 운영 Rule (요약 — 상세는 sync-design.md)

- 노출여부 OFF → 무조건 비노출
- 노출여부 ON + 현재시각이 시작일~종료일 사이 → 노출
- 노출여부 ON + 시작 전 → 기본 비노출(또는 "예정행사" 별도 표시)
- 노출여부 ON + 종료일 경과 → 자동 비노출 (담당자가 OFF 처리를 깜빡해도 안전)
- 비노출이어도 데이터는 보존 (Soft 처리, 삭제 아님)
- ✅ **확정**: 실측 결과 현재 [행사 프로모션] 시트에는 노출여부/시작일/종료일/행사명 컬럼이 존재하지 않아 Phase 6에서 신설하기로 본사 담당자 동의를 받았다. 개발/복제 시트에서 먼저 검증한 뒤 실제 운영 시트에 반영한다 (sync-design.md §7 참조).

## 7. Change Classification 요약 (NEW = Push 공유)

| 변경 필드 | importance | NEW | Push |
|---|---|---|---|
| 소비자가/기준판매가/카드결제가/현금이체가 | important | O | O |
| 프로모션/매장프로모션/판매조건 | important | O | O |
| 기본구성품/증정사은품/행사사은품 | important | O | O |
| 행사기간 | important | O | O |
| 긴급 판매조건 변경 | critical | O | 즉시 발송(배치 제외) |
| 공백/오타/표기정리/내부관리 필드/타임스탬프만 | minor | X | X |

## 8. 사용자 의사결정 확정 사항

아래는 §8(구 버전)에서 확인을 요청했던 항목에 대해 본사 담당자(사용자)가 확정한 내용이다.

1. **[행사 프로모션] 시트 컬럼 신설**: `행사명`/`시작일`/`종료일`/`노출여부` 신설에 동의. 실제 운영 시트가 아닌 개발/복제 시트에서 먼저 검증 후 반영 (sync-design.md §7).
2. **`product_id` 채번 방식**: **서버 자동 채번**으로 확정. 담당자가 시트에 수동으로 값을 입력할 필요가 없으며, 신규 Row 등록 시 Sync 서버가 채번 후 Apps Script를 통해 해당 셀에 값을 다시 써준다 (sync-design.md §4).
3. **매장 목록**: **용인본점, 동백점** 2곳으로 확정. **향후 매장이 추가될 계획이 있음** — Store 관련 로직/RLS/Push Targeting/Notice Targeting 어디에도 매장명·매장 개수를 하드코딩하지 않고, `stores` 테이블 행 추가만으로 신규 매장이 반영되도록 설계한다.
4. **STORE_MANAGER 권한**: STORE_MANAGER의 유일한 추가 권한은 **용인본점과 동백점(=현재 전체 매장)의 모든 프로모션을 조회**할 수 있다는 것뿐이다. 즉 STAFF처럼 자신이 소속된 매장으로 조회 범위가 제한되지 않고, **소속 매장과 무관하게 전체 매장의 프로모션 데이터**를 볼 수 있다. 공지 등 그 외 기능은 STAFF와 동일(자신의 매장 대상 항목만). 향후 매장이 늘어나도 "전체 매장"으로 자동 확장되도록 역할 단위 권한으로 설계한다(특정 매장 이름을 하드코딩하지 않음). 상세는 [permissions.md](./permissions.md) §1, §3 참조.
   (⚠️ Phase 6.5 재검토로 이 예외 자체가 폐기됐다 — 위 §3 STORE_MANAGER 행 및 permissions.md §1 참조. 이 항목은 최초 확정 시점 기록으로 보존.)
5. **Phase 9(Training Material System) SKIP** (2026-09-17 확정): 별도 교육자료 테이블/탭/Admin UI를 만들지 않고, Phase 8 Notice System의 첨부파일(`attachments`)/외부링크(`external_link`)/필독(`requires_confirmation`)/확인완료(`notice_reads.confirmed_at`)/Targeting 기능으로 전부 대체한다. 공지 유형에 `교육`을 추가해 구분한다. 상세는 §4.6.

## 9. 남은 확인 필요 항목

- **공지유형/매장별운영 등 자유 텍스트 필드의 표준화 여부** — 예: "재고 소진"/"재고소진" 같은 표기를 통일할지, 아니면 시스템이 정규화(trim/normalize)해서 흡수할지. (아직 결정 대기 — 1차 버전은 시스템이 trim/공백정규화로 흡수하는 것을 기본값으로 진행하고, 필요 시 추후 재논의)
