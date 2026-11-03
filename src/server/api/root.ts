import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { subjectRouter } from "~/server/api/routers/subject";

/**
 * 主路由。S1 阶段只有 subject 一个子路由的占位实现。
 */
export const appRouter = createTRPCRouter({
  subject: subjectRouter,
});

export type AppRouter = typeof appRouter;

/**
 * 服务端直接调用（RSC / 脚本 / 测试）用的 caller 工厂。
 */
export const createCaller = createCallerFactory(appRouter);
