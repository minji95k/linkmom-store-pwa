import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, Json, PromotionChangeType, PromotionType } from "@/types/database";

import { classifyChangeType } from "./change-classification";
import {
  EXCLUDED_HEADERS,
  isNumberField,
  normalizeHeader,
  parseColorArray,
  resolveCampaignField,
  resolveCoreField,
} from "./core-fields";
import { DEFAULT_DEACTIVATION_SAFETY, evaluateDeactivationSafety } from "./safety";
import type {
  DeactivationGuardReport,
  ProductIdAssignment,
  SyncRequestBody,
  SyncResponseBody,
  SyncRowError,
} from "./types";

function deactivationSafetyOptions() {
  const maxRatioEnv = Number(process.env.SYNC_DEACTIVATION_MAX_RATIO);
  const maxAbsoluteEnv = Number(process.env.SYNC_DEACTIVATION_MAX_ABSOLUTE);
  return {
    maxRatio: Number.isFinite(maxRatioEnv) && maxRatioEnv > 0 ? maxRatioEnv : DEFAULT_DEACTIVATION_SAFETY.maxRatio,
    maxAbsolute:
      Number.isFinite(maxAbsoluteEnv) && maxAbsoluteEnv > 0
        ? maxAbsoluteEnv
        : DEFAULT_DEACTIVATION_SAFETY.maxAbsolute,
  };
}

const TEXT_CORE_FIELDS = [
  "period_label",
  "notice_type",
  "store_operation_note",
  "default_components",
  "gift",
  "photo_review_benefit",
  "store_promotion_allowed",
  "remarks",
] as const;

function slugifyHeader(header: string): string {
  return normalizeHeader(header).replace(/\s+/g, "_");
}

/** "-" 와 빈 문자열은 "값 없음"으로 취급한다(실측 데이터 패턴 — current-system-analysis.md §3). */
function normalizeCellText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "" || s === "-") return null;
  return s;
}

function parsePrice(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const s = String(raw).trim();
  if (s === "" || s === "-") return { ok: true, value: null };
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { ok: false };
  return { ok: true, value: n };
}

function isEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

interface ChangedFieldEntry {
  fieldKey: string;
  before: Json;
  after: Json;
  changeType: PromotionChangeType;
  importance: "critical" | "important" | "minor";
}

export async function runPromotionSync(
  sheet: PromotionType,
  body: SyncRequestBody,
): Promise<SyncResponseBody> {
  const db = createServiceRoleClient();
  const errors: SyncRowError[] = [];
  const productIdAssignments: ProductIdAssignment[] = [];
  let insertedCount = 0;
  let updatedCount = 0;
  let deactivatedCount = 0;
  // 기본값은 항상 "partial" — 누락된 기존 상품을 비활성화하지 않는 안전한 모드다.
  // 정상적인 전체 Sheet Sync(syncPermanentOnly/syncEventOnly/syncAll)만 명시적으로
  // "full_snapshot"을 보낸다(2026-09-11 대량 비활성화 사고 이후 도입).
  const syncMode = body.sync_mode ?? "partial";
  const deactivationGuard: DeactivationGuardReport = {
    skipped: syncMode !== "full_snapshot",
    blocked: false,
    reason: null,
    missingCount: 0,
    missingRatio: 0,
  };

  const { data: syncLog, error: syncLogError } = await db
    .from("sync_logs")
    .insert({ source_sheet: sheet })
    .select("id")
    .single();
  if (syncLogError || !syncLog) {
    throw new Error(`sync_logs 생성 실패: ${syncLogError?.message}`);
  }
  const syncLogId = syncLog.id;

  try {
    // source_sheet / promotion_type 일치 확인 — 발신측이 명시했는데 호출된
    // 엔드포인트(permanent/event)와 다르면 즉시 중단한다. 잘못된 Sheet의
    // payload가 엉뚱한 엔드포인트로 들어와 대량 비활성화를 일으키는 사고를
    // 원천 차단하기 위한 안전장치다.
    if (body.source_sheet && body.source_sheet !== sheet) {
      throw new Error(
        `source_sheet 불일치: 요청은 "${body.source_sheet}"이지만 "${sheet}" 엔드포인트로 호출되었습니다.`,
      );
    }

    // --- 참조 데이터 미리 로드 -------------------------------------------------
    const { data: fieldDefs, error: fieldDefsError } = await db
      .from("promotion_field_definitions")
      .select("*");
    if (fieldDefsError) throw new Error(`field definitions 조회 실패: ${fieldDefsError.message}`);

    const importanceByFieldKey = new Map<string, "critical" | "important" | "minor">();
    const dynamicDefByColumn = new Map<string, string>(); // `${sheet}::${column}` -> field_key
    for (const def of fieldDefs ?? []) {
      importanceByFieldKey.set(def.field_key, def.change_importance);
      if (!def.is_core && def.source_sheet && def.source_column_name) {
        dynamicDefByColumn.set(`${def.source_sheet}::${normalizeHeader(def.source_column_name)}`, def.field_key);
      }
    }

    const { data: existingPromotions, error: existingError } = await db
      .from("promotions")
      .select("*")
      .eq("promotion_type", sheet);
    if (existingError) throw new Error(`기존 promotions 조회 실패: ${existingError.message}`);
    const existingByProductId = new Map<string, NonNullable<typeof existingPromotions>[number]>();
    for (const row of existingPromotions ?? []) existingByProductId.set(row.product_id, row);

    // 이 Sheet 타입의 "최초 Import가 이미 끝났는지"는 promotions Row 개수가
    // 아니라 promotion_sync_state의 영구 상태로 판단한다 — Row 개수로 판정하면
    // 누군가 promotions를 통째로 지웠을 때(Hard Delete) 다음 Sync가 다시 "최초
    // Import"로 오판정될 수 있기 때문이다(사용자 재검토로 발견, 2026-09-11).
    // 한 번 완료로 기록되면 promotions가 전부 삭제되어도 이 값은 그대로 유지된다.
    const { data: syncState, error: syncStateError } = await db
      .from("promotion_sync_state")
      .select("*")
      .eq("promotion_type", sheet)
      .maybeSingle();
    if (syncStateError) throw new Error(`promotion_sync_state 조회 실패: ${syncStateError.message}`);
    const isInitialImportRun = !syncState?.initial_import_completed_at;

    const campaignByKey = new Map<string, { id: string; is_visible: boolean; start_at: string | null; end_at: string | null }>();
    if (sheet === "event") {
      const { data: campaigns, error: campaignsError } = await db.from("event_campaigns").select("*");
      if (campaignsError) throw new Error(`event_campaigns 조회 실패: ${campaignsError.message}`);
      for (const c of campaigns ?? []) {
        campaignByKey.set(c.campaign_key, {
          id: c.id,
          is_visible: c.is_visible,
          start_at: c.start_at,
          end_at: c.end_at,
        });
      }
    }

    const seenProductIds = new Set<string>();
    const seenInPayload = new Set<string>(); // product_id들 — soft delete 판정용

    for (const row of body.rows) {
      try {
        const cells = row.values;

        const brand = normalizeCellText(findCell(cells, "브랜드"));
        const productName = normalizeCellText(findCell(cells, "제품명"));
        if (!brand && !productName) continue; // 빈 Row 무시 (§18)

        // ---- Core field 파싱 --------------------------------------------------
        const corePatch: Record<string, unknown> = {};
        const extraFields: Record<string, string> = {};
        const rowErrors: string[] = [];
        let rawProductId: string | null = null;
        let legacySoftrId: string | null = null;

        for (const header of Object.keys(cells)) {
          const normalizedHeader = normalizeHeader(header);
          if (EXCLUDED_HEADERS.has(normalizedHeader)) continue;

          const coreField = resolveCoreField(sheet, header);
          if (coreField === "product_id") {
            rawProductId = normalizeCellText(cells[header]);
            continue;
          }
          if (coreField === "legacy_softr_record_id") {
            legacySoftrId = normalizeCellText(cells[header]);
            continue;
          }
          if (coreField) {
            if (coreField === "color") {
              const raw = cells[header];
              corePatch.color = raw ? parseColorArray(String(raw)) : [];
            } else if (isNumberField(coreField)) {
              const parsed = parsePrice(cells[header]);
              if (!parsed.ok) {
                rowErrors.push(`${header} 값이 올바른 가격이 아닙니다: ${String(cells[header])}`);
              } else {
                corePatch[coreField] = parsed.value;
              }
            } else if ((TEXT_CORE_FIELDS as readonly string[]).includes(coreField)) {
              corePatch[coreField] = normalizeCellText(cells[header]);
            }
            continue;
          }

          if (sheet === "event" && resolveCampaignField(header)) {
            continue; // 캠페인 필드는 아래에서 별도 처리
          }

          // ---- Dynamic field ------------------------------------------------
          const lookupKey = `${sheet}::${normalizedHeader}`;
          let fieldKey = dynamicDefByColumn.get(lookupKey);
          if (!fieldKey) {
            fieldKey = `${sheet}__${slugifyHeader(header)}`;
            const { error: insertDefError } = await db.from("promotion_field_definitions").insert({
              field_key: fieldKey,
              is_core: false,
              source_sheet: sheet,
              source_column_name: normalizedHeader,
              display_label: normalizedHeader,
              display_order: 900,
              data_type: "text",
              is_visible: true,
              is_searchable: false,
              is_filterable: false,
              change_importance: "minor",
              push_enabled: false,
            });
            if (insertDefError && !insertDefError.message.includes("duplicate")) {
              throw new Error(`Dynamic Field 정의 생성 실패(${normalizedHeader}): ${insertDefError.message}`);
            }
            dynamicDefByColumn.set(lookupKey, fieldKey);
            importanceByFieldKey.set(fieldKey, "minor");
          }

          const value = normalizeCellText(cells[header]);
          if (value !== null) {
            extraFields[fieldKey] = value;
          }
        }

        if (rowErrors.length > 0) {
          errors.push({ rowNumber: row.rowNumber, message: rowErrors.join("; ") });
        }

        corePatch.brand = brand;
        corePatch.product_name = productName;
        if (corePatch.color === undefined) corePatch.color = [];

        // ---- product_id 결정 ---------------------------------------------------
        let productId = rawProductId;
        if (!productId) {
          const { data: minted, error: mintError } = await db.rpc("next_product_id");
          if (mintError || !minted) throw new Error(`product_id 채번 실패: ${mintError?.message}`);
          productId = minted;
          productIdAssignments.push({ rowNumber: row.rowNumber, productId });
        } else if (seenProductIds.has(productId)) {
          errors.push({ rowNumber: row.rowNumber, message: `중복된 product_id: ${productId}` });
          continue;
        }
        seenProductIds.add(productId);
        seenInPayload.add(productId);

        const existing = existingByProductId.get(productId);
        let promotionId: string;

        if (!existing) {
          const { data: inserted, error: insertError } = await db
            .from("promotions")
            .insert({
              product_id: productId,
              legacy_softr_record_id: legacySoftrId,
              promotion_type: sheet,
              brand: corePatch.brand as string,
              product_name: corePatch.product_name as string,
              color: corePatch.color as string[],
              period_label: (corePatch.period_label as string | null) ?? null,
              notice_type: (corePatch.notice_type as string | null) ?? null,
              consumer_price: (corePatch.consumer_price as number | null) ?? null,
              base_sale_price: (corePatch.base_sale_price as number | null) ?? null,
              final_price_card: (corePatch.final_price_card as number | null) ?? null,
              final_price_cash: (corePatch.final_price_cash as number | null) ?? null,
              store_operation_note: (corePatch.store_operation_note as string | null) ?? null,
              default_components: (corePatch.default_components as string | null) ?? null,
              gift: (corePatch.gift as string | null) ?? null,
              photo_review_benefit: (corePatch.photo_review_benefit as string | null) ?? null,
              store_promotion_allowed: (corePatch.store_promotion_allowed as string | null) ?? null,
              remarks: (corePatch.remarks as string | null) ?? null,
              extra_fields: extraFields as Record<string, Json>,
              last_important_change_at: new Date().toISOString(),
              is_initial_import: isInitialImportRun,
            })
            .select("id")
            .single();
          if (insertError || !inserted) {
            errors.push({ rowNumber: row.rowNumber, message: `INSERT 실패: ${insertError?.message}` });
            continue;
          }
          promotionId = inserted.id;
          insertedCount += 1;

          await db.from("promotion_change_logs").insert({
            promotion_id: promotionId,
            product_id: productId,
            changed_field: "product_id",
            before_value: null,
            after_value: productId,
            change_type: "new_product",
            importance: "important",
            source_sheet: sheet,
            // Initial Import(최초 Sync)로 생성된 상품은 Push 소급 발송 대상에서
            // 제외한다 — 기록은 남기되 push_eligible=false (확정 사항, 2026-09-10).
            push_eligible: !isInitialImportRun,
          });
        } else {
          promotionId = existing.id;
          const changed: ChangedFieldEntry[] = [];

          const CORE_COMPARE_FIELDS = [
            "period_label",
            "notice_type",
            "consumer_price",
            "base_sale_price",
            "final_price_card",
            "final_price_cash",
            "store_operation_note",
            "default_components",
            "gift",
            "photo_review_benefit",
            "store_promotion_allowed",
            "remarks",
            "color",
          ] as const;

          // 실제로 값이 달라진 필드만 updatePatch에 담는다 — 그래야 "아무것도 안
          // 바뀐 Row"는 UPDATE 문 자체를 안 쏘고, updated_at도 그대로 유지된다.
          // (예전엔 Row에 그 헤더가 있기만 하면 값이 같아도 무조건 담아서, 아무
          // 변경 없는 재Sync에도 188개 UPDATE가 매번 나가는 문제가 있었다 —
          // 실제 DEV Sheet로 "동일값 재Sync" 테스트를 하다 발견.)
          const updatePatch: Record<string, unknown> = {};
          for (const field of CORE_COMPARE_FIELDS) {
            if (!(field in corePatch)) continue; // 이 Row에 해당 헤더가 아예 없으면 건드리지 않는다
            const newValue = corePatch[field];
            const oldValue = (existing as Record<string, unknown>)[field];
            if (!isEqual(newValue, oldValue)) {
              updatePatch[field] = newValue;
              changed.push({
                fieldKey: field,
                before: (oldValue ?? null) as Json,
                after: (newValue ?? null) as Json,
                changeType: classifyChangeType(field),
                importance: importanceByFieldKey.get(field) ?? "minor",
              });
            }
          }
          if (brand && brand !== existing.brand) updatePatch.brand = brand;
          if (productName && productName !== existing.product_name) updatePatch.product_name = productName;

          const newExtra = extraFields;
          const oldExtra = (existing.extra_fields ?? {}) as Record<string, string>;
          const extraKeys = new Set([...Object.keys(newExtra), ...Object.keys(oldExtra)]);
          let extraChanged = false;
          for (const key of extraKeys) {
            if (newExtra[key] !== oldExtra[key]) {
              extraChanged = true;
              changed.push({
                fieldKey: key,
                before: (oldExtra[key] ?? null) as Json,
                after: (newExtra[key] ?? null) as Json,
                changeType: "configuration",
                importance: importanceByFieldKey.get(key) ?? "minor",
              });
            }
          }
          if (extraChanged) updatePatch.extra_fields = newExtra;

          if (!existing.is_active) {
            updatePatch.is_active = true; // 시트에 다시 나타나면 재활성화
          }

          const hasImportantChange = changed.some((c) => c.importance !== "minor");
          if (hasImportantChange) updatePatch.last_important_change_at = new Date().toISOString();

          if (Object.keys(updatePatch).length > 0) {
            const { error: updateError } = await db
              .from("promotions")
              .update(updatePatch as Database["public"]["Tables"]["promotions"]["Update"])
              .eq("id", promotionId);
            if (updateError) {
              errors.push({ rowNumber: row.rowNumber, message: `UPDATE 실패: ${updateError.message}` });
              continue;
            }
          }

          if (changed.length > 0) {
            updatedCount += 1;
            await db.from("promotion_change_logs").insert(
              changed.map((c) => ({
                promotion_id: promotionId,
                product_id: productId!,
                changed_field: c.fieldKey,
                before_value: c.before,
                after_value: c.after,
                change_type: c.changeType,
                importance: c.importance,
                source_sheet: sheet,
              })),
            );
          }
        }

        // ---- 행사 캠페인 처리 (event 시트 전용) -----------------------------------
        if (sheet === "event") {
          const campaignName = normalizeCellText(findCell(cells, "행사명"));
          if (campaignName) {
            const startRaw = normalizeCellText(findCell(cells, "행사 시작일"));
            const endRaw = normalizeCellText(findCell(cells, "행사 종료일"));
            const visibleRaw = normalizeCellText(findCell(cells, "노출여부"));
            const startAt = startRaw ? new Date(startRaw).toISOString() : null;
            const endAt = endRaw ? new Date(endRaw).toISOString() : null;
            const isVisible = visibleRaw?.toUpperCase() === "ON";

            const key = campaignName;
            const prior = campaignByKey.get(key);
            let campaignId: string;

            if (!prior) {
              const { data: createdCampaign, error: campaignInsertError } = await db
                .from("event_campaigns")
                .insert({ campaign_name: campaignName, campaign_key: key, start_at: startAt, end_at: endAt, is_visible: isVisible })
                .select("id")
                .single();
              if (campaignInsertError || !createdCampaign) {
                errors.push({ rowNumber: row.rowNumber, message: `캠페인 생성 실패: ${campaignInsertError?.message}` });
              } else {
                campaignId = createdCampaign.id;
                campaignByKey.set(key, { id: campaignId, is_visible: isVisible, start_at: startAt, end_at: endAt });
                await linkCampaignProduct(db, campaignId, promotionId);
              }
            } else {
              campaignId = prior.id;
              const campaignChanged =
                prior.is_visible !== isVisible || prior.start_at !== startAt || prior.end_at !== endAt;
              if (campaignChanged) {
                await db
                  .from("event_campaigns")
                  .update({ start_at: startAt, end_at: endAt, is_visible: isVisible })
                  .eq("id", campaignId);
                campaignByKey.set(key, { id: campaignId, is_visible: isVisible, start_at: startAt, end_at: endAt });

                await db.from("promotion_change_logs").insert({
                  promotion_id: promotionId,
                  product_id: productId,
                  changed_field: "campaign_visibility",
                  before_value: { is_visible: prior.is_visible, start_at: prior.start_at, end_at: prior.end_at } as Json,
                  after_value: { is_visible: isVisible, start_at: startAt, end_at: endAt } as Json,
                  change_type: "event_period",
                  importance: "important",
                  source_sheet: sheet,
                });
                await db
                  .from("promotions")
                  .update({ last_important_change_at: new Date().toISOString() })
                  .eq("id", promotionId);
              }
              await linkCampaignProduct(db, campaignId, promotionId);
            }
          }
        }
      } catch (rowError) {
        errors.push({
          rowNumber: row.rowNumber,
          message: rowError instanceof Error ? rowError.message : String(rowError),
        });
      }
    }

    // ---- Soft delete: 이번 Sync에 없는 기존 product_id ---------------------------
    // partial(기본값)에서는 이 블록을 절대 실행하지 않는다 — 누락된 기존 상품이
    // 있어도 그대로 둔다. full_snapshot에서만, 그것도 아래 안전장치를 모두
    // 통과했을 때만 비활성화한다(2026-09-11 대량 비활성화 사고로 도입).
    const missingProductIds = [...existingByProductId.entries()]
      .filter(([productId, existing]) => existing.is_active && !seenInPayload.has(productId))
      .map(([productId]) => productId);
    deactivationGuard.missingCount = missingProductIds.length;
    const existingActiveCount = [...existingByProductId.values()].filter((p) => p.is_active).length;
    deactivationGuard.missingRatio = existingActiveCount > 0 ? missingProductIds.length / existingActiveCount : 0;

    if (syncMode === "full_snapshot" && missingProductIds.length > 0) {
      // 전체 Row parse 성공 여부 확인: Row 파싱/검증 실패가 하나라도 있으면
      // 이 payload는 "전체 목록"이라고 신뢰할 수 없다 — 대량 비활성화를 막는다.
      if (errors.length > 0) {
        deactivationGuard.blocked = true;
        deactivationGuard.reason = `Row 파싱/검증 실패 ${errors.length}건이 존재해 대량 비활성화를 중단합니다 — 관리자 확인이 필요합니다.`;
      } else {
        const existingActiveIds = [...existingByProductId.values()]
          .filter((p) => p.is_active)
          .map((p) => p.product_id);
        const safety = evaluateDeactivationSafety(existingActiveIds, seenInPayload, deactivationSafetyOptions());
        if (safety.blocked) {
          deactivationGuard.blocked = true;
          deactivationGuard.reason = safety.reason;
        }
      }
    }

    if (syncMode === "full_snapshot" && missingProductIds.length > 0 && !deactivationGuard.blocked) {
      for (const productId of missingProductIds) {
        const existing = existingByProductId.get(productId)!;
        const { error: deactivateError } = await db
          .from("promotions")
          .update({ is_active: false })
          .eq("id", existing.id);
        if (!deactivateError) {
          deactivatedCount += 1;
          await db.from("promotion_change_logs").insert({
            promotion_id: existing.id,
            product_id: productId,
            changed_field: "is_active",
            before_value: true,
            after_value: false,
            change_type: "minor_edit",
            importance: "minor",
            source_sheet: sheet,
          });
        }
      }
    }

    // 안전장치가 대량 비활성화를 막았다면, 이 Sync 실행 자체를 실패로 기록한다
    // (침묵 속에 일부만 처리하고 성공으로 보고하지 않는다 — 관리자가 sync_logs/
    // errors를 보고 원인을 파악하고 Sheet 데이터를 확인해야 한다).
    const guardBlockedSync = deactivationGuard.blocked;
    if (guardBlockedSync && deactivationGuard.reason) {
      errors.push({ rowNumber: 0, message: deactivationGuard.reason });
    }

    await db
      .from("sync_logs")
      .update({
        finished_at: new Date().toISOString(),
        success: !guardBlockedSync,
        inserted_count: insertedCount,
        updated_count: updatedCount,
        deactivated_count: deactivatedCount,
        failed_count: errors.length,
        error_detail: errors.length > 0 ? (errors as unknown as Json) : null,
      })
      .eq("id", syncLogId);

    // 이번 실행이 성공적으로 끝났으니 "이 Sheet 타입의 최초 Import 완료"를
    // 영구 기록한다 — 이미 기록돼 있으면 DB 함수 내부의 COALESCE가 그대로 보존한다.
    // 안전장치가 막은 실행은 완료로 간주하지 않는다.
    if (!guardBlockedSync) {
      await db.rpc("mark_initial_import_completed", { p_promotion_type: sheet });
    }

    return {
      success: !guardBlockedSync,
      syncLogId,
      syncMode,
      insertedCount,
      updatedCount,
      deactivatedCount,
      failedCount: errors.length,
      errors,
      productIdAssignments,
      deactivationGuard,
    };
  } catch (fatalError) {
    const message = fatalError instanceof Error ? fatalError.message : String(fatalError);
    await db
      .from("sync_logs")
      .update({
        finished_at: new Date().toISOString(),
        success: false,
        inserted_count: insertedCount,
        updated_count: updatedCount,
        deactivated_count: deactivatedCount,
        failed_count: errors.length,
        error_detail: { fatal: message, rowErrors: errors } as unknown as Json,
      })
      .eq("id", syncLogId);

    return {
      success: false,
      syncLogId,
      syncMode,
      insertedCount,
      updatedCount,
      deactivatedCount,
      failedCount: errors.length,
      errors: [...errors, { rowNumber: 0, message: `Sync 실패: ${message}` }],
      productIdAssignments,
      deactivationGuard,
    };
  }
}

function findCell(values: Record<string, unknown>, header: string): unknown {
  const normalized = normalizeHeader(header);
  for (const key of Object.keys(values)) {
    if (normalizeHeader(key) === normalized) return values[key];
  }
  return undefined;
}

async function linkCampaignProduct(
  db: ReturnType<typeof createServiceRoleClient>,
  campaignId: string,
  promotionId: string,
) {
  await db
    .from("event_campaign_products")
    .upsert({ campaign_id: campaignId, promotion_id: promotionId }, { onConflict: "campaign_id,promotion_id" });
}
