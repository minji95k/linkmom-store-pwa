"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { notifyNoticeCreated } from "@/lib/push/notify-notice";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, NoticeType, UserRole } from "@/types/database";

export interface NoticeFormState {
  error: string | null;
}

/** 이 파일의 모든 Action은 admin/layout.tsx의 role 게이트를 다시 한번 자체 검증한다(§14, CLAUDE.md 서버 사이드 이중 방어). */
async function requireAdmin() {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.profile.role !== "ADMIN") {
    throw new Error("관리자만 사용할 수 있습니다.");
  }
  return currentUser;
}

function parseTargets(formData: FormData) {
  const isAll = formData.get("target_all") === "on";
  const storeIds = formData.getAll("target_stores").map(String).filter(Boolean);
  const roles = formData.getAll("target_roles").map(String).filter(Boolean) as UserRole[];
  return { isAll, storeIds, roles };
}

async function insertTargets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  noticeId: string,
  targets: { isAll: boolean; storeIds: string[]; roles: UserRole[] },
) {
  const rows: Database["public"]["Tables"]["notice_targets"]["Insert"][] = [];
  if (targets.isAll) {
    rows.push({ notice_id: noticeId, target_type: "all" });
  } else {
    for (const storeId of targets.storeIds) {
      rows.push({ notice_id: noticeId, target_type: "store", store_id: storeId });
    }
    for (const role of targets.roles) {
      rows.push({ notice_id: noticeId, target_type: "role", role });
    }
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from("notice_targets").insert(rows);
  if (error) throw error;
}

async function uploadAttachments(noticeId: string, uploaderId: string, files: File[]) {
  const validFiles = files.filter((f) => f.size > 0);
  if (validFiles.length === 0) return;

  const service = createServiceRoleClient();
  for (const file of validFiles) {
    const path = `${noticeId}/${randomUUID()}-${file.name}`;
    const { error: uploadError } = await service.storage
      .from("notice-attachments")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) throw uploadError;

    const { error: insertError } = await service.from("attachments").insert({
      owner_type: "notice",
      owner_id: noticeId,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: uploaderId,
    });
    if (insertError) throw insertError;
  }
}

export async function createNoticeAction(_prevState: NoticeFormState, formData: FormData): Promise<NoticeFormState> {
  const currentUser = await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const noticeType = String(formData.get("notice_type") ?? "일반") as NoticeType;
  const isPinned = formData.get("is_pinned") === "on";
  const requiresConfirmation = formData.get("requires_confirmation") === "on";
  const externalLink = String(formData.get("external_link") ?? "").trim();
  const publishedAtRaw = String(formData.get("published_at") ?? "");
  const expiresAtRaw = String(formData.get("expires_at") ?? "");
  const targets = parseTargets(formData);

  if (!title || !body) {
    return { error: "제목과 본문을 입력해주세요." };
  }
  if (!targets.isAll && targets.storeIds.length === 0 && targets.roles.length === 0) {
    return { error: "대상을 하나 이상 선택해주세요(전체, 또는 매장/Role)." };
  }

  const supabase = await createClient();
  const { data: notice, error } = await supabase
    .from("notices")
    .insert({
      title,
      body,
      notice_type: noticeType,
      author_id: currentUser.id,
      author_name: currentUser.profile.name,
      is_pinned: isPinned,
      requires_confirmation: requiresConfirmation,
      external_link: externalLink || null,
      published_at: publishedAtRaw ? new Date(publishedAtRaw).toISOString() : undefined,
      expires_at: expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null,
    })
    .select("id")
    .single();
  if (error) return { error: `공지 등록에 실패했습니다: ${error.message}` };

  await insertTargets(supabase, notice.id, targets);

  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File);
  await uploadAttachments(notice.id, currentUser.id, files);

  // Phase 11 §11: 긴급/중요/필독 신규 공지만 Push(notifyNoticeCreated 내부에서 판정).
  // notice_targets를 그대로 재사용하므로 별도 대상 계산이 없다. 응답(redirect) 후
  // best-effort로 실행 — 실패해도 공지 등록 자체는 이미 완료된 뒤다.
  after(() =>
    notifyNoticeCreated(notice.id, noticeType, title).catch((error) => {
      console.error("notifyNoticeCreated 실패:", error);
    }),
  );

  revalidatePath("/notices");
  revalidatePath("/");
  revalidatePath("/admin/notices");
  redirect("/admin/notices");
}

export async function updateNoticeAction(
  noticeId: string,
  _prevState: NoticeFormState,
  formData: FormData,
): Promise<NoticeFormState> {
  const currentUser = await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const noticeType = String(formData.get("notice_type") ?? "일반") as NoticeType;
  const isPinned = formData.get("is_pinned") === "on";
  const requiresConfirmation = formData.get("requires_confirmation") === "on";
  const externalLink = String(formData.get("external_link") ?? "").trim();
  const publishedAtRaw = String(formData.get("published_at") ?? "");
  const expiresAtRaw = String(formData.get("expires_at") ?? "");
  const targets = parseTargets(formData);

  if (!title || !body) {
    return { error: "제목과 본문을 입력해주세요." };
  }
  if (!targets.isAll && targets.storeIds.length === 0 && targets.roles.length === 0) {
    return { error: "대상을 하나 이상 선택해주세요(전체, 또는 매장/Role)." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("notices")
    .update({
      title,
      body,
      notice_type: noticeType,
      is_pinned: isPinned,
      requires_confirmation: requiresConfirmation,
      external_link: externalLink || null,
      published_at: publishedAtRaw ? new Date(publishedAtRaw).toISOString() : undefined,
      expires_at: expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null,
    })
    .eq("id", noticeId);
  if (error) return { error: `공지 수정에 실패했습니다: ${error.message}` };

  // Targeting은 "현재 폼 상태"로 통째로 다시 만든다 — 부분 diff보다 훨씬 단순하고,
  // 관리자 화면에서 실수로 지웠다 다시 만드는 일이 잦지 않을 규모의 데이터라 안전하다.
  const { error: deleteError } = await supabase.from("notice_targets").delete().eq("notice_id", noticeId);
  if (deleteError) return { error: `대상 갱신에 실패했습니다: ${deleteError.message}` };
  await insertTargets(supabase, noticeId, targets);

  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File);
  await uploadAttachments(noticeId, currentUser.id, files);

  revalidatePath("/notices");
  revalidatePath(`/notices/${noticeId}`);
  revalidatePath("/");
  revalidatePath("/admin/notices");
  redirect("/admin/notices");
}

export async function deleteAttachmentAction(noticeId: string, attachmentId: string, storagePath: string) {
  await requireAdmin();
  const service = createServiceRoleClient();

  await service.storage.from("notice-attachments").remove([storagePath]);
  const { error } = await service.from("attachments").delete().eq("id", attachmentId);
  if (error) throw error;

  revalidatePath(`/admin/notices/${noticeId}/edit`);
}
