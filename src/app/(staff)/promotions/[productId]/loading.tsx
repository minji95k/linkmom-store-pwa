import { Skeleton } from "@/components/ui/skeleton";

export default function PromotionDetailLoading() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
    </main>
  );
}
