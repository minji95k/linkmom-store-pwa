"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { changePasswordAction, type ChangePasswordState } from "@/app/(staff)/my/actions";

const initialState: ChangePasswordState = { error: null, success: null };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="text-xs font-bold text-text-2">비밀번호 변경</p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="current_password" className="text-xs text-text-3">
          현재 비밀번호
        </label>
        <Input id="current_password" name="current_password" type="password" required autoComplete="current-password" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="new_password" className="text-xs text-text-3">
          새 비밀번호(8자 이상)
        </label>
        <Input id="new_password" name="new_password" type="password" required autoComplete="new-password" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm_password" className="text-xs text-text-3">
          새 비밀번호 확인
        </label>
        <Input id="confirm_password" name="confirm_password" type="password" required autoComplete="new-password" />
      </div>

      {state.error ? <p className="text-xs font-semibold text-danger">{state.error}</p> : null}
      {state.success ? <p className="text-xs font-semibold text-mint-dark">{state.success}</p> : null}

      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "변경 중..." : "비밀번호 변경"}
      </Button>
    </form>
  );
}
