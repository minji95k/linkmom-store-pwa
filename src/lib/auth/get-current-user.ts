import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Store = Database["public"]["Tables"]["stores"]["Row"];

export interface CurrentUser {
  id: string;
  email: string;
  profile: Profile;
  stores: Store[];
}

/**
 * 현재 로그인한 사용자의 profile + 소속 매장을 가져온다.
 * 사용자 자신의 세션(RLS 적용)으로 조회하므로, 여기서 나온 값 자체가 이미
 * "이 사람이 실제로 볼 수 있는 것"이다 — 이 함수가 role을 임의로 부여하지 않는다.
 * 로그인하지 않았으면 null.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) return null;

  const { data: storeAccess } = await supabase
    .from("user_store_access")
    .select("store_id")
    .eq("user_id", user.id);

  const storeIds = (storeAccess ?? []).map((row) => row.store_id);

  let stores: Store[] = [];
  if (storeIds.length > 0) {
    const { data } = await supabase.from("stores").select("*").in("id", storeIds);
    stores = data ?? [];
  }

  return { id: user.id, email: user.email ?? profile.email, profile, stores };
}

/** ADMIN 전체 매장, STAFF/STORE_MANAGER는 소속 매장만 — Route 진입 전에 UI 배지 등에 쓴다. */
export function storeLabel(user: CurrentUser): string {
  if (user.profile.role === "ADMIN") return "전체 매장";
  if (user.stores.length === 0) return "소속 매장 없음";
  return user.stores.map((s) => s.name).join(", ");
}
