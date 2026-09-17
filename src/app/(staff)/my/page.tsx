import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentUser, storeLabel } from "@/lib/auth/get-current-user";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "본사 관리자",
  STORE_MANAGER: "매장 관리자",
  STAFF: "매장 직원",
};

/**
 * Phase 7 범위: 프로필/소속 매장 조회 + 로그아웃만. Push 수신 설정/비밀번호 변경은
 * Phase 8 이후(Push는 Phase 11)에 이 화면에 추가된다 — 지금은 자리만 잡아둔다.
 */
export default async function MyPage() {
  const currentUser = (await getCurrentUser())!;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-lg font-black">MY</h1>

      <Card>
        <CardHeader>
          <CardTitle>{currentUser.profile.name}</CardTitle>
          <CardDescription>{currentUser.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={currentUser.profile.role === "ADMIN" ? "solid" : "mint"}>
              {ROLE_LABEL[currentUser.profile.role]}
            </Badge>
            <span className="text-xs text-text-3">{storeLabel(currentUser)}</span>
          </div>
        </CardContent>
      </Card>

      {currentUser.profile.role === "ADMIN" && (
        <a
          href="/admin"
          className="rounded-xl border border-border bg-card p-4 text-center text-sm font-bold text-text hover:bg-bg"
        >
          관리자 화면으로 이동 →
        </a>
      )}

      <Card>
        <CardContent className="flex flex-col gap-2 pt-1">
          <p className="text-xs text-text-3">Push 수신 설정 / 비밀번호 변경은 이후 Phase에서 제공됩니다.</p>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}
