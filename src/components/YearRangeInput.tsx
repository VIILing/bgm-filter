import { MAX_YEAR, MIN_YEAR } from "~/lib/url-state";

export interface YearRangeInputProps {
  fromText: string;
  toText: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** 输入非法或 from > to 时的红字提示；null 表示合法。 */
  error: string | null;
}

const inputClass =
  "w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-center text-sm tabular-nums outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200";

/** 起止年份：允许留空；非法或 from > to 时红字提示且父组件暂停查询。 */
export function YearRangeInput({ fromText, toText, onFromChange, onToChange, error }: YearRangeInputProps) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-sm font-medium text-slate-700">年代</legend>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="起始年"
          aria-invalid={error !== null}
          placeholder="不限"
          value={fromText}
          onChange={(event) => onFromChange(event.target.value)}
          className={`${inputClass} ${error ? "border-red-300" : ""}`}
        />
        <span className="text-slate-400" aria-hidden="true">
          —
        </span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="结束年"
          aria-invalid={error !== null}
          placeholder="不限"
          value={toText}
          onChange={(event) => onToChange(event.target.value)}
          className={`${inputClass} ${error ? "border-red-300" : ""}`}
        />
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-xs text-slate-500">
          {MIN_YEAR}–{MAX_YEAR}，留空不限
        </p>
      )}
    </fieldset>
  );
}
