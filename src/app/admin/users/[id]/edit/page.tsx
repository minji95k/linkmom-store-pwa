import Link from "next/link";
import { notFound } from "next/navigation";

import { UserForm } from "@/components/admin/user-form";
import { updateUserAction } from "@/app/admin/users/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: profile }, { data: stores }, { data: access }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("stores").select("id, name").eq("is_active", true).order("name"),
    supabase.from("user_store_access").select("store_id").eq("user_id", id).limit(1).maybeSingle(),
  ]);

  if (!profile) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <Link href="/admin/users" className="text-xs font-bold text-text-3">
        ← 직원 목록
      </Link>
      <h1 className="text-lg font-black">직원 정보 수정</h1>
      <UserForm
        action={updateUserAction.bind(null, id)}
        stores={stores ?? []}
        submitLabel="저장"
        mode="edit"
        initialValues={{
          name: profile.name,
          email: profile.email,
          role: profile.role,
          storeId: access?.store_id,
        }}
      />
    </main>
  );
}
