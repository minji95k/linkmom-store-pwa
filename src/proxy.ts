import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 다음을 제외한 모든 경로에 적용한다:
     * - _next/static, _next/image (Next.js 정적 자산)
     * - manifest, service worker, 아이콘 등 PWA 정적 파일
     * - 이미지 확장자로 끝나는 파일
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
