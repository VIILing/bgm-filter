"use client";

import { useEffect, useState } from "react";

import { SUBJECT_TYPES } from "~/shared/subject-contract";
import { normalizeTypes } from "~/lib/url-state";

export interface TypeFilterProps {
  types: number[];
  onChange: (types: number[]) => void;
  typeCounts: Partial<Record<number, number>>;
  countsLoading?: boolean;
}

/** 类型多选；全部取消时自动回填全选并提示一次。 */
export function TypeFilter({ types, onChange, typeCounts, countsLoading = false }: TypeFilterProps) {
  const selected = normalizeTypes(types);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggle = (value: number) => {
    const nextSet = new Set(selected);
    if (nextSet.has(value)) {
      nextSet.delete(value);
    } else {
      nextSet.add(value);
    }
    if (nextSet.size === 0) {
      onChange(normalizeTypes([]));
      setNotice("已恢复为全部类型");
      return;
    }
    setNotice(null);
    onChange(SUBJECT_TYPES.map((type) => type.value).filter((type) => nextSet.has(type)));
  };

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-sm font-medium text-slate-700">类型</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {SUBJECT_TYPES.map((type) => {
          const count = typeCounts[type.value];
          return (
            <label key={type.value} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={selected.includes(type.value)}
                onChange={() => toggle(type.value)}
                className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-sky-600"
              />
              <span>{type.label}</span>
              <span className="text-xs tabular-nums text-slate-500">
                {countsLoading && count === undefined ? "…" : count === undefined ? "0" : count.toLocaleString("zh-CN")}
              </span>
            </label>
          );
        })}
      </div>
      {notice && (
        <p className="mt-1 text-xs text-amber-700" role="status">
          {notice}
        </p>
      )}
    </fieldset>
  );
}
