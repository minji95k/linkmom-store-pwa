import { signOutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="sm">
        로그아웃
      </Button>
    </form>
  );
}
