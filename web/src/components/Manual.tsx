import { useEffect, useMemo, useRef, useState } from "react";
import { getManual } from "../api";
import { renderMarkdown } from "../markdown";

interface TocItem {
  id: string;
  depth: number;
  text: string;
}

export default function Manual() {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getManual()
      .then((res) => setContent(res.content))
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "The manual could not be loaded.",
        ),
      );
  }, []);

  const html = useMemo(
    () => (content ? renderMarkdown(content) : ""),
    [content],
  );

  // Assign stable ids to rendered headings and build the TOC from the DOM.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const items: TocItem[] = [];
    for (const el of Array.from(body.querySelectorAll("h1, h2, h3, h4"))) {
      const id = `manual-${items.length}`;
      el.id = id;
      const text = (el.textContent ?? "").trim();
      if (text) {
        items.push({ id, depth: Number(el.tagName[1]), text });
      }
    }
    setToc(items);
  }, [content]);

  const scrollTo = (id: string): void => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="grid manual-grid">
      <section className="card card-wide" aria-labelledby="manual-title">
        <h2 id="manual-title">User manual</h2>
        <p className="hint">
          The complete documentation for both the web GUI and the CLI tool —
          straight from <code>USER_MANUAL.md</code> at the project root.
        </p>
        {error && (
          <div className="check-banner banner-bad" role="alert">
            {error}
          </div>
        )}
        {content === null && !error && <p className="hint">Loading…</p>}
        {content !== null && (
          <div
            ref={bodyRef}
            className="manual-body"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </section>

      {toc.length > 0 && (
        <aside className="manual-toc" aria-label="Manual contents">
          <p className="outline-title">
            Contents <span className="count">{toc.length}</span>
          </p>
          <ul className="outline-list">
            {toc.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`outline-item d${Math.min(item.depth, 4)}`}
                  onClick={() => scrollTo(item.id)}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
