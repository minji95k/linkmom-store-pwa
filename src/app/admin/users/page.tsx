import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ResetPasswordButton } from "@/components/admin/reset-password-button";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { resetPasswordAction, toggleActiveAction } from "@/app/admin/users/actions";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/database";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "본사 관리자",
  STORE_MANAGER: "매장 관리자",
  STAFF: "매장 직원",
};

const ROLE_BADGE_VARIANT: Record<UserRole, "solid" | "purple" | "mint"> = {
  ADMIN: "solid",
  STORE_MANAGER: "purple",
  STAFF: "mint",
};

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const [{ data: profiles }, { data: access }, { data: stores }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    supabase.from("user_store_access").select("user_id, store_id"),
    supabase.from("stores").select("id, name").order("name"),
  ]);

  const storeNameById = new Map((stores ?? []).map((s) => [s.id, s.name]));
  const storeNameByUserId = new Map<string, string>();
  for (const row of access ?? []) {
    if (!storeNameByUserId.has(row.user_id)) {
      storeNameByUserId.set(row.user_id, storeNameById.get(row.store_id) ?? "-");
    }
  }

  const rows = profiles ?? [];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <Link href="/admin" className="text-xs font-bold text-text-3">
            ← 관리자 홈
          </Link>
          <h1 className="text-lg font-black">직원 관리</h1>
        </div>
        <Link href="/admin/users/new" className={cn(buttonVariants({ variant: "primary", size: "sm" }))}>
          + 직원 추가
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-text-3">등록된 직원이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((profile) => (
            <Card key={profile.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={ROLE_BADGE_VARIANT[profile.role]}>{ROLE_LABEL[profile.role]}</Badge>
                    <Badge variant={profile.is_active ? "mint" : "danger"}>
                      {profile.is_active ? "활성" : "비활성"}
                    </Badge>
                  </div>
                  <p className="font-bold text-text">{profile.name}</p>
                  <p className="text-xs text-text-3">{profile.email}</p>
                  <p className="text-xs text-text-3">{storeNameByUserId.get(profile.id) ?? "소속 매장 없음"}</p>
                </div>
                <Link
                  href={`/admin/users/${profile.id}/edit`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  수정
                </Link>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-2">
                <ToggleActiveButton
                  action={toggleActiveAction.bind(null, profile.id, !profile.is_active)}
                  isActive={profile.is_active}
                />
                <ResetPasswordButton action={resetPasswordAction.bind(null, profile.id)} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
