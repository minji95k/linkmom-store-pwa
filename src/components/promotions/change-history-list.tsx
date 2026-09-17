import { Badge } from "@/components/ui/badge";
import { formatDateTimeKST } from "@/lib/format";
import { summarizeChangeLog } from "@/lib/promotions/change-summary";
import type { Database } from "@/types/database";

type ChangeLogRow = Database["public"]["Tables"]["promotion_change_logs"]["Row"];

export function ChangeHistoryList({
  logs,
  fieldDisplayLabels,
}: {
  logs: ChangeLogRow[];
  fieldDisplayLabels: Map<string, string>;
}) {
  if (logs.length === 0) {
    return <p className="text-sm text-text-3">최근 중요 변경 이력이 없습니다.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {logs.map((log) => {
        const summary = summarizeChangeLog(log, fieldDisplayLabels.get(log.changed_field) ?? log.changed_field);
        return (
          <li key={log.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-none">
            <div className="flex items-center justify-between">
              <Badge variant={log.importance === "critical" ? "warning" : "mint"}>{summary.badgeLabel}</Badge>
              <span className="text-[11px] text-text-3">{formatDateTimeKST(log.changed_at)}</span>
            </div>
            <p className="text-sm text-text">
              <span className="font-bold">{summary.fieldLabel}</span>{" "}
              {summary.before} → <span className="font-bold">{summary.after}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
