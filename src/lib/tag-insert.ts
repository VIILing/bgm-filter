import { extractTagNames } from "./tag-parse-lite";

export interface InsertTagResult {
  expr: string;
  /** 插入后光标应处的位置（0 基）。 */
  cursor: number;
}

const OPERATOR_CHARS = new Set(["&", "|", "(", ")", "!", "~"]);
const NEEDS_QUOTE = /[\s&|()!~"]/u;
const NO_SUFFIX_CHARS = new Set(["&", "|", ")", "!", "~", "("]);

/** 按 DSL 规则给标签名加引号并转义 `\` 与 `"`。 */
export function formatTagForExpr(tag: string): string {
  if (!NEEDS_QUOTE.test(tag)) return tag;
  const escaped = tag.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function lastNonWhitespaceIndex(value: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (!/\s/u.test(value[index]!)) return index;
  }
  return -1;
}

/**
 * 把标签插入表达式光标处（ui-design.md §2.2）：
 * - 前一个非空白字符不是运算符/左括号且表达式非空时自动补 ` & `；
 * - 标签名含空白或 `& | ( ) ! ~ "` 时加双引号并转义；
 * - 表达式内已有同名标签（大小写不敏感）时不重复插入；
 * - 返回新表达式与新光标位置。
 */
export function insertTag(expr: string, cursor: number, tag: string): InsertTagResult {
  const position = Math.max(0, Math.min(Number.isFinite(cursor) ? Math.trunc(cursor) : expr.length, expr.length));
  if (!tag) return { expr, cursor: position };

  const existing = extractTagNames(expr);
  const exists = existing.some((name) => name.toLowerCase() === tag.toLowerCase());
  if (exists) return { expr, cursor: position };

  const formatted = formatTagForExpr(tag);
  const beforeRaw = expr.slice(0, position);
  const after = expr.slice(position);

  let before = beforeRaw;
  let prefix = "";
  const previousIndex = lastNonWhitespaceIndex(beforeRaw);
  if (previousIndex >= 0) {
    const previous = beforeRaw[previousIndex]!;
    if (!OPERATOR_CHARS.has(previous)) {
      prefix = " & ";
      // 去掉光标前多余的空白，避免出现 "科幻  & 动画"。
      before = beforeRaw.slice(0, previousIndex + 1);
    }
  }

  let suffix = "";
  const next = after[0];
  if (next !== undefined && !/\s/u.test(next) && !NO_SUFFIX_CHARS.has(next)) {
    suffix = " ";
  }

  const nextExpr = `${before}${prefix}${formatted}${suffix}${after}`;
  const nextCursor = before.length + prefix.length + formatted.length;
  return { expr: nextExpr, cursor: nextCursor };
}
