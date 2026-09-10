# CLAUDE.md — 링크맘 매장 직원용 내부 운영 PWA

이 파일은 프로젝트 전체에 지속 적용되는 규칙이다. 상세 설계는 `docs/`를 참조한다.

## 문서 맵
- [docs/current-system-analysis.md](docs/current-system-analysis.md) — 현행 Softr/Spreadsheet 실측 분석
- [docs/product-requirements.md](docs/product-requirements.md) — 요구사항/User Journey/Navigation
- [docs/architecture.md](docs/architecture.md) — 시스템 아키텍처
- [docs/database-schema.md](docs/database-schema.md) — DB 스키마/ERD
- [docs/permissions.md](docs/permissions.md) — Role/RLS
- [docs/sync-design.md](docs/sync-design.md) — Google Sheet ↔ Supabase Sync
- [docs/push-design.md](docs/push-design.md) — Web Push 설계

## 절대 원칙 (위반 금지)

1. 이 시스템은 Demo가 아니라 링크맘 본사/매장 직원이 매일 쓰는 **Production 내부 업무 시스템**이다.
2. 프로모션 데이터의 **Source of Truth는 Google Spreadsheet**다. `[상시 프로모션]`과 `[행사 프로모션]`은 서로 다른 목적을 가진 **별개의 Source Sheet**이며 하나로 합치지 않는다.
3. **본사 담당자가 Spreadsheet만 고치면 매장 직원 화면에 반영되어야 한다.** 프로모션 데이터를 고칠 때마다 개발자 개입, Claude Code 실행, Frontend 재배포, Vercel 재배포가 필요한 구조를 절대 만들지 않는다. Sync는 One-way(Sheet → Supabase)만 존재한다.
4. 행사 프로모션은 ON/OFF 노출 제어가 가능해야 하고, ON이어도 종료일이 지나면 **자동으로 비노출**되어야 한다(담당자가 OFF를 깜빡해도 안전). 비노출은 삭제가 아니다 — 데이터는 보존한다. 여러 행사가 동시에 운영될 수 있으므로 캠페인을 하드코딩하지 않는다.
5. Spreadsheet에 새 컬럼이 추가되어도(일반 운영정보라면) **재배포 없이** Sync/표시가 가능해야 한다. Core Field(가격/검색/권한/Push 로직에 쓰이는 것)와 Dynamic Field(JSONB, 그 외 일반 정보)를 구분한다. 새 Dynamic Field의 기본값은 표시 ON / 검색·필터·NEW·Push OFF다.
6. NEW는 "최근 7일 내 수정된 모든 상품"이 아니다. **최근 72시간(Rolling)** 내 신규 상품 또는 가격/프로모션/혜택/사은품/행사기간/판매조건 등 **중요 변경**만 NEW로 취급한다. 공백/오타/표기정리/내부관리 필드/타임스탬프만 바뀐 것은 제외한다.
7. **NEW 판정과 Push 판정은 동일한 Change Classification(`promotion_field_definitions.change_importance`/`push_enabled`)을 공유**한다. 서로 다른 중요도 로직을 만들지 않는다.
8. 다수 상품이 짧은 시간에 함께 수정되면 Push를 건수만큼 보내지 않는다 — Summary Notification으로 통합한다(critical/필독/즉시발송 지정 건은 예외).
9. 공지/교육자료는 대상 매장·Role을 지정할 수 있어야 한다.
10. 사용자·매장 권한은 UI가 아니라 **Database RLS + Server-side Authorization**으로 보호한다. URL 변경, API 직접 호출, Client Role 조작으로 우회되면 안 된다.
11. 가격/프로모션 정보에 오래된 Cache가 노출되면 안 된다(PWA Service Worker는 앱 셸만 캐시, 데이터는 Network First).
12. Supabase Service Role Key, VAPID Private Key는 클라이언트에 절대 노출하지 않는다. `.env*`는 커밋하지 않는다.
13. Native App을 만들지 않는다. Mobile First Responsive PWA다. 직원 화면은 Mobile First, 관리자 화면은 Desktop First(모바일 접근도 가능).

## Tech Stack

- Frontend: Next.js(App Router) + TypeScript + Tailwind CSS + shadcn/ui
- Backend/DB: Supabase(PostgreSQL, Auth, Realtime, Storage, RLS)
- Sync: Google Apps Script → Next.js API Route(서버 전용) → Supabase
- Push: Web Push(VAPID) + Service Worker
- Deploy: Vercel

## 개발 원칙

- Reference(`reference/softr`, `reference/spreadsheet`, `reference/brand`)를 확인하지 않은 내용을 추측해서 확정하지 않는다.
- 전체 기능을 한 번에 구현하지 않는다. Phase 단위로 진행한다(마스터 프롬프트 §82 순서 기준: 분석 → 요구사항 → 아키텍처 → UI → Foundation → Auth → Promotion Migration → Promotion UI → Notice → Training → Realtime → Push → Admin → Security → QA → Deployment).
- Database 변경은 Migration 파일로 관리한다. Production DB 수동 직접수정에 의존하지 않는다.
- TypeScript `any` 사용 최소화. 중복 코드 최소화, 재사용 가능한 Component 사용.
- Mock Data는 명확히 분리한다.
- 각 Phase 완료 시 lint/type check/production build를 실제로 돌려보고 통과를 확인한 뒤 "완료"라고 보고한다.
- UI/Frontend 변경은 실제로 브라우저에서 동작을 확인한 뒤 완료로 보고한다.
- 실제 구현과 문서가 달라지면 `docs/`도 함께 업데이트한다.

## 데이터 관련 주의사항 (실측 기반)

- Spreadsheet의 `수정일`, `NEW`, `최근 수정 건수`, `🔐 Softr Record ID` 컬럼은 Softr 전용 메타데이터다. Dynamic Field 자동 감지 대상에서 제외하고 별도 처리한다. 특히 `최근 수정 건수`는 상품별 데이터가 아니라 요약 통계 셀이 섞여 들어간 것이므로 그대로 신뢰하지 않는다.
- 상시/행사 시트의 사은품 컬럼명이 다르다(`증정사은품` vs `행사 사은품`) — Sync 매핑에서 의미는 같게(`gift`) 통합하되 헤더 이름은 각각 명시적으로 지정한다.

## 확정된 사용자 의사결정 (2026-09-09)

- **[행사 프로모션] 시트 컬럼 신설 동의**: `행사명`/`시작일`/`종료일`/`노출여부`를 신설한다. 실제 운영 시트가 아닌 개발/복제 시트에서 먼저 검증 후 반영한다.
- **`product_id`는 서버 자동 채번**이다. 담당자는 시트에 아무 값도 입력하지 않는다 — 서버가 신규 상품을 감지해 채번한 뒤 Apps Script로 해당 셀에 값을 다시 써준다(Write-back은 이 컬럼 1개에만 한정). 상세: [sync-design.md](docs/sync-design.md) §4.
- **매장은 용인본점, 동백점 2곳으로 확정, 향후 매장 추가 계획이 있다.** 코드/RLS/Push·Notice Targeting 어디에도 매장명·매장 개수를 하드코딩하지 않는다. `stores` 테이블 행 추가만으로 신규 매장이 반영되어야 한다.
- **STORE_MANAGER의 유일한 추가 권한은 "전체 매장(용인본점+동백점)의 프로모션 전체 조회"뿐이다.** 소속 매장에 관계없이 프로모션(상시+행사) 데이터는 전체를 보되, 공지/교육자료 등 그 외 기능은 STAFF와 동일하게 소속 매장 범위로 제한된다. 이는 매장이 늘어나도 "전체"로 자동 확장되는 Role 기반 예외이며 특정 매장명을 조건에 하드코딩하지 않는다. 상세: [permissions.md](docs/permissions.md) §1, §3.
- (미결정) 공지유형/매장별운영 등 자유 텍스트 필드 표기 표준화 여부 — 1차 버전은 시스템이 trim/공백정규화로 흡수하는 것을 기본값으로 진행한다.

## Phase 6 구현 메모 (Promotion Sync)

- **DEV Supabase 프로젝트는 새 테이블마다 GRANT를 명시적으로 해줘야 한다.** `alter default privileges`를 한 번 걸어뒀지만(20260909120500_grants.sql), 안전하게 매번 새 테이블 migration 끝에 `grant all on <table> to anon, authenticated, service_role;`을 추가하는 패턴을 계속 따른다 — Phase 5/6 둘 다 이 GRANT 없이는 `permission denied`가 났다.
- **`src/proxy.ts`는 `/api/*` 경로를 세션 리다이렉트 대상에서 제외한다.** Sync API처럼 Bearer 토큰으로 자체 인증하는 Route Handler를 proxy가 `/login`으로 리다이렉트해버리는 버그가 실제로 있었다 — 새 API Route를 추가할 때 이 예외를 건드리지 않는다.
- **PostgREST에서 RLS가 UPDATE/DELETE 대상 행을 0건으로 만들면 `error`가 나지 않는다** — 그냥 0건 성공으로 응답한다. RLS 쓰기 차단을 테스트할 때는 `.select()`로 실제 반환된 행 수와 Service Role로 재조회한 DB 값을 함께 확인해야 한다(단순히 `error` 유무만 보면 오탐이 난다 — 실제로 겪음).
- **`event_campaigns.campaign_key`는 Spreadsheet의 `행사명` 값을 trim한 문자열 그대로다.** 같은 행사명을 쓰는 여러 Row가 자동으로 같은 캠페인으로 묶인다.
- Sync에서 셀 값이 빈 문자열이거나 `"-"`이면 전부 `null`로 정규화한다(실측 데이터 패턴, `src/lib/sync/engine.ts`의 `normalizeCellText`).
- `product_id`는 `next_product_id()` Postgres Sequence로 채번(`PROD-000001`식) — 최초 Import든 신규 Row 추가든 "product_id가 비어있다"는 동일 조건으로 처리하며 별도 분기를 두지 않는다.
- Sync 테스트: `npm run test:sync`(파이프라인 End-to-End, 로컬 dev server 필요), `npm run test:promotion-rls`(Promotion 도메인 RLS), `npm run db:clean:promotions`(테스트 데이터 초기화).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
