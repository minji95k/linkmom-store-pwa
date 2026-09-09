import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * RLS를 우회하는 Secret Key 클라이언트 (신규 Supabase API Key 체계 —
 * 과거의 Service Role Key에 해당).
 *
 * ⚠️ 절대 Client Component나 API 응답에 그대로 노출하지 않는다 (CLAUDE.md 절대 원칙 12).
 * Google Sheet Sync API(/api/sync/*)와 Push 발송처럼 서버에서만 실행되는
 * 코드에서만 import한다. `import "server-only"`가 클라이언트 번들 포함을 빌드 타임에 차단한다.
 */
export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
