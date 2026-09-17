import type { Database, Json } from "@/types/database";

type FieldDefRow = Database["public"]["Tables"]["promotion_field_definitions"]["Row"];

function formatValue(value: Json): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

/**
 * `promotion_field_definitions.is_visible=true`인 Dynamic Field만, display_order 순으로
 * 렌더링한다(CLAUDE.md 절대 원칙 5) — 새 Spreadsheet 컬럼이 생겨도 이 컴포넌트는
 * 재배포 없이 자동으로 새 항목을 그려낸다. 값이 없는 필드는 표시하지 않는다(§16).
 */
export function DynamicFieldsList({
  fieldDefs,
  extraFields,
}: {
  fieldDefs: FieldDefRow[];
  extraFields: Record<string, Json>;
}) {
  const rows: { def: FieldDefRow; value: Json }[] = [];
  for (const def of fieldDefs) {
    const value = extraFields[def.field_key];
    if (value !== null && value !== undefined && value !== "") {
      rows.push({ def, value });
    }
  }

  if (rows.length === 0) return null;

  return (
    <dl className="flex flex-col gap-3">
      {rows.map(({ def, value }) => (
        <div key={def.field_key}>
          <dt className="text-xs font-bold text-mint-dark">{def.display_label}</dt>
          <dd className="text-sm text-text">{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
