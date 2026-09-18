"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import type { UserFormState } from "@/app/admin/users/actions";

export function ToggleActiveButton({
  action,
  isActive,
}: {
  action: (prevState: UserFormState, formData: FormData) => Promise<UserFormState>;
  isActive: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, success: null });

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" variant={isActive ? "danger" : "secondary"} size="sm" disabled={pending}>
        {pending ? "처리 중..." : isActive ? "비활성화" : "활성화"}
      </Button>
      {state.error ? <p className="text-xs font-semibold text-danger">{state.error}</p> : null}
    </form>
  );
}
