/**
 * 标签 DSL 解析器（纯函数，无 IO）。
 *
 * 词法 / 语法严格按 `docs/architecture.md` §5.1 / §5.2：
 *   expr    := or
 *   or      := and ( "|" and )*
 *   and     := unary ( "&" unary )*
 *   unary   := ("!" | "~") unary | primary
 *   primary := "(" expr ")" | tag
 *   tag     := quotedTag | bareTag
 *
 * 优先级：`|` < `&` < `!` / `~`。空白（含 U+3000）只作分隔符。
 * 空字符串 / 纯空白 → `{ kind: "all" }`（不限制）。
 */

export type TagExpr =
  | { kind: "all" }
  | { kind: "tag"; name: string }
  | { kind: "not"; expr: TagExpr }
  | { kind: "and"; left: TagExpr; right: TagExpr }
  | { kind: "or"; left: TagExpr; right: TagExpr };

export interface ParseSuccess {
  ok: true;
  ast: TagExpr;
  /** 表达式中出现的标签（按首次出现顺序去重，保留用户原始写法/引号内解码后的写法）。 */
  tags: string[];
}

export interface ParseFailure {
  ok: false;
  /** 中文可读错误信息（不含位置，位置单独给出）。 */
  message: string;
  /** 0 基字符下标；前端展示时 +1。 */
  position: number;
}

export type ParseResult = ParseSuccess | ParseFailure;

type TokenType = "tag" | "and" | "or" | "not" | "lparen" | "rparen";

interface Token {
  type: TokenType;
  /** 0 基字符下标。 */
  pos: number;
  /** 运算符源码（`!` / `~` / `&` / `|` / `(` / `)`）或标签原文。 */
  text: string;
  /** 仅 tag：标签名（引号内已解码转义）。 */
  name?: string;
}

/** 词法 / 语法错误内部载体。 */
class DslError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = "DslError";
  }
}

const WHITESPACE = /\s/; // JS \s 覆盖 U+3000（全角空格）
const OPERATOR_TYPES: Record<string, TokenType | undefined> = {
  "&": "and",
  "|": "or",
  "!": "not",
  "~": "not",
  "(": "lparen",
  ")": "rparen",
};
const BARE_TERMINATORS = new Set(["&", "|", "!", "~", "(", ")", '"']);

/** 引号标签：`\"` → `"`、`\\` → `\`，其它 `\x` → `x`。 */
function readQuoted(source: string, start: number): { name: string; next: number } {
  let index = start + 1;
  let name = "";
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\\") {
      const escaped = source[index + 1];
      if (escaped === undefined) {
        index = source.length;
        break;
      }
      name += escaped;
      index += 2;
      continue;
    }
    if (char === '"') {
      return { name, next: index + 1 };
    }
    name += char;
    index += 1;
  }
  throw new DslError("引号未闭合", start);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (WHITESPACE.test(char)) {
      index += 1;
      continue;
    }
    const operator = OPERATOR_TYPES[char];
    if (operator) {
      tokens.push({ type: operator, pos: index, text: char });
      index += 1;
      continue;
    }
    if (char === '"') {
      const quoted = readQuoted(source, index);
      tokens.push({ type: "tag", pos: index, text: quoted.name, name: quoted.name });
      index = quoted.next;
      continue;
    }
    const start = index;
    while (index < source.length) {
      const current = source[index]!;
      if (WHITESPACE.test(current) || BARE_TERMINATORS.has(current)) break;
      index += 1;
    }
    if (index === start) {
      // 理论上不可达（上面已覆盖所有终止字符），保留兜底。
      throw new DslError(`无法识别的字符 "${char}"`, start);
    }
    const text = source.slice(start, index);
    tokens.push({ type: "tag", pos: start, text, name: text });
  }
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly sourceLength: number,
  ) {}

  parse(): TagExpr {
    if (this.tokens.length === 0) return { kind: "all" };
    const ast = this.parseOr();
    const rest = this.peek();
    if (rest) {
      if (rest.type === "rparen") {
        throw new DslError('无法识别的字符 ")"（缺少匹配的左括号）', rest.pos);
      }
      if (rest.type === "and" || rest.type === "or") {
        throw new DslError(`运算符 "${rest.text}" 缺少操作数`, rest.pos);
      }
      throw new DslError('缺少运算符（"&" 或 "|"）', rest.pos);
    }
    return ast;
  }

  private parseOr(): TagExpr {
    let left = this.parseAnd();
    while (this.peek()?.type === "or") {
      const operator = this.advance();
      this.assertOperand(operator);
      const right = this.parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  private parseAnd(): TagExpr {
    let left = this.parseUnary();
    while (this.peek()?.type === "and") {
      const operator = this.advance();
      this.assertOperand(operator);
      const right = this.parseUnary();
      left = { kind: "and", left, right };
    }
    return left;
  }

  private parseUnary(): TagExpr {
    const token = this.peek();
    if (token?.type === "not") {
      const operator = this.advance();
      this.assertOperand(operator);
      return { kind: "not", expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): TagExpr {
    const token = this.peek();
    if (!token) {
      throw new DslError("表达式不完整：缺少标签", this.sourceLength);
    }
    switch (token.type) {
      case "tag":
        this.advance();
        return { kind: "tag", name: token.name ?? "" };
      case "lparen": {
        const open = this.advance();
        const next = this.peek();
        if (next?.type === "rparen") {
          throw new DslError("括号内缺少标签或表达式", next.pos);
        }
        const expr = this.parseOr();
        const close = this.peek();
        if (!close) {
          throw new DslError('缺少右括号 ")"', open.pos);
        }
        if (close.type !== "rparen") {
          if (close.type === "and" || close.type === "or") {
            throw new DslError(`运算符 "${close.text}" 缺少操作数`, close.pos);
          }
          throw new DslError('缺少运算符（"&" 或 "|"）', close.pos);
        }
        this.advance();
        return expr;
      }
      case "rparen":
        throw new DslError('无法识别的字符 ")"（缺少匹配的左括号）', token.pos);
      default:
        throw new DslError(`运算符 "${token.text}" 缺少操作数`, token.pos);
    }
  }

  /** 二元/一元运算符之后的操作数校验，让错误定位到运算符本身。 */
  private assertOperand(operator: Token): void {
    const next = this.peek();
    if (!next || next.type === "rparen" || next.type === "and" || next.type === "or") {
      throw new DslError(`运算符 "${operator.text}" 缺少操作数`, operator.pos);
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private advance(): Token {
    const token = this.tokens[this.index];
    if (!token) {
      throw new DslError("表达式不完整", this.sourceLength);
    }
    this.index += 1;
    return token;
  }
}

function collectTags(ast: TagExpr): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const walk = (node: TagExpr): void => {
    switch (node.kind) {
      case "tag": {
        const key = node.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          tags.push(node.name);
        }
        break;
      }
      case "not":
        walk(node.expr);
        break;
      case "and":
      case "or":
        walk(node.left);
        walk(node.right);
        break;
      case "all":
        break;
    }
  };
  walk(ast);
  return tags;
}

/**
 * 解析标签表达式。
 *
 * @param input 用户输入的表达式（长度上限由 zod 契约保证，≤500）。
 * @returns 成功时 `{ ok: true, ast, tags }`；失败时 `{ ok: false, message, position }`。
 */
export function parseTagExpr(input: string): ParseResult {
  const source = input ?? "";
  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch (error) {
    if (error instanceof DslError) {
      return { ok: false, message: error.message, position: error.position };
    }
    throw error;
  }
  try {
    const ast = new Parser(tokens, source.length).parse();
    return { ok: true, ast, tags: collectTags(ast) };
  } catch (error) {
    if (error instanceof DslError) {
      return { ok: false, message: error.message, position: error.position };
    }
    throw error;
  }
}
