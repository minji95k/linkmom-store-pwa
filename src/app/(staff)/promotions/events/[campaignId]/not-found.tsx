import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function CampaignNotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center">
      <p className="text-sm text-text">행사를 찾을 수 없습니다.</p>
      <p className="text-xs text-text-3">종료되었거나 아직 시작되지 않은 행사일 수 있습니다.</p>
      <Link href="/promotions?tab=event" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        행사 목록으로
      </Link>
    </main>
  );
}
