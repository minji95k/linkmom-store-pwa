import Link from "next/link";

import { NoticeForm } from "@/components/admin/notice-form";
import { createNoticeAction } from "@/app/admin/notices/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewNoticePage() {
  const supabase = await createClient();
  const { data: stores } = await supabase.from("stores").select("id, name").eq("is_active", true).order("name");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <Link href="/admin/notices" className="text-xs font-bold text-text-3">
        ← 공지 목록
      </Link>
      <h1 className="text-lg font-black">새 공지 작성</h1>
      <NoticeForm action={createNoticeAction} stores={stores ?? []} submitLabel="등록" />
    </main>
  );
}
