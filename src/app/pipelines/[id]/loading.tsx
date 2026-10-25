import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10" aria-busy="true">
      <span className="sr-only" role="status">
        Chargement du pipeline…
      </span>
      <Skeleton className="mb-2 h-7 w-2/3" />
      <Skeleton className="mb-8 h-4 w-1/3" />
      <Skeleton className="mb-4 h-8 w-full" />
      <Skeleton className="h-40 w-full" />
    </main>
  );
}
