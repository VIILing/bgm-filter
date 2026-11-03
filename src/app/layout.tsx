import { type Metadata } from "next";

import "~/app/globals.css";
import { Providers } from "~/app/providers";

export const metadata: Metadata = {
  title: "BGM Filter",
  description: "本地 Bangumi 条目筛选工具：标签表达式 + 年代 + 类型 + 名称，按评分排序。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
