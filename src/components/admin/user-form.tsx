"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UserFormState } from "@/app/admin/users/actions";
import type { Database, UserRole } from "@/types/database";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "ADMIN", label: "본사 관리자" },
  { value: "STORE_MANAGER", label: "매장 관리자" },
  { value: "STAFF", label: "매장 직원" },
];

type StoreRow = Pick<Database["public"]["Tables"]["stores"]["Row"], "id" | "name">;

export interface UserFormInitialValues {
  name: string;
  email: string;
  role: UserRole;
  storeId?: string;
}

export function UserForm({
  action,
  stores,
  initialValues,
  submitLabel,
  mode,
}: {
  action: (prevState: UserFormState, formData: FormData) => Promise<UserFormState>;
  stores: StoreRow[];
  initialValues?: UserFormInitialValues;
  submitLabel: string;
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field label="이름">
        <Input name="name" required defaultValue={initialValues?.name} />
      </Field>

      <Field label="이메일">
        {mode === "create" ? (
          <Input type="email" name="email" required placeholder="name@linkmom.co.kr" autoComplete="off" />
        ) : (
          <Input type="email" defaultValue={initialValues?.email ?? ""} disabled readOnly />
        )}
      </Field>

      <Field label="Store">
        <select
          name="store_id"
          required
          defaultValue={initialValues?.storeId ?? ""}
          className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
        >
          <option value="" disabled>
            선택
          </option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Role">
        <select
          name="role"
          defaultValue={initialValues?.role ?? "STAFF"}
          className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      {mode === "create" && (
        <p className="rounded-xl bg-bg p-3 text-xs text-text-2">
          신규 계정은 사내에 공지된 공통 초기 비밀번호로 생성됩니다. 생성 후 직원에게 이메일과 초기 비밀번호를
          안내해주세요. 직원은 로그인 후 MY에서 본인이 원하는 비밀번호로 변경할 수 있습니다.
        </p>
      )}

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
