import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Link 기반 Prev/Next — Client JS 없이 서버에서 다음 page의 데이터를 다시 조회한다.
 * (기존 searchParams를 유지한 채 page만 바꾼다.)
 */
export function PaginationBar({
  page,
  pageSize,
  total,
  basePath,
  searchParams,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  function hrefFor(targetPage: number) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v) params.set(k, v);
    }
    params.set("page", String(targetPage));
    return `${basePath}?${params.toString()}`;
  }

  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          ← 이전
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs text-text-3">
        {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          다음 →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
