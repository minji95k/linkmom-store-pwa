import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, NoticeType } from "@/types/database";

type Client = SupabaseClient<Database>;
type NoticeRow = Database["public"]["Tables"]["notices"]["Row"];
type NoticeReadRow = Database["public"]["Tables"]["notice_reads"]["Row"];
type NoticeTargetRow = Database["public"]["Tables"]["notice_targets"]["Row"];

export type NoticeImportance = "critical" | "important" | "normal";

/**
 * 유형보다 중요도 중심으로 시각 구분하라는 요구사항(§2)에 따른 매핑.
 * 판매가/공급가 변경은 매장 운영에 직접 영향을 주므로 important로 분류한다.
 */
const IMPORTANCE_BY_TYPE: Record<NoticeType, NoticeImportance> = {
  긴급: "critical",
  필독: "critical",
  중요: "important",
  판매가변경: "important",
  공급가변경: "important",
  일반: "normal",
  행사: "normal",
  발주: "normal",
  운영: "normal",
  시스템: "normal",
  교육: "normal", // Phase 9 SKIP(2026-09-17) — 교육 목적 공지, 정보성 유형과 동일 취급
};

export function noticeImportance(type: NoticeType): NoticeImportance {
  return IMPORTANCE_BY_TYPE[type] ?? "normal";
}

const IMPORTANCE_RANK: Record<NoticeImportance, number> = { critical: 0, important: 1, normal: 2 };

export interface NoticeWithReadStatus extends NoticeRow {
  myRead: Pick<NoticeReadRow, "read_at" | "confirmed_at"> | null;
}

function sortByPriority(rows: NoticeWithReadStatus[]): NoticeWithReadStatus[] {
  return [...rows].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    const rankDiff = IMPORTANCE_RANK[noticeImportance(a.notice_type)] - IMPORTANCE_RANK[noticeImportance(b.notice_type)];
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
  });
}

/**
 * 목록/홈에서 공통으로 쓰는 조회. RLS(notice_visible_to_current_user)가 대상·게시기간을
 * 이미 걸러주므로 여기서는 "내가 읽었는지"만 별도 조회해 합친다 — PostgREST 임베드
 * 대신 두 번 조회하는 이유는 이 저장소의 손으로 짠 Database 타입에 FK Relationships
 * 메타데이터가 없어 임베드 타입 추론이 안 되기 때문(진짜 FK는 있고 RLS도 정상 동작한다).
 */
export async function getNoticesForStaff(supabase: Client, userId: string): Promise<NoticeWithReadStatus[]> {
  const { data: notices, error } = await supabase
    .from("notices")
    .select("*")
    .order("published_at", { ascending: false });
  if (error) throw error;

  const ids = (notices ?? []).map((n) => n.id);
  let reads: NoticeReadRow[] = [];
  if (ids.length > 0) {
    const { data } = await supabase.from("notice_reads").select("*").eq("user_id", userId).in("notice_id", ids);
    reads = data ?? [];
  }
  const readByNotice = new Map(reads.map((r) => [r.notice_id, r]));

  const rows: NoticeWithReadStatus[] = (notices ?? []).map((n) => ({
    ...n,
    myRead: readByNotice.get(n.id) ?? null,
  }));
  return sortByPriority(rows);
}

export async function getUnreadNoticeCount(supabase: Client, userId: string): Promise<number> {
  const { data: notices } = await supabase.from("notices").select("id");
  const ids = (notices ?? []).map((n) => n.id);
  if (ids.length === 0) return 0;

  const { data: reads } = await supabase.from("notice_reads").select("notice_id").eq("user_id", userId).in("notice_id", ids);
  const readIds = new Set((reads ?? []).map((r) => r.notice_id));
  return ids.filter((id) => !readIds.has(id)).length;
}

/**
 * 홈 화면용 — "지금 확인해야 할" 공지만 추린다(§10): 아직 안 읽었거나, 필독인데
 * 아직 확인 완료를 안 누른 것. 이미 읽었고 필독도 아니거나 이미 확인까지 끝난
 * 공지는 홈에서 더 이상 보여줄 이유가 없어 제외한다(전체 목록은 공지 탭에서 본다).
 */
export function selectHomeNoticeHighlights(
  notices: NoticeWithReadStatus[],
  limit = 3,
): NoticeWithReadStatus[] {
  const needsAttention = notices.filter((n) => {
    const unread = !n.myRead;
    const unconfirmedRequired = n.requires_confirmation && !n.myRead?.confirmed_at;
    return unread || unconfirmedRequired;
  });
  return needsAttention.slice(0, limit);
}

export async function getNoticeForStaffDetail(
  supabase: Client,
  noticeId: string,
  userId: string,
): Promise<{ notice: NoticeRow; myRead: NoticeReadRow | null } | null> {
  // RLS가 대상/게시기간을 걸러준다 — 안 보이면 null(→ 404), 존재/권한 구분하지 않는다.
  const { data: notice } = await supabase.from("notices").select("*").eq("id", noticeId).maybeSingle();
  if (!notice) return null;

  const { data: myRead } = await supabase
    .from("notice_reads")
    .select("*")
    .eq("notice_id", noticeId)
    .eq("user_id", userId)
    .maybeSingle();

  return { notice, myRead: myRead ?? null };
}

/** 실제로 상세를 열었을 때만 호출한다(§7) — 이미 읽었으면 read_at을 갱신하지 않는다. */
export async function markNoticeRead(supabase: Client, noticeId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("notice_reads")
    .upsert({ notice_id: noticeId, user_id: userId }, { onConflict: "notice_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}

/** [확인 완료] 버튼 전용 — read와 별개 상태다(§8). */
export async function confirmNotice(supabase: Client, noticeId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("notice_reads")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("notice_id", noticeId)
    .eq("user_id", userId);
  if (error) throw error;
}

export interface NoticeAudienceSummary {
  targetCount: number;
  readCount: number;
  unreadCount: number;
  confirmedCount: number;
  unconfirmedCount: number;
}

/**
 * ADMIN 열람 현황(§12). notice_targets는 "규칙"만 담고 있어서(전체/매장/Role/개인)
 * 실제 대상 인원을 알려면 profiles/user_store_access와 합쳐 풀어야 한다.
 * Phase 12에서 다른 지표가 필요해지면 이 함수에 필드만 추가하면 되는 구조다.
 */
export async function getNoticeAudienceSummary(supabase: Client, noticeId: string): Promise<NoticeAudienceSummary> {
  const { data: targetRows } = await supabase.from("notice_targets").select("*").eq("notice_id", noticeId);
  const targets: NoticeTargetRow[] = targetRows ?? [];

  const userIds = new Set<string>();

  if (targets.some((t) => t.target_type === "all")) {
    const { data } = await supabase.from("profiles").select("id").eq("is_active", true);
    for (const u of data ?? []) userIds.add(u.id);
  } else {
    const roles = targets.filter((t) => t.target_type === "role").map((t) => t.role!);
    if (roles.length > 0) {
      const { data } = await supabase.from("profiles").select("id").eq("is_active", true).in("role", roles);
      for (const u of data ?? []) userIds.add(u.id);
    }

    for (const t of targets) {
      if (t.target_type === "user" && t.user_id) userIds.add(t.user_id);
    }

    const storeIds = targets.filter((t) => t.target_type === "store").map((t) => t.store_id!);
    if (storeIds.length > 0) {
      const { data: access } = await supabase.from("user_store_access").select("user_id").in("store_id", storeIds);
      const candidateIds = Array.from(new Set((access ?? []).map((a) => a.user_id)));
      if (candidateIds.length > 0) {
        const { data: activeUsers } = await supabase
          .from("profiles")
          .select("id")
          .eq("is_active", true)
          .in("id", candidateIds);
        for (const u of activeUsers ?? []) userIds.add(u.id);
      }
    }
  }

  const targetCount = userIds.size;

  const { data: readRows } = await supabase.from("notice_reads").select("user_id, confirmed_at").eq("notice_id", noticeId);
  const relevantReads = (readRows ?? []).filter((r) => userIds.has(r.user_id));
  const readCount = relevantReads.length;
  const confirmedCount = relevantReads.filter((r) => r.confirmed_at !== null).length;

  return {
    targetCount,
    readCount,
    unreadCount: Math.max(0, targetCount - readCount),
    confirmedCount,
    unconfirmedCount: Math.max(0, targetCount - confirmedCount),
  };
}

export interface AttachmentWithUrl {
  id: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
}

/**
 * Storage는 private 버킷이라(§13) 서버에서만 Signed URL을 만든다. 호출부(상세
 * 페이지/ADMIN 화면)가 이미 "이 사용자가 이 공지를 볼 수 있다"를 notices RLS로
 * 확인한 뒤에만 이 함수를 부른다 — Service Role은 그 확인 이후의 파일 접근에만 쓴다.
 */
export async function getAttachmentsForNotice(noticeId: string): Promise<AttachmentWithUrl[]> {
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from("attachments")
    .select("*")
    .eq("owner_type", "notice")
    .eq("owner_id", noticeId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return Promise.all(
    (data ?? []).map(async (a) => {
      const { data: signed } = await service.storage
        .from("notice-attachments")
        .createSignedUrl(a.storage_path, 60 * 10);
      return {
        id: a.id,
        storage_path: a.storage_path,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        url: signed?.signedUrl ?? null,
      };
    }),
  );
}
