import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database";

const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * 루트 src/proxy.ts에서 호출된다 (Next.js 16 — `middleware` 파일 컨벤션은
 * deprecated, `proxy`로 대체됨. Proxy 자체는 인증의 1차 방어선일 뿐이며,
 * Server Function은 Proxy matcher를 우회할 수 있으므로 각 Server
 * Function/Route Handler 내부에서도 반드시 별도로 인증을 검증해야 한다).
 * - Supabase 세션 쿠키를 매 요청마다 갱신한다 (PWA를 홈 화면에서 실행해도
 *   재로그인이 필요 없도록 하기 위함 — product-requirements.md §48).
 * - 로그인하지 않은 사용자가 보호된 경로에 접근하면 /login으로 리다이렉트한다.
 *   (Server-side Authorization의 1차 방어선. RLS가 최종 방어선 — docs/permissions.md §4)
 */
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
