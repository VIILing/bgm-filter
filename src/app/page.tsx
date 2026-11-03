import { Suspense } from "react";

import { Header } from "~/components/Header";
import { HomeClient } from "~/components/HomeClient";
import { SkeletonRows } from "~/components/SkeletonRows";

/**
 * 单页入口（Server Component）。`useSearchParams` 必须在 Suspense 边界内，
 * 因此把全部客户端交互放在 HomeClient 中。
 */
export default function HomePage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <HomeClient />
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Header isLoading />
      <main className="mx-auto w-full max-w-7xl px-4 py-4">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <SkeletonRows />
        </div>
      </main>
    </div>
  );
}
