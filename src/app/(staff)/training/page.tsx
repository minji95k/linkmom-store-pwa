import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Phase 7 범위 밖(교육자료 실제 기능은 이후 Phase) — Bottom Navigation 자리만 유지. */
export default function TrainingPlaceholderPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-lg font-black">교육자료</h1>
      <Card>
        <CardHeader>
          <CardTitle>준비 중입니다</CardTitle>
          <CardDescription>제품 교육자료 기능은 다음 Phase에서 제공됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="text-text-2">
          지금은 프로모션 탭에서 상품 정보를 확인할 수 있습니다.
        </CardContent>
      </Card>
    </main>
  );
}
