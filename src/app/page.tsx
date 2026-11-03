"use client";

import { trpc } from "~/trpc/react";

/**
 * S1 占位页：只验证 tRPC 链路（stats 查询）可通。S4 会重写为完整筛选界面。
 */
export default function HomePage() {
  const stats = trpc.subject.stats.useQuery();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">BGM Filter</h1>
      <p className="text-lg text-slate-600">筛选界面开发中</p>
      <p className="text-sm text-slate-500">
        {stats.isLoading && "正在读取统计…"}
        {stats.error && `统计读取失败：${stats.error.message}`}
        {stats.data && `当前数据库共 ${stats.data.total.toLocaleString("zh-CN")} 条条目`}
      </p>
    </main>
  );
}
