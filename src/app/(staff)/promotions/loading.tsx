import { Skeleton } from "@/components/ui/skeleton";

export default function PromotionsLoading() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-36 w-full" />
      ))}
    </main>
  );
}
