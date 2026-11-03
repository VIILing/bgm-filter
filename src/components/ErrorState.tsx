export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  isRetrying?: boolean;
}

const DB_ERROR_PATTERN = /database|no such table|unable to open|does not exist|prisma|sqlite|数据库|表.*不存在/i;

/** 可读错误 + DB 缺失时的导入提示 + 重试。 */
export function ErrorState({ message, onRetry, isRetrying = false }: ErrorStateProps) {
  const looksLikeDatabaseError = DB_ERROR_PATTERN.test(message);
  const alreadyHasImportHint = message.includes("pnpm db:import");

  return (
    <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm" role="alert">
      <p className="font-medium text-red-800">加载失败：</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-red-700">{message}</p>
      {looksLikeDatabaseError && !alreadyHasImportHint && (
        <p className="mt-2 rounded border border-red-200 bg-white/60 px-3 py-2 text-red-700">
          数据库未导入或不可读，请先在终端运行{" "}
          <code className="rounded bg-red-100 px-1 py-0.5 font-mono text-[13px]">pnpm db:import</code>
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        {isRetrying ? "重试中…" : "重试"}
      </button>
    </div>
  );
}
