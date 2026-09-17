import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, PromotionType } from "@/types/database";

export const PAGE_SIZE = 20;
const NEW_WINDOW_HOURS = 72;

type Client = SupabaseClient<Database>;
type PromotionRow = Database["public"]["Tables"]["promotions"]["Row"];
type ChangeLogRow = Database["public"]["Tables"]["promotion_change_logs"]["Row"];
type FieldDefRow = Database["public"]["Tables"]["promotion_field_definitions"]["Row"];
type EventCampaignRow = Database["public"]["Tables"]["event_campaigns"]["Row"];

export type PromotionSort = "default" | "recent";

export interface PromotionListParams {
  q?: string;
  brand?: string;
  sort?: PromotionSort;
  page?: number;
}

export interface PromotionListResult {
  items: PromotionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function newCutoffIso(): string {
  return new Date(Date.now() - NEW_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}

/** PostgREST `.or()` 문자열에 쓸 수 없는 문자(콤마/괄호)를 제거한다 — 문법 깨짐 방지용이지 보안 escaping이 아니다. */
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[,()]/g, " ").trim();
}

/** 코어 필드 중 검색 가능한 필드는 실제 컬럼이 별도로 있다(컬러는 color_text). */
const SEARCHABLE_CORE_COLUMN: Record<string, string> = {
  brand: "brand",
  product_name: "product_name",
  color: "color_text",
};

/**
 * 통합검색 대상 필드를 `promotion_field_definitions.is_searchable=true`에서 그대로 읽어
 * OR 조건을 만든다. 지금은 브랜드/제품명/컬러만 true지만(§27 시드값), 향후 Admin이
 * Dynamic Field의 is_searchable을 켜면(재배포 없이) `extra_fields->>field_key`
 * 경로로 자동 포함된다 — CLAUDE.md 절대 원칙 5.
 */
async function buildIntegratedSearchOr(supabase: Client, rawQuery: string): Promise<string | null> {
  const q = sanitizeSearchTerm(rawQuery);
  if (!q) return null;

  const { data: fields } = await supabase
    .from("promotion_field_definitions")
    .select("field_key, is_core")
    .eq("is_searchable", true);

  const defs = fields && fields.length > 0 ? fields : [{ field_key: "brand", is_core: true }, { field_key: "product_name", is_core: true }, { field_key: "color", is_core: true }];

  const clauses = defs.map(({ field_key, is_core }) => {
    const column = SEARCHABLE_CORE_COLUMN[field_key];
    if (column) return `${column}.ilike.%${q}%`;
    // Dynamic Field: extra_fields(JSONB)에서 텍스트로 꺼내 비교한다.
    void is_core;
    return `extra_fields->>${field_key}.ilike.%${q}%`;
  });

  return clauses.join(",");
}

export async function getDistinctActiveBrands(
  supabase: Client,
  promotionType: PromotionType,
): Promise<string[]> {
  const { data } = await supabase
    .from("promotions")
    .select("brand")
    .eq("promotion_type", promotionType)
    .eq("is_active", true);

  const unique = Array.from(new Set((data ?? []).map((r) => r.brand))).sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
  return unique;
}

export async function searchPermanentPromotions(
  supabase: Client,
  params: PromotionListParams,
): Promise<PromotionListResult> {
  const page = Math.max(1, params.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("promotions")
    .select("*", { count: "exact" })
    .eq("promotion_type", "permanent")
    .eq("is_active", true);

  if (params.brand) query = query.eq("brand", params.brand);

  if (params.q) {
    const orFilter = await buildIntegratedSearchOr(supabase, params.q);
    if (orFilter) query = query.or(orFilter);
  }

  if (params.sort === "recent") {
    query = query
      .order("last_important_change_at", { ascending: false, nullsFirst: false })
      .order("brand", { ascending: true });
  } else {
    query = query.order("brand", { ascending: true }).order("product_name", { ascending: true });
  }

  const { data, count, error } = await query.range(from, to);
  if (error) throw error;

  return { items: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE };
}

export async function getVisibleEventCampaigns(supabase: Client): Promise<EventCampaignRow[]> {
  const { data, error } = await supabase
    .from("event_campaigns_visible")
    .select("*")
    .order("end_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getCampaignProductCount(supabase: Client, campaignId: string): Promise<number> {
  const { count } = await supabase
    .from("event_campaign_products")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  return count ?? 0;
}

export async function getVisibleCampaignById(
  supabase: Client,
  campaignId: string,
): Promise<EventCampaignRow | null> {
  const { data } = await supabase
    .from("event_campaigns_visible")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  return data ?? null;
}

/** 상품이 속한 "지금 노출 중인" 캠페인(있다면). 상세 페이지에서 되돌아가기 링크용. */
export async function getVisibleCampaignForPromotion(
  supabase: Client,
  promotionId: string,
): Promise<EventCampaignRow | null> {
  const { data: link } = await supabase
    .from("event_campaign_products")
    .select("campaign_id")
    .eq("promotion_id", promotionId)
    .maybeSingle();
  if (!link) return null;
  return getVisibleCampaignById(supabase, link.campaign_id);
}

export async function getDistinctBrandsForCampaign(supabase: Client, campaignId: string): Promise<string[]> {
  const { data: links } = await supabase
    .from("event_campaign_products")
    .select("promotion_id")
    .eq("campaign_id", campaignId);
  const promotionIds = (links ?? []).map((l) => l.promotion_id);
  if (promotionIds.length === 0) return [];

  const { data } = await supabase
    .from("promotions")
    .select("brand")
    .in("id", promotionIds)
    .eq("is_active", true);
  return Array.from(new Set((data ?? []).map((r) => r.brand))).sort((a, b) => a.localeCompare(b, "ko"));
}

export async function getCampaignProducts(
  supabase: Client,
  campaignId: string,
  params: PromotionListParams,
): Promise<PromotionListResult> {
  const page = Math.max(1, params.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: links } = await supabase
    .from("event_campaign_products")
    .select("promotion_id")
    .eq("campaign_id", campaignId);

  const promotionIds = (links ?? []).map((l) => l.promotion_id);
  if (promotionIds.length === 0) {
    return { items: [], total: 0, page, pageSize: PAGE_SIZE };
  }

  let query = supabase
    .from("promotions")
    .select("*", { count: "exact" })
    .in("id", promotionIds)
    .eq("is_active", true);

  if (params.brand) query = query.eq("brand", params.brand);
  if (params.q) {
    const orFilter = await buildIntegratedSearchOr(supabase, params.q);
    if (orFilter) query = query.or(orFilter);
  }

  query = query.order("brand", { ascending: true }).order("product_name", { ascending: true });

  const { data, count, error } = await query.range(from, to);
  if (error) throw error;

  return { items: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE };
}

/**
 * NEW = is_active AND last_important_change_at이 72시간 이내 (§10, CLAUDE.md 절대 원칙 6·7).
 * Sync 엔진이 신규 등록 시에도 이 컬럼을 채우므로(engine.ts) "신규 상품"과 "중요 변경 상품"을
 * 별도 조건으로 다시 만들지 않는다 — 하나만 보면 된다.
 *
 * 상시/행사를 한 번의 PostgREST 쿼리로 합칠 수 없어(행사는 "지금 노출 중인 캠페인" 조건이
 * 별도 join 필요) 두 단계로 나눠 조회 후 서버에서 합친다. 두 규모 모두 작아(현재
 * permanent 188 / event 16) 브라우저로는 최종 페이지 분량만 전달되고, "전체 로드 후
 * client filter"에는 해당하지 않는다 — 병합·정렬·페이지네이션이 전부 Next.js 서버에서 끝난다.
 */
export async function getNewPromotions(
  supabase: Client,
  params: PromotionListParams,
): Promise<PromotionListResult> {
  const cutoff = newCutoffIso();
  const orFilter = params.q ? await buildIntegratedSearchOr(supabase, params.q) : null;

  let permanentQuery = supabase
    .from("promotions")
    .select("*")
    .eq("promotion_type", "permanent")
    .eq("is_active", true)
    .gte("last_important_change_at", cutoff);
  if (params.brand) permanentQuery = permanentQuery.eq("brand", params.brand);
  if (orFilter) permanentQuery = permanentQuery.or(orFilter);

  const { data: permanentItems, error: permanentError } = await permanentQuery;
  if (permanentError) throw permanentError;

  const { data: visibleCampaigns } = await supabase.from("event_campaigns_visible").select("id");
  const visibleCampaignIds = (visibleCampaigns ?? []).map((c) => c.id);

  let eventItems: PromotionRow[] = [];
  if (visibleCampaignIds.length > 0) {
    const { data: links } = await supabase
      .from("event_campaign_products")
      .select("promotion_id")
      .in("campaign_id", visibleCampaignIds);
    const eventPromotionIds = (links ?? []).map((l) => l.promotion_id);

    if (eventPromotionIds.length > 0) {
      let eventQuery = supabase
        .from("promotions")
        .select("*")
        .in("id", eventPromotionIds)
        .eq("is_active", true)
        .gte("last_important_change_at", cutoff);
      if (params.brand) eventQuery = eventQuery.eq("brand", params.brand);
      if (orFilter) eventQuery = eventQuery.or(orFilter);

      const { data, error } = await eventQuery;
      if (error) throw error;
      eventItems = data ?? [];
    }
  }

  const merged = [...(permanentItems ?? []), ...eventItems].sort((a, b) => {
    const at = a.last_important_change_at ? new Date(a.last_important_change_at).getTime() : 0;
    const bt = b.last_important_change_at ? new Date(b.last_important_change_at).getTime() : 0;
    return bt - at;
  });

  const page = Math.max(1, params.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const items = merged.slice(from, from + PAGE_SIZE);

  return { items, total: merged.length, page, pageSize: PAGE_SIZE };
}

export async function getPromotionByProductId(
  supabase: Client,
  productId: string,
): Promise<PromotionRow | null> {
  // RLS가 그대로 적용된다: 비활성 상시/비노출·예정·종료 행사 상품은 STAFF/STORE_MANAGER
  // 세션에서 아예 행 자체가 반환되지 않는다(§19) — 존재 여부를 노출하지 않기 위해
  // 여기서 별도의 "권한 없음" 분기를 만들지 않고 그냥 null(→ 404)로 처리한다.
  const { data } = await supabase.from("promotions").select("*").eq("product_id", productId).maybeSingle();
  return data ?? null;
}

export async function getRecentChangeLogs(
  supabase: Client,
  promotionId: string,
  limit = 10,
): Promise<ChangeLogRow[]> {
  const { data } = await supabase
    .from("promotion_change_logs")
    .select("*")
    .eq("promotion_id", promotionId)
    .neq("importance", "minor")
    .order("changed_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** 목록 페이지에서 카드마다 N+1 쿼리를 만들지 않도록 한 번에 묶어 조회 후 그룹핑한다. */
export async function getRecentChangeLogsForPromotions(
  supabase: Client,
  promotionIds: string[],
  perItemLimit = 3,
): Promise<Map<string, ChangeLogRow[]>> {
  const map = new Map<string, ChangeLogRow[]>();
  if (promotionIds.length === 0) return map;

  const { data } = await supabase
    .from("promotion_change_logs")
    .select("*")
    .in("promotion_id", promotionIds)
    .neq("importance", "minor")
    .order("changed_at", { ascending: false });

  for (const log of data ?? []) {
    const bucket = map.get(log.promotion_id) ?? [];
    if (bucket.length < perItemLimit) bucket.push(log);
    map.set(log.promotion_id, bucket);
  }
  return map;
}

export async function getCoreFieldDisplayLabels(supabase: Client): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("promotion_field_definitions")
    .select("field_key, display_label")
    .eq("is_core", true);
  return new Map((data ?? []).map((f) => [f.field_key, f.display_label]));
}

/** Dynamic Field 렌더링: is_visible=true인 것만, display_order 순 (CLAUDE.md 절대 원칙 5). */
export async function getVisibleDynamicFieldDefs(
  supabase: Client,
  promotionType: PromotionType,
): Promise<FieldDefRow[]> {
  const { data } = await supabase
    .from("promotion_field_definitions")
    .select("*")
    .eq("is_core", false)
    .eq("is_visible", true)
    .eq("source_sheet", promotionType)
    .order("display_order", { ascending: true });
  return data ?? [];
}

export function isPromotionNew(promotion: Pick<PromotionRow, "last_important_change_at">): boolean {
  if (!promotion.last_important_change_at) return false;
  return new Date(promotion.last_important_change_at).getTime() >= new Date(newCutoffIso()).getTime();
}
