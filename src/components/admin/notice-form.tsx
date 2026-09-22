"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import type { NoticeFormState } from "@/app/admin/notices/actions";
import { utcIsoToKstDatetimeLocal } from "@/lib/notices/datetime";
import type { Database, NoticeType, UserRole } from "@/types/database";

const NOTICE_TYPES: NoticeType[] = [
  "일반",
  "중요",
  "긴급",
  "필독",
  "행사",
  "발주",
  "판매가변경",
  "공급가변경",
  "운영",
  "시스템",
  "교육",
];

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "ADMIN", label: "본사 관리자" },
  { value: "STORE_MANAGER", label: "매장 관리자" },
  { value: "STAFF", label: "매장 직원" },
];

type StoreRow = Pick<Database["public"]["Tables"]["stores"]["Row"], "id" | "name">;

/** yyyy-MM-ddTHH:mm(KST) — <input type="datetime-local">의 value 포맷. 실행 환경의
 * 로컬 타임존에 의존하지 않도록 src/lib/notices/datetime.ts의 공통 유틸을 그대로 쓴다. */
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  return utcIsoToKstDatetimeLocal(iso);
}

export interface NoticeFormInitialValues {
  title: string;
  body: string;
  notice_type: NoticeType;
  is_pinned: boolean;
  requires_confirmation: boolean;
  external_link: string | null;
  published_at: string;
  expires_at: string | null;
  targetAll: boolean;
  targetStoreIds: string[];
  targetRoles: UserRole[];
}

export function NoticeForm({
  action,
  stores,
  initialValues,
  submitLabel,
}: {
  action: (prevState: NoticeFormState, formData: FormData) => Promise<NoticeFormState>;
  stores: StoreRow[];
  initialValues?: NoticeFormInitialValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [targetAll, setTargetAll] = useState(initialValues?.targetAll ?? true);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field label="제목">
        <input
          name="title"
          required
          defaultValue={initialValues?.title}
          className="h-11 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-purple"
        />
      </Field>

      <Field label="본문">
        <textarea
          name="body"
          required
          rows={6}
          defaultValue={initialValues?.body}
          className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-purple"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="유형">
          <select
            name="notice_type"
            defaultValue={initialValues?.notice_type ?? "일반"}
            className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
          >
            {NOTICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex flex-col justify-end gap-2 pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_pinned" defaultChecked={initialValues?.is_pinned} /> 상단 고정
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="requires_confirmation" defaultChecked={initialValues?.requires_confirmation} />{" "}
            필독(확인 완료 필요)
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="게시 시작">
          <input
            type="datetime-local"
            name="published_at"
            defaultValue={toDatetimeLocal(initialValues?.published_at) || toDatetimeLocal(new Date().toISOString())}
            className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
          />
        </Field>
        <Field label="게시 종료(선택)">
          <input
            type="datetime-local"
            name="expires_at"
            defaultValue={toDatetimeLocal(initialValues?.expires_at)}
            className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
          />
        </Field>
      </div>

      <Field label="외부 링크(선택)">
        <input
          type="url"
          name="external_link"
          defaultValue={initialValues?.external_link ?? ""}
          placeholder="https://..."
          className="h-11 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-purple"
        />
      </Field>

      <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
        <legend className="px-1 text-xs font-bold text-text-2">대상</legend>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            name="target_all"
            checked={targetAll}
            onChange={(e) => setTargetAll(e.target.checked)}
          />
          전체 매장 · 전체 직원
        </label>

        <div className={targetAll ? "pointer-events-none opacity-40" : "flex flex-col gap-3"}>
          <div>
            <p className="mb-1 text-xs text-text-3">대상 매장(복수 선택 가능)</p>
            <div className="flex flex-wrap gap-3">
              {stores.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="target_stores"
                    value={s.id}
                    defaultChecked={initialValues?.targetStoreIds.includes(s.id)}
                    disabled={targetAll}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-text-3">대상 Role(복수 선택 가능)</p>
            <div className="flex flex-wrap gap-3">
              {ROLE_OPTIONS.map((r) => (
                <label key={r.value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="target_roles"
                    value={r.value}
                    defaultChecked={initialValues?.targetRoles.includes(r.value)}
                    disabled={targetAll}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </fieldset>

      <Field label="첨부파일 추가(이미지/PDF/문서, 선택)">
        <input type="file" name="attachments" multiple className="text-sm" />
      </Field>

      {state.error ? <p className="text-sm font-semibold text-danger">{state.error}</p> : null}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "저장 중..." : submitLabel}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-text-2">{label}</span>
      {children}
    </label>
  );
}
