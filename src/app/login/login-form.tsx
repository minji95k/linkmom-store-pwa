"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { signInAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs font-bold text-text-2">
          이메일
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="h-11 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-purple"
          placeholder="name@linkmom.co.kr"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-xs font-bold text-text-2">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-11 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-purple"
        />
      </div>

      {state.error ? <p className="text-xs font-semibold text-danger">{state.error}</p> : null}

      <Button type="submit" variant="primary" disabled={pending} className="mt-1">
        {pending ? "로그인 중..." : "로그인"}
      </Button>
    </form>
  );
}
