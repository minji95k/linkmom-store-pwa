import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

/**
 * 브라우저(Client Component)에서 사용하는 Supabase 클라이언트.
 * Publishable Key만 사용하며 RLS로 접근이 제한된다 (docs/permissions.md 참조).
 * (신규 Supabase API Key 체계 — 과거의 anon key에 해당)
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
