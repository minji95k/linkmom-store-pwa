import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const supabase = await createClient();

  const [{ count: profileCount }, { count: storeCount }, { count: noticeCount }] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("stores").select("id", { count: "exact", head: true }),
    supabase.from("notices").select("id", { count: "exact", head: true }),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-6">
      <Link href="/" className="text-xs font-bold text-text-3">
        ← 홈으로
      </Link>

      <h1 className="text-lg font-black">관리자 전용</h1>

      <Card>
        <CardHeader>
          <CardTitle>ADMIN에게만 보이는 화면</CardTitle>
          <CardDescription>RLS 없이도 이 페이지 자체가 role 검증으로 막혀 있습니다</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-2xl font-black">{profileCount ?? 0}</div>
            <div className="text-xs text-text-3">직원</div>
          </div>
          <div>
            <div className="text-2xl font-black">{storeCount ?? 0}</div>
            <div className="text-xs text-text-3">매장</div>
          </div>
          <div>
            <div className="text-2xl font-black">{noticeCount ?? 0}</div>
            <div className="text-xs text-text-3">공지</div>
          </div>
        </CardContent>
      </Card>

      <Link
        href="/admin/notices"
        className="rounded-xl border border-border bg-card p-4 text-center text-sm font-bold text-text hover:bg-bg"
      >
        공지 관리(Phase 8) →
      </Link>
    </main>
  );
}
