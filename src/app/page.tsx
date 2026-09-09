import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentUser, storeLabel } from "@/lib/auth/get-current-user";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "본사 관리자",
  STORE_MANAGER: "매장 관리자",
  STAFF: "매장 직원",
};

export default async function HomePage() {
  const currentUser = await getCurrentUser();

  // proxy.ts가 비로그인은 이미 /login으로 보내지만, profiles row가 아직 없는
  // 극히 예외적인 상태(트리거 지연 등)까지 방어적으로 처리한다.
  if (!currentUser) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="text-xl font-black">
          <span className="text-purple">Link</span>
          <span className="text-mint-dark">mom</span>
        </div>
        <SignOutButton />
      </div>

      <Card>
        <CardHeader>
          <Badge variant="purple">Phase 5</Badge>
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

      <Card>
        <CardHeader>
          <CardTitle>둘러보기</CardTitle>
          <CardDescription>Phase 5에서 실제로 동작하는 화면</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Link href="/notices" className={cn(buttonVariants({ variant: "outline" }), "justify-start")}>
            공지 (매장/역할별 RLS 적용) →
          </Link>
          <Link href="/admin" className={cn(buttonVariants({ variant: "outline" }), "justify-start")}>
            관리자 전용 페이지 →
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
