import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";

/**
 * Server Component / Route Handler / Server Action에서 사용하는 Supabase 클라이언트.
 * 로그인한 사용자의 세션(쿠키) 기준으로 동작하며 RLS가 그대로 적용된다.
 * Sync API, Push 발송 등 RLS를 우회해야 하는 서버 전용 작업은
 * 이 클라이언트가 아니라 `createServiceRoleClient()`를 사용한다.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component에서 호출된 경우 쿠키 쓰기가 무시될 수 있다.
            // middleware가 세션 갱신을 담당하므로 무해하다.
          }
        },
      },
    },
  );
}
