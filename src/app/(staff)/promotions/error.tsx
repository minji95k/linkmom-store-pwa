"use client";

import { Button } from "@/components/ui/button";

export default function PromotionsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center">
      <p className="text-sm text-danger">프로모션 정보를 불러오지 못했습니다.</p>
      <p className="text-xs text-text-3">네트워크 상태를 확인한 뒤 다시 시도해주세요.</p>
      <Button onClick={reset} variant="outline" size="sm">
        다시 시도
      </Button>
    </main>
  );
}
