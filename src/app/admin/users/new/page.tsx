import Link from "next/link";

import { UserForm } from "@/components/admin/user-form";
import { createUserAction } from "@/app/admin/users/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const supabase = await createClient();
  const { data: stores } = await supabase.from("stores").select("id, name").eq("is_active", true).order("name");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <Link href="/admin/users" className="text-xs font-bold text-text-3">
        ← 직원 목록
      </Link>
      <h1 className="text-lg font-black">직원 추가</h1>
      <UserForm action={createUserAction} stores={stores ?? []} submitLabel="생성" mode="create" />
    </main>
  );
}
