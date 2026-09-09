import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/get-current-user";

/**
 * ADMIN 전용 Route Group의 서버 사이드 게이트.
 *
 * proxy.ts(src/proxy.ts)는 "로그인했는지"만 검사한다 — "이 role이 /admin에
 * 들어와도 되는지"는 여기서 별도로 검사한다. Next.js 공식 문서도 Proxy 하나에
 * 기대지 말고 각 Route/Server Function에서 다시 검증하라고 명시한다
 * (docs/permissions.md §4, node_modules/next/dist/docs 의 proxy.md
 * "Migration to Proxy" 절 참조). STAFF/STORE_MANAGER가 /admin URL을 직접
 * 입력해도 이 redirect가 항상 실행된다 — 프론트엔드 메뉴 숨김에 의존하지 않는다.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCurrentUser();

  if (!currentUser || currentUser.profile.role !== "ADMIN") {
    redirect("/");
  }

  return <>{children}</>;
}
