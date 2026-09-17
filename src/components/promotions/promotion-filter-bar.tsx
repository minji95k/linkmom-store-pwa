"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 검색/브랜드/정렬을 URL(searchParams)에 반영하는 Client Component.
 * 실제 데이터 조회는 항상 서버(Server Component)에서 일어난다 — 여기는 URL만 바꾼다.
 * 검색어는 300ms debounce 후 반영해 타이핑마다 서버 요청이 나가지 않게 한다.
 *
 * 입력창 표시값은 "타이핑 중인 값(pendingQ)"이 있으면 그걸, 없으면 URL의 q를 그대로
 * 보여준다 — effect로 URL→state를 동기화하지 않는다(React가 권장하지 않는 패턴).
 * 탭이 바뀌면 부모(page.tsx)가 이 컴포넌트에 `key={tab}`을 주어 통째로 새로 마운트하므로
 * pendingQ가 다른 탭으로 새는 일도 없다.
 */
export function PromotionFilterBar({
  basePath,
  brands,
  showSort,
}: {
  basePath: string;
  brands: string[];
  showSort: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendingQ, setPendingQ] = useState<string | null>(null);
  const q = pendingQ ?? searchParams.get("q") ?? "";
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function updateParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page"); // 필터가 바뀌면 1페이지부터 다시 본다.
    router.push(`${basePath}?${params.toString()}`);
  }

  function handleQueryChange(value: string) {
    setPendingQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams({ q: value || null }), 300);
  }

  const currentSort = searchParams.get("sort") ?? "default";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Input
          value={q}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="브랜드, 제품명, 컬러로 검색"
          className="pl-4 pr-9"
          inputMode="search"
        />
        {q && (
          <button
            type="button"
            aria-label="검색어 지우기"
            onClick={() => {
              setPendingQ("");
              updateParams({ q: null });
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={searchParams.get("brand") ?? ""}
          onChange={(e) => updateParams({ brand: e.target.value || null })}
          className="h-9 rounded-lg border border-border bg-card px-2 text-xs font-bold text-text"
        >
          <option value="">전체 브랜드</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        {showSort && (
          <div className="flex gap-1">
            {[
              { key: "default", label: "가나다순" },
              { key: "recent", label: "최근 변경순" },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => updateParams({ sort: opt.key === "default" ? null : opt.key })}
                className={cn(
                  "h-9 rounded-lg px-3 text-xs font-bold",
                  currentSort === opt.key ? "bg-purple text-white" : "bg-bg text-text-2",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
