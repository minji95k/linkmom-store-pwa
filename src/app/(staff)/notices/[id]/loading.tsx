import { Skeleton } from "@/components/ui/skeleton";

export default function NoticeDetailLoading() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-40 w-full" />
    </main>
  );
}
