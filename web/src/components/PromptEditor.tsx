import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { getCases, getPrompt, savePrompt, ApiError } from "../api";
import type { RegressionCase } from "../types";
import { renderMarkdown } from "../markdown";
import { escapeRegExp, findMatches, highlightMarkdown } from "../highlight";

type Mode = "split" | "preview";

interface Draft {
  content: string;
  savedAt: string;
}

interface FindState {
  query: string;
  index: number;
}

const DRAFT_KEY = "prompt-editor.draft.v1";
const AUTOSAVE_DELAY_MS = 500;

interface OutlineItem {
  depth: number;
  text: string;
  line: number;
}

function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

export default function PromptEditor() {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<Mode>("split");
  const [dirty, setDirty] = useState(false);
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [cases, setCases] = useState<RegressionCase[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [draftBanner, setDraftBanner] = useState<Draft | null>(null);

  const areaRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const hlContentRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<HTMLElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const syncing = useRef(false);
  const loadedRef = useRef<string | null>(null);
  const contentRef = useRef(content);
  const dirtyRef = useRef(dirty);
  const navPendingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [promptResult, casesResult] = await Promise.all([
        getPrompt(),
        getCases(),
      ]);
      loadedRef.current = promptResult.content;
      setContent(promptResult.content);
      setCases(casesResult.cases);
      setDirty(false);
      setArmed(false);
      setMessage(null);
      setLoaded(true);
      setCursor({ line: 1, col: 1 });
      restoreDraftBanner(promptResult.content);
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  /** If a stored draft differs from the server copy, offer to restore it. */
  const restoreDraftBanner = (serverContent: string): void => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) {
        setDraftBanner(null);
        return;
      }
      const draft = JSON.parse(raw) as Draft;
      if (draft.content && draft.content !== serverContent) {
        setDraftBanner(draft);
      } else {
        localStorage.removeItem(DRAFT_KEY);
        setDraftBanner(null);
      }
    } catch {
      localStorage.removeItem(DRAFT_KEY);
      setDraftBanner(null);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep refs in sync for the unmount flush.
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Debounced autosave to localStorage while the document is dirty.
  useEffect(() => {
    if (!dirty || content === loadedRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ content, savedAt: new Date().toISOString() }),
        );
      } catch {
        /* storage unavailable */
      }
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [content, dirty]);

  // Flush any unsaved changes if the component unmounts mid-edit.
  useEffect(() => {
    return () => {
      const current = contentRef.current;
      if (dirtyRef.current && current !== loadedRef.current) {
        try {
          localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify({
              content: current,
              savedAt: new Date().toISOString(),
            }),
          );
        } catch {
          /* storage unavailable */
        }
      }
    };
  }, []);

  // Keep the highlight layer's right padding in step with the textarea
  // scrollbar so wrapped lines stay aligned.
  useEffect(() => {
    const area = areaRef.current;
    const contentEl = hlContentRef.current;
    if (!area || !contentEl || mode !== "split") return;
    const update = (): void => {
      const scrollbar = area.offsetWidth - area.clientWidth;
      contentEl.style.paddingRight =
        scrollbar > 0 ? `calc(1.1rem + ${scrollbar}px)` : "";
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(area);
    return () => observer.disconnect();
  }, [mode, loaded]);

  const [find, setFind] = useState<FindState | null>(null);

  const previewHtml = useMemo(() => renderMarkdown(content), [content]);
  const findQuery = find?.query ?? "";
  const matches = useMemo(
    () => findMatches(content, findQuery),
    [content, findQuery],
  );
  const currentIndex =
    find && matches.length > 0 ? Math.min(find.index, matches.length - 1) : -1;
  const highlightedHtml = useMemo(
    () => highlightMarkdown(content, findQuery, currentIndex),
    [content, findQuery, currentIndex],
  );
  const charCount = content.length;
  const wordCount = useMemo(() => countWords(content), [content]);
  const lineCount = content.length === 0 ? 1 : content.split("\n").length;

  const outline = useMemo<OutlineItem[]>(() => {
    const items: OutlineItem[] = [];
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const match = lines[index]?.match(/^(#{1,4})\s+(.+)$/);
      if (match) {
        const depth = match[1]?.length ?? 0;
        const text = match[2]?.trim() ?? "";
        if (depth > 0 && text) {
          items.push({ depth, text, line: index });
        }
      }
    }
    return items;
  }, [content]);

  /** Outline entry nearest above the caret. */
  const activeOutlineIndex = useMemo(() => {
    let active = -1;
    for (let i = 0; i < outline.length; i++) {
      if ((outline[i]?.line ?? 0) <= cursor.line - 1) active = i;
      else break;
    }
    return active;
  }, [outline, cursor.line]);

  // Keep the active heading in view inside the outline rail.
  useEffect(() => {
    const container = outlineRef.current;
    if (!container || activeOutlineIndex < 0) return;
    const el = container.querySelector(
      `[data-outline-index="${activeOutlineIndex}"]`,
    );
    if (!el) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
      container.scrollTop += eRect.top - cRect.top - container.clientHeight / 2;
    }
  }, [activeOutlineIndex]);

  // Render the preview innerHTML imperatively so React never re-reconciles
  // it (a re-render would wipe the find marks injected below). This effect
  // must be declared before the find-marks effect.
  useEffect(() => {
    const preview = previewRef.current;
    if (preview) preview.innerHTML = previewHtml;
  }, [previewHtml]);

  // Highlight find matches in the rendered preview pane. The preview text is
  // walked as a “virtual string” where <br> counts as a space, so phrases that
  // marked split across soft-wrapped lines still match; matches are mapped
  // back to their text nodes and wrapped in <mark>.
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    for (const el of Array.from(preview.querySelectorAll(".find-hit"))) {
      el.replaceWith(document.createTextNode(el.textContent ?? ""));
    }
    if (!findQuery || matches.length === 0) return;

    interface VirtualSeg {
      node: Text;
      start: number;
      end: number;
    }

    const accept = (node: Node): number => {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as Element).tagName === "BR"
      ) {
        return NodeFilter.FILTER_ACCEPT;
      }
      // SKIP (not REJECT) other elements so their child subtrees — the actual
      // text inside <p>, <strong>, <li>, … — are still visited. REJECT would
      // prune whole subtrees and leave only inter-block whitespace visible.
      return NodeFilter.FILTER_SKIP;
    };

    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_ALL, {
      acceptNode: accept,
    });
    const segments: VirtualSeg[] = [];
    let virtual = "";
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node as Text).nodeValue ?? "";
        if (!text) continue;
        segments.push({
          node: node as Text,
          start: virtual.length,
          end: virtual.length + text.length,
        });
        virtual += text;
      } else {
        virtual += " ";
      }
    }

    // Collapse whitespace in the query so it matches the virtual string
    // (where <br> counts as a single space) the same way the source pane and
    // counter do.
    const normQuery = findQuery.replace(/\s+/g, " ").trim();
    const pattern = new RegExp(escapeRegExp(normQuery), "gi");
    const matchAll = Array.from(virtual.matchAll(pattern));
    if (matchAll.length === 0) return;

    // Map each match to (node, local range) pairs so a match spanning several
    // nodes is marked piecewise.
    const perNode = new Map<
      Text,
      Array<{ start: number; end: number; current: boolean }>
    >();
    matchAll.forEach((m, matchIndex) => {
      const mStart = m.index ?? 0;
      const mEnd = mStart + m[0].length;
      for (const seg of segments) {
        if (seg.end > mStart && seg.start < mEnd) {
          const localStart = Math.max(mStart, seg.start) - seg.start;
          const localEnd = Math.min(mEnd, seg.end) - seg.start;
          const list = perNode.get(seg.node) ?? [];
          list.push({
            start: localStart,
            end: localEnd,
            current: matchIndex === currentIndex,
          });
          perNode.set(seg.node, list);
        }
      }
    });

    for (const [node, ranges] of perNode) {
      const text = node.nodeValue ?? "";
      const fragment = document.createDocumentFragment();
      let last = 0;
      for (const range of ranges) {
        if (range.start > last) {
          fragment.appendChild(
            document.createTextNode(text.slice(last, range.start)),
          );
        }
        const mark = document.createElement("mark");
        mark.className = range.current ? "find-hit find-current" : "find-hit";
        mark.textContent = text.slice(range.start, range.end);
        fragment.appendChild(mark);
        last = range.end;
      }
      if (last < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(last)));
      }
      node.replaceWith(fragment);
    }

    // After a next/prev action, bring the current match into view in both
    // panes without stealing focus from the find input.
    if (navPendingRef.current) {
      navPendingRef.current = false;
      const area = areaRef.current;
      const match = matches[currentIndex];
      if (area && match) {
        area.focus();
        area.setSelectionRange(match.start, match.end);
        updateCursor();
        findInputRef.current?.focus();
      }
      const current = preview.querySelector(".find-hit.find-current");
      if (current) {
        const previewRect = preview.getBoundingClientRect();
        const currentRect = current.getBoundingClientRect();
        preview.scrollTo({
          top:
            preview.scrollTop +
            (currentRect.top - previewRect.top) -
            preview.clientHeight / 2,
          behavior: "smooth",
        });
      }
    }
  }, [previewHtml, findQuery, currentIndex, matches]);

  const markDirty = (next: string): void => {
    setContent(next);
    setDirty(true);
    setArmed(false);
  };

  /* ---- text manipulation helpers ---- */

  const wrapSelection = (prefix: string, suffix = prefix): void => {
    const el = areaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;
    const selected = value.slice(start, end);
    const hasSelection = end > start;
    const next =
      value.slice(0, start) + prefix + selected + suffix + value.slice(end);
    markDirty(next);
    requestAnimationFrame(() => {
      el.focus();
      if (hasSelection) {
        el.setSelectionRange(
          start + prefix.length,
          start + prefix.length + selected.length,
        );
      } else {
        el.setSelectionRange(start + prefix.length, start + prefix.length);
      }
    });
  };

  /** Applies `fn` to every line overlapping the current selection. */
  const lineOp = (fn: (line: string) => string): void => {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const lineEndIndex = value.indexOf("\n", selectionEnd);
    const end = lineEndIndex === -1 ? value.length : lineEndIndex;
    const before = value.slice(0, lineStart);
    const after = value.slice(end);
    const next =
      before +
      value.slice(lineStart, end).split("\n").map(fn).join("\n") +
      after;
    markDirty(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(
        lineStart,
        lineStart + (next.length - before.length - after.length),
      );
    });
  };

  const toggleHeading = (level: number): void => {
    lineOp((line) => {
      const hash = line.match(/^#{1,6}\s*/)?.[0] ?? "";
      const body = line.replace(/^#{1,6}\s*/, "");
      if (hash && hash.trim().length === level) return body;
      return "#".repeat(level) + " " + body;
    });
  };

  const toggleLinePrefix = (prefix: string): void => {
    lineOp((line) =>
      line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line,
    );
  };

  const insertAtCursor = (
    text: string,
    selectStart?: number,
    selectEnd?: number,
  ): void => {
    const el = areaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    markDirty(next);
    requestAnimationFrame(() => {
      el.focus();
      if (selectStart !== undefined && selectEnd !== undefined) {
        el.setSelectionRange(start + selectStart, start + selectEnd);
      } else {
        el.setSelectionRange(start + text.length, start + text.length);
      }
    });
  };

  const insertLink = (): void => {
    const el = areaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = el.value.slice(start, end);
    if (selected) {
      insertAtCursor(`[${selected}](https://)`, 1, 1 + selected.length);
    } else {
      insertAtCursor(`[link text](https://)`, 1, 10);
    }
  };

  const insertCodeBlock = (): void => {
    const el = areaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = el.value.slice(start, end);
    if (selected) {
      insertAtCursor(`\`\`\`\n${selected}\n\`\`\``, 4, 4 + selected.length);
    } else {
      insertAtCursor("```\n\n```", 4, 4);
    }
  };

  const insertTable = (): void => {
    insertAtCursor(
      "| Column A | Column B | Column C |\n| --- | --- | --- |\n|  |  |  |\n",
      0,
      0,
    );
  };

  /* ---- synced scrolling ---- */

  const handleAreaScroll = (): void => {
    const area = areaRef.current;
    const layer = layerRef.current;
    if (area && layer) {
      layer.scrollTop = area.scrollTop;
      layer.scrollLeft = area.scrollLeft;
    }
    syncToPreview();
  };

  const syncToPreview = (): void => {
    if (syncing.current || mode !== "split") return;
    const area = areaRef.current;
    const preview = previewRef.current;
    if (!area || !preview) return;
    const maxA = area.scrollHeight - area.clientHeight;
    const maxP = preview.scrollHeight - preview.clientHeight;
    const ratio = maxA > 0 ? area.scrollTop / maxA : 0;
    syncing.current = true;
    preview.scrollTop = ratio * maxP;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  const syncToEditor = (): void => {
    if (syncing.current || mode !== "split") return;
    const area = areaRef.current;
    const preview = previewRef.current;
    if (!area || !preview) return;
    const maxA = area.scrollHeight - area.clientHeight;
    const maxP = preview.scrollHeight - preview.clientHeight;
    const ratio = maxP > 0 ? preview.scrollTop / maxP : 0;
    syncing.current = true;
    area.scrollTop = ratio * maxA;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  const scrollToHeading = (text: string): void => {
    const preview = previewRef.current;
    if (!preview) return;
    const target = Array.from(preview.querySelectorAll("h1, h2, h3, h4")).find(
      (heading) => heading.textContent?.trim() === text,
    ) as HTMLElement | undefined;
    if (target) {
      preview.scrollTo({ top: target.offsetTop - 12, behavior: "smooth" });
    }
  };

  /* ---- keyboard ---- */

  const updateCursor = (): void => {
    const el = areaRef.current;
    if (!el) return;
    const upTo = el.value.slice(0, el.selectionStart);
    const line = upTo.split("\n").length;
    const col = upTo.length - upTo.lastIndexOf("\n");
    setCursor({ line, col });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape" && find) {
      event.preventDefault();
      closeFind();
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      wrapSelection("**");
    } else if (key === "i") {
      event.preventDefault();
      wrapSelection("*");
    } else if (key === "k") {
      event.preventDefault();
      insertLink();
    } else if (key === "`") {
      event.preventDefault();
      wrapSelection("`");
    } else if (key === "f") {
      event.preventDefault();
      openFind();
    } else if (key === "s") {
      event.preventDefault();
      void handleSave();
    }
  };

  /* ---- find in document ---- */

  const openFind = (): void => {
    const el = areaRef.current;
    const selected = el
      ? el.value.slice(el.selectionStart, el.selectionEnd)
      : "";
    setFind({ query: selected || "", index: 0 });
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  };

  const closeFind = (): void => {
    setFind(null);
    navPendingRef.current = false;
    areaRef.current?.focus();
  };

  const goToMatch = (nextIndex: number): void => {
    if (!find || matches.length === 0) return;
    const clamped = (nextIndex + matches.length) % matches.length;
    navPendingRef.current = true;
    setFind({ query: find.query, index: clamped });
  };

  const handleFindChange = (query: string): void => {
    setFind({ query, index: 0 });
  };

  const handleFindKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToMatch((find?.index ?? 0) + (event.shiftKey ? -1 : 1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeFind();
    }
  };

  /* ---- download / export ---- */

  const handleDownload = (): void => {
    const blob = new Blob([content], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "linkedin-job-assistant.system.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Defer revocation so the browser can start reading the blob URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  /* ---- draft restore / discard ---- */

  const restoreDraft = (): void => {
    if (!draftBanner) return;
    setContent(draftBanner.content);
    setDirty(true);
    setArmed(false);
    setDraftBanner(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* storage unavailable */
    }
  };

  const discardDraft = (): void => {
    setDraftBanner(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* storage unavailable */
    }
  };

  const formatDraftTime = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return "earlier";
    }
  };

  /* ---- save (two-step, unchanged from the backend contract) ---- */

  const handleSave = async (): Promise<void> => {
    setMessage(null);

    if (content.length === 0) {
      setMessage({ kind: "error", text: "Prompt content must not be empty." });
      return;
    }

    try {
      if (!armed) {
        try {
          await savePrompt(content, false);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            setArmed(true);
            return;
          }
          throw e;
        }
        setArmed(true);
        return;
      }

      setSaving(true);
      const result = await savePrompt(content, true);
      loadedRef.current = content;
      setArmed(false);
      setDirty(false);
      setMessage({
        kind: "ok",
        text: `Saved ${result.chars.toLocaleString()} chars. Backup: ${result.backup}`,
      });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* storage unavailable */
      }
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const toolbarGroup = (
    label: string,
    buttons: Array<{
      title: string;
      glyph: string;
      onClick: () => void;
    }>,
  ): ReactNode => (
    <>
      {buttons.map((button) => (
        <button
          key={button.title}
          type="button"
          className="tb-btn"
          title={button.title}
          aria-label={button.title}
          onClick={button.onClick}
        >
          <span className="tb-glyph">{button.glyph}</span>
        </button>
      ))}
      <span className="tb-sep" aria-hidden="true" />
    </>
  );

  return (
    <div className="grid">
      <section className="card card-wide" aria-labelledby="editor-title">
        <div className="editor-head">
          <h2 id="editor-title">Active prompt — manuscript</h2>
          <div className="row" style={{ margin: 0 }}>
            <div className="seg" role="group" aria-label="Editor mode">
              <button
                type="button"
                className={`seg-btn ${mode === "split" ? "active" : ""}`}
                onClick={() => setMode("split")}
              >
                Split
              </button>
              <button
                type="button"
                className={`seg-btn ${mode === "preview" ? "active" : ""}`}
                onClick={() => setMode("preview")}
              >
                Preview
              </button>
            </div>
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleDownload}
              disabled={!loaded || content.length === 0}
              title="Save the current manuscript as a Markdown file"
            >
              Download .md
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void refresh()}
              disabled={!loaded}
            >
              Reload
            </button>
            <button
              type="button"
              className={`btn ${armed ? "btn-danger" : "btn-primary"}`}
              onClick={() => void handleSave()}
              disabled={saving || !loaded}
            >
              {saving
                ? "Saving…"
                : armed
                  ? "Confirm save (final)"
                  : dirty
                    ? "Save changes (step 1 of 2)"
                    : "Save changes"}
            </button>
          </div>
        </div>

        <div className="editor-stats" aria-label="Document statistics">
          <span className="doc-pill">
            <strong>{charCount.toLocaleString()}</strong> chars
          </span>
          <span className="doc-pill">
            <strong>{wordCount.toLocaleString()}</strong> words
          </span>
          <span className="doc-pill">
            <strong>{lineCount.toLocaleString()}</strong> lines
          </span>
          <span className="doc-pill">
            <strong>{outline.length}</strong> headings
          </span>
          {dirty && (
            <span className="doc-pill doc-pill-warn">unsaved changes</span>
          )}
        </div>

        {draftBanner && (
          <div className="draft-banner" role="alert">
            <span className="draft-icon" aria-hidden="true">
              ✎
            </span>
            <p>
              <strong>Unsaved draft found</strong> — edited{" "}
              {formatDraftTime(draftBanner.savedAt)}. Restore it to keep going,
              or discard it and reload the on-file prompt.
            </p>
            <div className="draft-actions">
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={restoreDraft}
              >
                Restore draft
              </button>
              <button
                type="button"
                className="btn btn-small btn-outline"
                onClick={discardDraft}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {message && (
          <div
            className={`check-banner ${message.kind === "ok" ? "banner-ok" : "banner-bad"}`}
            role={message.kind === "ok" ? "status" : "alert"}
          >
            {message.text}
          </div>
        )}

        {!loaded ? (
          <p className="hint">Loading…</p>
        ) : (
          <div className="editor-rail">
            <div className="editor-body">
              <div
                className="editor-toolbar"
                role="toolbar"
                aria-label="Formatting"
              >
                {toolbarGroup("Headings", [
                  {
                    title: "Heading 1",
                    glyph: "H1",
                    onClick: () => toggleHeading(1),
                  },
                  {
                    title: "Heading 2",
                    glyph: "H2",
                    onClick: () => toggleHeading(2),
                  },
                  {
                    title: "Heading 3",
                    glyph: "H3",
                    onClick: () => toggleHeading(3),
                  },
                ])}
                {toolbarGroup("Inline", [
                  {
                    title: "Bold (⌘B)",
                    glyph: "𝐁",
                    onClick: () => wrapSelection("**"),
                  },
                  {
                    title: "Italic (⌘I)",
                    glyph: "𝐼",
                    onClick: () => wrapSelection("*"),
                  },
                  {
                    title: "Strikethrough",
                    glyph: "S̶",
                    onClick: () => wrapSelection("~~"),
                  },
                  {
                    title: "Inline code (⌘`)",
                    glyph: "</>",
                    onClick: () => wrapSelection("`"),
                  },
                ])}
                {toolbarGroup("Blocks", [
                  {
                    title: "Bullet list",
                    glyph: "•–",
                    onClick: () => toggleLinePrefix("- "),
                  },
                  {
                    title: "Numbered list",
                    glyph: "1.",
                    onClick: () => toggleLinePrefix("1. "),
                  },
                  {
                    title: "Blockquote",
                    glyph: "❝",
                    onClick: () => toggleLinePrefix("> "),
                  },
                ])}
                {toolbarGroup("Insert", [
                  { title: "Link (⌘K)", glyph: "🔗", onClick: insertLink },
                  {
                    title: "Code block",
                    glyph: "{}",
                    onClick: insertCodeBlock,
                  },
                  { title: "Table", glyph: "▦", onClick: insertTable },
                  {
                    title: "Horizontal rule",
                    glyph: "—",
                    onClick: () => insertAtCursor("\n\n---\n\n", 2, 2),
                  },
                ])}
              </div>

              {find && (
                <div className="editor-findbar" role="search">
                  <span className="find-icon" aria-hidden="true">
                    ⌕
                  </span>
                  <input
                    ref={findInputRef}
                    type="text"
                    value={find.query}
                    onChange={(event) => handleFindChange(event.target.value)}
                    onKeyDown={handleFindKeyDown}
                    placeholder="Find in document…"
                    aria-label="Find in document"
                    spellCheck={false}
                  />
                  <span className="find-count" aria-live="polite">
                    {matches.length === 0
                      ? "0 / 0"
                      : `${currentIndex + 1} / ${matches.length}`}
                  </span>
                  <button
                    type="button"
                    className="tb-btn"
                    onClick={() => goToMatch((find.index ?? 0) - 1)}
                    disabled={matches.length === 0}
                    title="Previous match (Shift+Enter)"
                    aria-label="Previous match"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="tb-btn"
                    onClick={() => goToMatch((find.index ?? 0) + 1)}
                    disabled={matches.length === 0}
                    title="Next match (Enter)"
                    aria-label="Next match"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="tb-btn"
                    onClick={closeFind}
                    title="Close (Esc)"
                    aria-label="Close find"
                  >
                    ✕
                  </button>
                </div>
              )}

              {mode === "split" ? (
                <>
                  <div className="editor-pane">
                    <div className="pane-head">
                      <span>Markdown source</span>
                      <span className="pane-count">
                        Ln {cursor.line}, Col {cursor.col}
                      </span>
                    </div>
                    <div className="editor-source">
                      <div
                        className="hl-layer"
                        ref={layerRef}
                        aria-hidden="true"
                      >
                        <div
                          ref={hlContentRef}
                          className="hl-content"
                          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                        />
                      </div>
                      <textarea
                        ref={areaRef}
                        className="editor-textarea"
                        value={content}
                        onChange={(event) => {
                          setContent(event.target.value);
                          setDirty(true);
                          setArmed(false);
                          updateCursor();
                        }}
                        onScroll={handleAreaScroll}
                        onKeyDown={handleKeyDown}
                        onKeyUp={updateCursor}
                        onClick={updateCursor}
                        onSelect={updateCursor}
                        spellCheck={false}
                        aria-label="Markdown source"
                      />
                    </div>
                  </div>
                  <div className="editor-pane">
                    <div className="pane-head">
                      <span>Rendered preview</span>
                      <span className="pane-count">
                        {outline.length} headings
                      </span>
                    </div>
                    <div
                      ref={previewRef}
                      className="editor-preview"
                      onScroll={syncToEditor}
                    />
                  </div>
                </>
              ) : (
                <div className="editor-pane">
                  <div className="pane-head">
                    <span>Rendered preview</span>
                    <span className="pane-count">
                      {outline.length} headings
                    </span>
                  </div>
                  <div
                    ref={previewRef}
                    className="editor-preview"
                    onScroll={syncToEditor}
                  />
                </div>
              )}

              <div className="editor-statusbar" aria-label="Editor status">
                <span className="stat-item">
                  <strong>{wordCount.toLocaleString()}</strong> words
                </span>
                <span className="stat-item">
                  <strong>{charCount.toLocaleString()}</strong> chars
                </span>
                <span className="stat-item">
                  Ln <strong>{cursor.line}</strong>, Col{" "}
                  <strong>{cursor.col}</strong>
                </span>
                <span className="stat-item" style={{ marginLeft: "auto" }}>
                  {dirty ? "unsaved" : "saved"} ·{" "}
                  {mode === "split" ? "split" : "preview"} · <strong>⌘</strong>B
                  bold · <strong>⌘</strong>I italic · <strong>⌘</strong>K link ·{" "}
                  <strong>⌘</strong>F find · <strong>⌘</strong>S save
                </span>
              </div>
            </div>

            <aside
              className="outline"
              aria-label="Document outline"
              ref={outlineRef}
            >
              <p className="outline-title">
                Outline <span className="count">{outline.length}</span>
              </p>
              {outline.length === 0 ? (
                <p className="hint">No headings yet.</p>
              ) : (
                <ul className="outline-list">
                  {outline.map((item, index) => (
                    <li key={`${item.text}-${index}`}>
                      <button
                        type="button"
                        data-outline-index={index}
                        className={`outline-item d${item.depth} ${
                          index === activeOutlineIndex ? "active" : ""
                        }`}
                        onClick={() => scrollToHeading(item.text)}
                      >
                        {item.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        )}
      </section>

      <section className="card card-wide" aria-labelledby="cases-title">
        <h2 id="cases-title">
          Regression cases <span className="count">({cases.length})</span>
        </h2>
        {cases.length === 0 ? (
          <p className="hint">No regression cases on file.</p>
        ) : (
          <ul className="case-list">
            {cases.map((item) => (
              <li key={item.id} className="case-item">
                <code className="case-id">{item.id}</code>
                <p className="case-scenario">{item.scenario}</p>
                <p className="case-expected">
                  <strong>Expected:</strong> {item.expected}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
