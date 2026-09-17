import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NoticeNotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center">
      <p className="text-sm text-text">공지를 찾을 수 없습니다.</p>
      <p className="text-xs text-text-3">대상이 아니거나 게시기간이 아닌 공지일 수 있습니다.</p>
      <Link href="/notices" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        공지 목록으로
      </Link>
    </main>
  );
}
