"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatCount } from "~/lib/format";
import { insertTag } from "~/lib/tag-insert";
import { getBareTagFragment, type TagParseResult } from "~/lib/tag-parse-lite";
import { trpc } from "~/trpc/react";
import { MAX_TAG_EXPR_LENGTH } from "~/lib/url-state";

export interface TagExprInputProps {
  value: string;
  onChange: (value: string) => void;
  /** 由父组件统一计算，保证状态行与查询门控一致。 */
  parse: TagParseResult;
  /** 值变化时聚焦输入框并把光标放到末尾（如点击结果卡片标签后）。 */
  focusToken?: number;
}

/** 标签表达式输入：实时解析状态 + 候选下拉 + 常用标签 chips + 光标处插入。 */
export function TagExprInput({ value, onChange, parse, focusToken = 0 }: TagExprInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFocusToken = useRef(focusToken);
  const [cursor, setCursor] = useState(value.length);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [suggestQuery, setSuggestQuery] = useState("");

  const fragment = useMemo(() => getBareTagFragment(value, cursor), [value, cursor]);
  const fragmentText = fragment?.text ?? "";
  const trimmed = value.trim();

  // 输入停顿 200ms 后才请求联想。
  useEffect(() => {
    if (!fragmentText) {
      setSuggestQuery("");
      return;
    }
    const timer = window.setTimeout(() => setSuggestQuery(fragmentText), 200);
    return () => window.clearTimeout(timer);
  }, [fragmentText]);

  const suggestions = trpc.subject.tags.useQuery(
    { q: suggestQuery, limit: 20 },
    {
      enabled: open && suggestQuery.length > 0,
      placeholderData: keepPreviousData,
    },
  );

  const popular = trpc.subject.tags.useQuery({ q: "", limit: 12 });

  const options = suggestions.data ?? [];
  const showDropdown = open && fragment !== null && suggestQuery.length > 0 && suggestQuery === fragmentText;

  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestQuery]);

  useEffect(() => {
    if (focusToken === lastFocusToken.current) return;
    lastFocusToken.current = focusToken;
    const element = inputRef.current;
    if (!element) return;
    element.focus();
    const position = element.value.length;
    element.setSelectionRange(position, position);
    setCursor(position);
  }, [focusToken]);

  const applyInsertion = (tag: string, appendAtEnd = false) => {
    const element = inputRef.current;
    const at = appendAtEnd ? value.length : (element?.selectionStart ?? value.length);
    const result = insertTag(value, at, tag);
    if (result.expr !== value) onChange(result.expr);
    setOpen(false);
    setActiveIndex(-1);
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      const position = Math.min(result.cursor, node.value.length);
      node.setSelectionRange(position, position);
      setCursor(position);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!fragment) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      if (options.length === 0) return;
      setActiveIndex((previous) => {
        if (event.key === "ArrowDown") {
          return previous < 0 ? 0 : (previous + 1) % options.length;
        }
        return previous <= 0 ? options.length - 1 : previous - 1;
      });
      return;
    }

    if (event.key === "Enter" && showDropdown && options.length > 0) {
      event.preventDefault();
      const option = options[activeIndex] ?? options[0];
      if (option) applyInsertion(option.name);
    }
  };

  const statusClass =
    trimmed === "" ? "text-slate-500" : parse.ok ? "text-emerald-600" : "text-red-600";
  const statusText =
    trimmed === ""
      ? "未限制标签"
      : parse.ok
        ? `✅ 表达式合法 · 涉及 ${parse.tags.length} 个标签`
        : `⛔ ${parse.message ?? "表达式有误"}（第 ${(parse.position ?? 0) + 1} 个字符附近）`;

  return (
    <div>
      <label htmlFor="tag-expr" className="mb-1 block text-sm font-medium text-slate-700">
        标签表达式
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id="tag-expr"
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="tag-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={showDropdown && activeIndex >= 0 ? `tag-option-${activeIndex}` : undefined}
          aria-describedby="tag-expr-status"
          aria-invalid={!parse.ok}
          autoComplete="off"
          spellCheck={false}
          placeholder="科幻 & (恋爱 | 百合) & !R18"
          maxLength={MAX_TAG_EXPR_LENGTH}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next);
            setCursor(event.target.selectionStart ?? next.length);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onSelect={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={handleKeyDown}
          onBlur={() => setOpen(false)}
          className={`w-full rounded-md border bg-white px-3 py-2 font-mono text-sm outline-none transition focus:ring-2 ${
            parse.ok
              ? "border-slate-300 focus:border-sky-500 focus:ring-sky-200"
              : "border-red-300 focus:border-red-400 focus:ring-red-200"
          }`}
        />

        {showDropdown && (
          <ul
            id="tag-suggestions"
            role="listbox"
            aria-label="标签联想"
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
          >
            {suggestions.isFetching && options.length === 0 && (
              <li className="px-3 py-2 text-xs text-slate-500">搜索中…</li>
            )}
            {!suggestions.isFetching && options.length === 0 && (
              <li className="px-3 py-2 text-xs text-slate-500">无匹配标签</li>
            )}
            {options.map((option, index) => (
              <li
                key={option.name}
                id={`tag-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => applyInsertion(option.name)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 ${
                  index === activeIndex ? "bg-sky-50 text-sky-900" : "text-slate-700"
                }`}
              >
                <span className="truncate font-mono">{option.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{option.count.toLocaleString("zh-CN")} 条</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p id="tag-expr-status" className={`mt-1 text-xs ${statusClass}`} role={parse.ok ? "status" : "alert"}>
        {statusText}
      </p>

      {popular.data && popular.data.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500">常用：</span>
          {popular.data.map((tag) => (
            <button
              key={tag.name}
              type="button"
              onClick={() => applyInsertion(tag.name, true)}
              title={`插入标签 ${tag.name}（${formatCount(tag.count)} 条）`}
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
