import { Badge } from "@/components/ui/badge";
import { pickCardBadges } from "@/lib/promotions/change-summary";
import type { Database } from "@/types/database";

type ChangeLogRow = Database["public"]["Tables"]["promotion_change_logs"]["Row"];

export function ChangeBadges({
  isNew,
  recentImportantLogs,
}: {
  isNew: boolean;
  recentImportantLogs: ChangeLogRow[];
}) {
  const badges = pickCardBadges(isNew, recentImportantLogs);
  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <Badge key={b.label} variant={b.variant}>
          {b.label}
        </Badge>
      ))}
    </div>
  );
}
