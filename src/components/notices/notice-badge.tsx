import { Badge } from "@/components/ui/badge";
import { noticeImportance } from "@/lib/notices/queries";
import type { NoticeType } from "@/types/database";

const IMPORTANCE_VARIANT = {
  critical: "danger",
  important: "warning",
  normal: "neutral",
} as const;

/** 유형 문자열은 그대로 보여주되, 색상은 중요도(§2)로 결정한다 — 유형이 10종이라 색까지 다 다르면 오히려 구분이 안 된다. */
export function NoticeTypeBadge({ type }: { type: NoticeType }) {
  return <Badge variant={IMPORTANCE_VARIANT[noticeImportance(type)]}>{type}</Badge>;
}
