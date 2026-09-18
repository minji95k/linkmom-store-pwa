import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; inactive?: string }>;
}) {
  const { next, inactive } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <div className="text-xl font-black">
        <span className="text-purple">Link</span>
        <span className="text-mint-dark">mom</span>
      </div>

      {inactive === "1" && (
        <p className="rounded-xl bg-danger-tint p-3 text-xs font-semibold text-danger">
          비활성화된 계정입니다. 관리자에게 문의해주세요.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>매장 운영 로그인</CardTitle>
          <CardDescription>본사에서 초대받은 계정으로만 로그인할 수 있습니다</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next ?? "/"} />
        </CardContent>
      </Card>
    </main>
  );
}
