// One pass from left to right, so a quote inside a comment, or `--` inside a string, stays part of
// the span that holds it. An unclosed string stays in place, and its words still count.
const quotedOrCommentPattern =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/gu;

// The SQL with each string, quoted name and comment replaced by a space, so a search for a keyword
// finds only the words SQLite runs.
export function toBareSQL(sql: string): string {
  return sql.replaceAll(quotedOrCommentPattern, ' ');
}
