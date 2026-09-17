import { Skeleton } from "@/components/ui/skeleton";

export default function CampaignLoading() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-11 w-full" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-36 w-full" />
      ))}
    </main>
  );
}
