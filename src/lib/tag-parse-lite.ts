/**
 * 前端轻量标签表达式校验器。
 *
 * 与 `src/server/tag-dsl/parser.ts` 语法同构（独立的第二份实现，只做校验与标签名提取，
 * 不做 AST 求值/编译）。错误 message 与 position（0 基字符下标）供 UI 直接展示。
 */

export interface TagParseResult {
  ok: boolean;
  message?: string;
  position?: number;
  /** 表达式中出现的标签原文（大小写不敏感去重，保留首次写法）。 */
  tags: string[];
}

export interface TagFragment {
  start: number;
  end: number;
  text: string;
}

type TokenKind = "tag" | "and" | "or" | "not" | "lparen" | "rparen";

interface Token {
  kind: TokenKind;
  value: string;
  position: number;
}

interface LexError {
  message: string;
  position: number;
}

const DELIMITER_CHARS = new Set(["&", "|", "(", ")", "!", "~", '"']);

function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

function isDelimiter(char: string): boolean {
  return isWhitespace(char) || DELIMITER_CHARS.has(char);
}

/** 词法分析；遇到未闭合引号时返回已完成 token + error（合法表达式 error 为 undefined）。 */
function lex(input: string): { tokens: Token[]; error?: LexError } {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index]!;

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === "&" || char === "|" || char === "(" || char === ")" || char === "!" || char === "~") {
      const kind: TokenKind =
        char === "&"
          ? "and"
          : char === "|"
            ? "or"
            : char === "("
              ? "lparen"
              : char === ")"
                ? "rparen"
                : "not";
      tokens.push({ kind, value: char, position: index });
      index += 1;
      continue;
    }

    if (char === '"') {
      const start = index;
      index += 1;
      let value = "";
      let closed = false;
      while (index < input.length) {
        const current = input[index]!;
        if (current === "\\") {
          const escaped = input[index + 1];
          if (escaped === undefined) {
            index += 1;
            break;
          }
          value += escaped;
          index += 2;
          continue;
        }
        if (current === '"') {
          closed = true;
          index += 1;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) {
        return { tokens, error: { message: "引号未闭合", position: start } };
      }
      tokens.push({ kind: "tag", value, position: start });
      continue;
    }

    const start = index;
    let value = "";
    while (index < input.length) {
      const current = input[index]!;
      if (isDelimiter(current)) break;
      value += current;
      index += 1;
    }
    tokens.push({ kind: "tag", value, position: start });
  }

  return { tokens };
}

class ParseError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = "ParseError";
    this.position = position;
  }
}

function parseTokens(input: string, tokens: Token[]): TagParseResult {
  let index = 0;
  const tags: string[] = [];
  const seen = new Set<string>();

  const peek = (): Token | undefined => tokens[index];

  const addTag = (name: string): void => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(name);
  };

  /** 与服务器 parser 一致：二元/一元运算符后缺操作数时，位置指向运算符本身。 */
  const assertOperand = (operator: Token): void => {
    const next = peek();
    if (!next || next.kind === "rparen" || next.kind === "and" || next.kind === "or") {
      throw new ParseError(`运算符 "${operator.value}" 缺少操作数`, operator.position);
    }
  };

  const parsePrimary = (): void => {
    const token = peek();
    if (!token) {
      throw new ParseError("表达式不完整：缺少标签", input.length);
    }
    if (token.kind === "tag") {
      index += 1;
      addTag(token.value);
      return;
    }
    if (token.kind === "lparen") {
      const open = token;
      index += 1;
      const next = peek();
      if (next?.kind === "rparen") {
        throw new ParseError("括号内缺少标签或表达式", next.position);
      }
      parseOr();
      const closing = peek();
      if (!closing) {
        throw new ParseError('缺少右括号 ")"', open.position);
      }
      if (closing.kind !== "rparen") {
        if (closing.kind === "and" || closing.kind === "or") {
          throw new ParseError(`运算符 "${closing.value}" 缺少操作数`, closing.position);
        }
        throw new ParseError('缺少运算符（"&" 或 "|"）', closing.position);
      }
      index += 1;
      return;
    }
    if (token.kind === "rparen") {
      throw new ParseError('无法识别的字符 ")"（缺少匹配的左括号）', token.position);
    }
    throw new ParseError(`运算符 "${token.value}" 缺少操作数`, token.position);
  };

  const parseUnary = (): void => {
    const token = peek();
    if (token?.kind === "not") {
      index += 1;
      assertOperand(token);
      parseUnary();
      return;
    }
    parsePrimary();
  };

  const parseAnd = (): void => {
    parseUnary();
    while (peek()?.kind === "and") {
      const operator = tokens[index]!;
      index += 1;
      assertOperand(operator);
      parseUnary();
    }
  };

  const parseOr = (): void => {
    parseAnd();
    while (peek()?.kind === "or") {
      const operator = tokens[index]!;
      index += 1;
      assertOperand(operator);
      parseAnd();
    }
  };

  try {
    if (tokens.length === 0) return { ok: true, tags };
    parseOr();
    const trailing = peek();
    if (trailing) {
      if (trailing.kind === "rparen") {
        throw new ParseError('无法识别的字符 ")"（缺少匹配的左括号）', trailing.position);
      }
      if (trailing.kind === "and" || trailing.kind === "or") {
        throw new ParseError(`运算符 "${trailing.value}" 缺少操作数`, trailing.position);
      }
      throw new ParseError('缺少运算符（"&" 或 "|"）', trailing.position);
    }
    return { ok: true, tags };
  } catch (error) {
    if (error instanceof ParseError) {
      return { ok: false, message: error.message, position: error.position, tags };
    }
    throw error;
  }
}

/** 校验表达式并返回涉及的标签（去重）。空表达式合法且无标签。 */
export function parseTagExpr(input: string): TagParseResult {
  const { tokens, error } = lex(input);
  if (error) return { ok: false, message: error.message, position: error.position, tags: [] };
  return parseTokens(input, tokens);
}

/** 容错提取标签名（即使表达式有语法错误也尽量提取），用于「去重插入」判断。 */
export function extractTagNames(input: string): string[] {
  const { tokens } = lex(input);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "tag") continue;
    const key = token.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(token.value);
  }
  return names;
}

/** 光标是否位于一个未闭合的引号标签内部。 */
function isInsideQuotedTag(input: string, cursor: number): boolean {
  let inQuote = false;
  for (let index = 0; index < cursor; index += 1) {
    const char = input[index]!;
    if (inQuote && char === "\\") {
      index += 1;
      continue;
    }
    if (char === '"') inQuote = !inQuote;
  }
  return inQuote;
}

/**
 * 取光标所在的裸标签片段（用于输入联想）。
 * 位于引号标签内、空白/运算符处、或片段为空时返回 null。
 */
export function getBareTagFragment(input: string, cursor: number): TagFragment | null {
  const position = Math.max(0, Math.min(cursor, input.length));
  if (isInsideQuotedTag(input, position)) return null;

  let start = position;
  while (start > 0) {
    const previous = input[start - 1]!;
    if (isDelimiter(previous)) break;
    start -= 1;
  }

  let end = position;
  while (end < input.length) {
    const current = input[end]!;
    if (isDelimiter(current)) break;
    end += 1;
  }

  if (start === end) return null;
  return { start, end, text: input.slice(start, end) };
}
