/**
 * Lightweight Markdown tokenizer for the source-pane highlight layer.
 *
 * Emits HTML with token spans (`<span class="tok-*">`). Every character of
 * the source is HTML-escaped before spans are applied, so the output is safe
 * for `dangerouslySetInnerHTML`.
 *
 * Design goals: single pass, line-oriented with a fenced-code state machine,
 * inline tokens resolved with one regex alternation plus bounded recursion.
 * Fast enough to re-run on every keystroke even for a ~40k-char prompt.
 */

const MAX_DEPTH = 6;

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^(\s*)(`{3,}|~{3,})\s*$/;
const HEADING = /^(#{1,6})\s+(.+)$/;
const HR = /^(\s*)(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^(\s*)((?:>\s?)+)(.*)$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

const INLINE_TOKEN =
  /(?<code>`{1,3})(?<codeBody>[\s\S]*?)\k<code>|(?<si>\*\*\*|___)(?<siBody>[\s\S]*?)\k<si>|(?<bold>\*\*|__)(?<boldBody>[\s\S]*?)\k<bold>|(?<ital>\*|_)(?<italBody>[^*_`\n]+?)\k<ital>|(?<strike>~~)(?<strikeBody>[\s\S]*?)\k<strike>|!?\[(?<linkText>[^\]]*)\]\((?<linkUrl>[^)\s]*)(?:\s+["'][^"']*["'])?\)/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escapes regex metacharacters so user input is treated as a literal string. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Maps every index of a whitespace-collapsed string back to the index of the
 * original string it came from. `norm` must be `orig.replace(/\s+/g, " ")`.
 * For a position occupied by a collapsed space, returns the index of the first
 * whitespace character of the original run.
 */
function mapNormToOrig(norm: string, orig: string): number[] {
  const map: number[] = new Array(norm.length);
  let o = 0;
  for (let n = 0; n < norm.length; n++) {
    if (norm.charAt(n) === " ") {
      map[n] = o;
      while (o < orig.length && /\s/.test(orig.charAt(o))) o++;
    } else {
      while (o < orig.length && /\s/.test(orig.charAt(o))) o++;
      map[n] = o;
      o++;
    }
  }
  return map;
}

/** Collapses whitespace runs (including newlines) to single spaces. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * Finds case-insensitive matches of `query` in raw source text, returning
 * `{ start, end }` character offsets in the *original* text. Whitespace is
 * normalized on both sides (a query phrase matches across line breaks and
 * runs of spaces), mirroring browser-style find-in-page. Used by the
 * editor's find bar for match counting and navigation.
 */
export function findMatches(
  text: string,
  query: string,
): Array<{
  start: number;
  end: number;
}> {
  const normQuery = collapseWhitespace(query).trim();
  if (!normQuery) return [];
  let pattern: RegExp;
  try {
    pattern = new RegExp(escapeRegExp(normQuery), "gi");
  } catch {
    return [];
  }
  const normText = collapseWhitespace(text);
  const origAt = normText === text ? null : mapNormToOrig(normText, text);
  const matches: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normText)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    if (origAt) {
      const start = origAt[match.index] ?? match.index;
      const end = (origAt[match.index + match[0].length - 1] ?? start) + 1;
      matches.push({ start, end });
    } else {
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return matches;
}

/**
 * Wraps occurrences of `query` in `<mark class="find-hit">` (and the Nth,
 * `currentIndex`, in `find-current`) across the text runs of a tokenized HTML
 * string. Tags are left untouched, so matches never leak into attributes.
 * Whitespace is collapsed the same way as `findMatches`, so a phrase spanning
 * a line break in the source still highlights in the source pane.
 */
function applyFindMarks(
  html: string,
  query: string,
  currentIndex: number,
): string {
  const normQuery = collapseWhitespace(query).trim();
  if (!normQuery) return html;
  let pattern: RegExp;
  try {
    pattern = new RegExp(escapeHtml(escapeRegExp(normQuery)), "gi");
  } catch {
    return html;
  }
  const parts = html.split(/(<[^>]+>)/);
  let matchIndex = 0;
  return parts
    .map((part) => {
      if (part.startsWith("<")) return part;
      const normPart = collapseWhitespace(part);
      if (normPart === part) {
        return part.replace(pattern, (matched) => {
          const cls =
            matchIndex === currentIndex ? "find-hit find-current" : "find-hit";
          matchIndex += 1;
          return `<mark class="${cls}">${matched}</mark>`;
        });
      }
      // Collapsed whitespace shifts offsets, so map matches back to the
      // original (escaped) text before wrapping.
      const origAt = mapNormToOrig(normPart, part);
      const matches: Array<{ start: number; end: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(normPart)) !== null) {
        if (m[0].length === 0) {
          pattern.lastIndex += 1;
          continue;
        }
        matches.push({
          start: origAt[m.index] ?? m.index,
          end: (origAt[m.index + m[0].length - 1] ?? m.index) + 1,
        });
      }
      if (matches.length === 0) return part;
      let out = "";
      let last = 0;
      for (const match of matches) {
        out += part.slice(last, match.start);
        const cls =
          matchIndex === currentIndex ? "find-hit find-current" : "find-hit";
        matchIndex += 1;
        out += `<mark class="${cls}">${part.slice(match.start, match.end)}</mark>`;
        last = match.end;
      }
      return out + part.slice(last);
    })
    .join("");
}

function wrap(content: string, cls: string): string {
  return `<span class="${cls}">${content}</span>`;
}

function tokenizeInline(text: string, depth: number): string {
  const escaped = escapeHtml(text);
  if (depth >= MAX_DEPTH) return escaped;

  return escaped.replace(INLINE_TOKEN, (...args: unknown[]) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>;

    if (groups.code !== undefined && groups.codeBody !== undefined) {
      return wrap(`${groups.code}${groups.codeBody}${groups.code}`, "tok-code");
    }

    if (groups.si !== undefined && groups.siBody !== undefined) {
      const inner = tokenizeInline(groups.siBody, depth + 1);
      return wrap(`${groups.si}${inner}${groups.si}`, "tok-bold tok-italic");
    }

    if (groups.bold !== undefined && groups.boldBody !== undefined) {
      const inner = tokenizeInline(groups.boldBody, depth + 1);
      return wrap(`${groups.bold}${inner}${groups.bold}`, "tok-bold");
    }

    if (groups.ital !== undefined && groups.italBody !== undefined) {
      return wrap(
        `${groups.ital}${groups.italBody}${groups.ital}`,
        "tok-italic",
      );
    }

    if (groups.strike !== undefined && groups.strikeBody !== undefined) {
      return wrap(
        `${groups.strike}${groups.strikeBody}${groups.strike}`,
        "tok-strike",
      );
    }

    if (groups.linkText !== undefined && groups.linkUrl !== undefined) {
      const label = tokenizeInline(groups.linkText, depth + 1);
      return `${wrap(`[${label}]`, "tok-link")}${wrap(
        `(${groups.linkUrl})`,
        "tok-link-url",
      )}`;
    }

    return "";
  });
}

/**
 * Highlights a Markdown document, returning escaped HTML with token spans.
 * A trailing newline is appended so the caret's last line has a rendered
 * row in the highlight layer. When `findQuery` is non-empty, matches are
 * wrapped in `.find-hit` marks (the `currentIndex`-th one also gets
 * `.find-current`).
 */
export function highlightMarkdown(
  source: string,
  findQuery = "",
  currentIndex = -1,
): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;

  for (const line of lines) {
    if (fence) {
      const close = line.match(FENCE_CLOSE);
      if (
        close &&
        close[2] &&
        close[2][0] === fence.char &&
        close[2].length >= fence.len
      ) {
        fence = null;
        out.push(wrap(escapeHtml(line), "tok-fence"));
      } else {
        out.push(wrap(escapeHtml(line), "tok-code"));
      }
      continue;
    }

    const open = line.match(FENCE_OPEN);
    if (open && open[2]) {
      fence = { char: open[2][0] ?? "", len: open[2].length };
      out.push(wrap(escapeHtml(line), "tok-fence"));
      continue;
    }

    const heading = line.match(HEADING);
    if (heading && heading[1] && heading[2]) {
      out.push(
        `${wrap(escapeHtml(heading[1]), "tok-heading-mark")} ${wrap(
          tokenizeInline(heading[2], 0),
          "tok-heading",
        )}`,
      );
      continue;
    }

    if (HR.test(line)) {
      out.push(wrap(escapeHtml(line), "tok-hr"));
      continue;
    }

    if (TABLE_SEP.test(line)) {
      out.push(wrap(escapeHtml(line), "tok-table"));
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote && quote[2]) {
      out.push(
        `${escapeHtml(quote[1] ?? "")}${wrap(
          escapeHtml(quote[2]),
          "tok-quote-mark",
        )}${tokenizeInline(quote[3] ?? "", 0)}`,
      );
      continue;
    }

    const list = line.match(LIST);
    if (list && list[2]) {
      out.push(
        `${escapeHtml(list[1] ?? "")}${wrap(
          escapeHtml(list[2]),
          "tok-list",
        )} ${tokenizeInline(list[3] ?? "", 0)}`,
      );
      continue;
    }

    out.push(tokenizeInline(line, 0));
  }

  const joined = out.join("\n");
  // Match the textarea's trailing caret line without adding a stray empty
  // line when the source already ends in a newline.
  const withTrailing = joined.endsWith("\n") ? joined : joined + "\n";
  return applyFindMarks(withTrailing, findQuery, currentIndex);
}
