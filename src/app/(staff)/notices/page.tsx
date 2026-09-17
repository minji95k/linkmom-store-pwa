import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";

/**
 * 목록을 만드는 건 이 컴포넌트가 아니라 RLS다: 아래 쿼리는 로그인한 사용자의
 * 세션으로 그대로 실행되며, notices 테이블의 RLS 정책(notices_select_targeted_or_admin)이
 * "이 사람이 볼 수 있는 공지"만 걸러서 돌려준다. 이 페이지는 필터링을 하지 않는다 —
 * 즉 여기서 SELECT * 를 해도 다른 매장 공지는 애초에 응답에 담겨오지 않는다.
 */
export default async function NoticesPage() {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const { data: notices, error } = await supabase
    .from("notices")
    .select("id, title, body, notice_type, published_at")
    .order("published_at", { ascending: false });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-6">
      <Link href="/" className="text-xs font-bold text-text-3">
        ← 홈으로
      </Link>

      <div>
        <h1 className="text-lg font-black">공지</h1>
        <p className="text-xs text-text-3">
          {currentUser?.profile.name}님({currentUser?.profile.role})에게 RLS로 필터링된 목록입니다
        </p>
      </div>

      {error ? (
        <p className="text-sm text-danger">공지를 불러오지 못했습니다: {error.message}</p>
      ) : (notices ?? []).length === 0 ? (
        <p className="text-sm text-text-3">현재 확인 가능한 공지가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {notices!.map((notice) => (
            <Card key={notice.id}>
              <CardHeader>
                <Badge variant="neutral">{notice.notice_type}</Badge>
                <CardTitle>{notice.title}</CardTitle>
                <CardDescription>
                  {new Date(notice.published_at).toLocaleString("ko-KR")}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-text-2">{notice.body}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
