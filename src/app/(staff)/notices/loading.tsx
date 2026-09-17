import { Skeleton } from "@/components/ui/skeleton";

export default function NoticesLoading() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <Skeleton className="h-6 w-16" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </main>
  );
}
