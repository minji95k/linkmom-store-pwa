/**
 * Phase 5 RLS 검증용 테스트 데이터 정의.
 * DEV Supabase 프로젝트 전용. 운영 데이터가 절대 아니다.
 *
 * seed.ts가 이 정의로 auth.users + profiles + stores + user_store_access +
 * notices를 만들고, test-rls.ts가 동일한 정의를 각 역할로 로그인해 검증한다.
 */

export const STORES = [
  { code: "HQ", name: "용인본점" },
  { code: "DONGBAEK", name: "동백점" },
] as const;

export type TestUserKey = "admin" | "manager" | "staffHq" | "staffDongbaek";

export const TEST_PASSWORD = "Linkmom-Dev-2026!";

export const TEST_USERS: Record<
  TestUserKey,
  { email: string; name: string; role: "ADMIN" | "STORE_MANAGER" | "STAFF"; storeCodes: string[] }
> = {
  admin: {
    email: "admin@test.linkmom.dev",
    name: "테스트 관리자",
    role: "ADMIN",
    storeCodes: [],
  },
  manager: {
    email: "manager@test.linkmom.dev",
    name: "테스트 매장관리자",
    role: "STORE_MANAGER",
    storeCodes: ["HQ"],
  },
  staffHq: {
    email: "staff-hq@test.linkmom.dev",
    name: "테스트 본점직원",
    role: "STAFF",
    storeCodes: ["HQ"],
  },
  staffDongbaek: {
    email: "staff-dongbaek@test.linkmom.dev",
    name: "테스트 동백점직원",
    role: "STAFF",
    storeCodes: ["DONGBAEK"],
  },
};

/**
 * 공지 노출 매트릭스 (seed.ts가 생성, test-rls.ts가 검증):
 *
 *              all-notice  hq-notice  dongbaek-notice  staff-role-notice  staffHq-only-notice
 * admin            O           O            O                 O                  O   (ADMIN은 대상과 무관하게 전체)
 * manager           O           O            X                 X                  X
 * staffHq           O           O            X                 O                  O
 * staffDongbaek      O           X            O                 O                  X
 */
export const TEST_NOTICES = [
  { key: "all-notice", title: "[전체] DEV 테스트 공지", target: { type: "all" as const } },
  { key: "hq-notice", title: "[용인본점] DEV 테스트 공지", target: { type: "store" as const, storeCode: "HQ" } },
  {
    key: "dongbaek-notice",
    title: "[동백점] DEV 테스트 공지",
    target: { type: "store" as const, storeCode: "DONGBAEK" },
  },
  {
    key: "staff-role-notice",
    title: "[STAFF 전체] DEV 테스트 공지",
    target: { type: "role" as const, role: "STAFF" as const },
  },
  {
    key: "staffHq-only-notice",
    title: "[staffHq 개인지정] DEV 테스트 공지",
    target: { type: "user" as const, userKey: "staffHq" as TestUserKey },
  },
] as const;
