/**
 * A small SQL statement splitter for migration analysis (R3, ADR-0071).
 *
 * The migration-replay suite asks one question of the newest migration: does it change privileges? The
 * first answer was a regular expression over the whole file, which matched the word "grant" in a comment
 * (0022: "the quarantine table keeps every other constraint and grant"). Stripping comments with two more
 * regular expressions still misreads SQL: `--` inside a string literal, a nested block comment, a
 * dollar-quoted body or a string that merely mentions GRANT. This module lexes the source instead, so a
 * keyword counts only where PostgreSQL would execute it:
 *
 *   - top-level statements split on `;` outside quotes, dollar quotes and comments;
 *   - comments (`--`, nested block comments) are dropped;
 *   - single-quoted strings (with `''`), `E'…'` strings (with backslash escapes), double-quoted
 *     identifiers and `$tag$…$tag$` bodies are opaque to the keyword scan;
 *   - a `DO` block runs at migration time, so its body is lexed as a statement list too, and a string
 *     handed to `EXECUTE` (directly or through `format(…)`) counts by its own leading keyword.
 *
 * It is not a full SQL parser and does not need to be: it reads the leading keywords of statements, which
 * is exactly what "is this a GRANT" depends on.
 */

export interface SqlStatement {
  /** The statement's source text, comments included, without the terminating `;`. */
  readonly text: string;
  /** Leading keywords outside strings and comments, upper-cased (`['ALTER','DEFAULT','PRIVILEGES']`). */
  readonly keywords: readonly string[];
  /** Every word of the statement outside strings, identifiers-in-quotes and comments, upper-cased. */
  readonly words: readonly string[];
  /** Bodies of dollar-quoted strings, in order (a `DO` block's code, a function body). */
  readonly dollarBodies: readonly string[];
  /** Contents of single-quoted string literals, in order, unescaped. */
  readonly strings: readonly string[];
}

const WORD = /[A-Za-z_][A-Za-z0-9_$]*/g;
const DOLLAR_TAG = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;

interface Accumulator {
  text: string;
  code: string;
  dollarBodies: string[];
  strings: string[];
}

function fresh(): Accumulator {
  return { text: '', code: '', dollarBodies: [], strings: [] };
}

/** Split SQL source into top-level statements. Empty statements (only comments/space) are dropped. */
export function splitSqlStatements(sql: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  let acc = fresh();
  const flush = (): void => {
    const words = (acc.code.match(WORD) ?? []).map((w) => w.toUpperCase());
    if (words.length > 0)
      out.push({
        text: acc.text.trim(),
        keywords: words.slice(0, 4),
        words,
        dollarBodies: acc.dollarBodies,
        strings: acc.strings,
      });
    acc = fresh();
  };

  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql.charAt(i);
    const next = sql[i + 1];

    // Line comment.
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      acc.text += sql.slice(i, stop);
      acc.code += ' ';
      i = stop;
      continue;
    }
    // Block comment; PostgreSQL nests them.
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else j += 1;
      }
      acc.text += sql.slice(i, j);
      acc.code += ' ';
      i = j;
      continue;
    }
    // E'…' string with backslash escapes; only when E is not the tail of an identifier.
    if ((ch === 'E' || ch === 'e') && next === "'" && !isIdentChar(sql[i - 1])) {
      const { end, value } = readQuoted(sql, i + 1, true);
      acc.text += sql.slice(i, end);
      acc.code += " '' ";
      acc.strings.push(value);
      i = end;
      continue;
    }
    if (ch === "'") {
      const { end, value } = readQuoted(sql, i, false);
      acc.text += sql.slice(i, end);
      acc.code += " '' ";
      acc.strings.push(value);
      i = end;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') j += 2;
          else break;
        } else j += 1;
      }
      const end = Math.min(n, j + 1);
      acc.text += sql.slice(i, end);
      acc.code += ' "" ';
      i = end;
      continue;
    }
    if (ch === '$' && !isIdentChar(sql[i - 1])) {
      DOLLAR_TAG.lastIndex = i;
      const m = DOLLAR_TAG.exec(sql);
      if (m) {
        const tag = m[0];
        const bodyStart = i + tag.length;
        const close = sql.indexOf(tag, bodyStart);
        const bodyEnd = close === -1 ? n : close;
        const end = close === -1 ? n : close + tag.length;
        acc.text += sql.slice(i, end);
        acc.code += ' $$ ';
        acc.dollarBodies.push(sql.slice(bodyStart, bodyEnd));
        i = end;
        continue;
      }
    }
    if (ch === ';') {
      flush();
      i += 1;
      continue;
    }
    acc.text += ch;
    acc.code += ch;
    i += 1;
  }
  flush();
  return out;
}

function isIdentChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

function readQuoted(
  sql: string,
  start: number,
  backslashEscapes: boolean,
): { end: number; value: string } {
  let j = start + 1;
  let value = '';
  while (j < sql.length) {
    const c = sql.charAt(j);
    if (backslashEscapes && c === '\\' && j + 1 < sql.length) {
      value += sql.charAt(j + 1);
      j += 2;
      continue;
    }
    if (c === "'") {
      if (sql[j + 1] === "'") {
        value += "'";
        j += 2;
        continue;
      }
      return { end: j + 1, value };
    }
    value += c;
    j += 1;
  }
  return { end: sql.length, value };
}

function leadsWithPrivilegeKeyword(keywords: readonly string[]): boolean {
  const [a, b, c] = keywords;
  if (a === 'GRANT' || a === 'REVOKE') return true;
  return a === 'ALTER' && b === 'DEFAULT' && c === 'PRIVILEGES';
}

/** True when a dynamic-SQL string is itself a privilege statement (`'GRANT SELECT ON %I TO …'`). */
function stringIsPrivilegeStatement(s: string): boolean {
  return splitSqlStatements(s).some((st) => leadsWithPrivilegeKeyword(st.keywords));
}

/** PL/pgSQL block words that precede a statement inside a `DO` body (`BEGIN GRANT …`, `LOOP EXECUTE …`). */
const BLOCK_PREFIX = new Set(['BEGIN', 'LOOP', 'THEN', 'ELSE', 'DECLARE']);

function bodyExecutesPrivilegeStatement(body: string): boolean {
  return splitSqlStatements(body).some((inner) => {
    let k = 0;
    while (k < inner.words.length && BLOCK_PREFIX.has(inner.words[k] ?? '')) k += 1;
    if (leadsWithPrivilegeKeyword(inner.words.slice(k, k + 3))) return true;
    return inner.words.includes('EXECUTE') && inner.strings.some(stringIsPrivilegeStatement);
  });
}

/**
 * Whether a statement changes privileges when the migration runs: a GRANT, a REVOKE, an
 * `ALTER DEFAULT PRIVILEGES`, or a `DO` block that executes one (as a statement of its body or as a string
 * passed to `EXECUTE`). `CREATE FUNCTION` does not run its body, so a function body does not count.
 */
export function isPrivilegeStatement(stmt: SqlStatement): boolean {
  if (leadsWithPrivilegeKeyword(stmt.keywords)) return true;
  if (stmt.keywords[0] !== 'DO') return false;
  return stmt.dollarBodies.some(bodyExecutesPrivilegeStatement);
}

/** Whether any statement of a migration changes privileges at migration time. */
export function migrationChangesPrivileges(sql: string): boolean {
  return splitSqlStatements(sql).some(isPrivilegeStatement);
}
