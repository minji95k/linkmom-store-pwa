"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import type { UserFormState } from "@/app/admin/users/actions";

export function ResetPasswordButton({
  action,
}: {
  action: (prevState: UserFormState, formData: FormData) => Promise<UserFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, success: null });

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "재설정 중..." : "초기 비밀번호로 재설정"}
      </Button>
      {state.error ? <p className="text-xs font-semibold text-danger">{state.error}</p> : null}
      {state.success ? <p className="text-xs font-semibold text-mint-dark">{state.success}</p> : null}
    </form>
  );
}
