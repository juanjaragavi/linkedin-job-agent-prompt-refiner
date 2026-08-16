import { marked } from "marked";

/** Removes scriptable/active content before injecting Markdown HTML. */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  const forbidden = [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "base",
  ];
  for (const el of Array.from(doc.querySelectorAll(forbidden.join(",")))) {
    el.remove();
  }

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        /^\s*javascript:/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  return doc.body.innerHTML;
}

/** Renders untrusted Markdown to sanitized HTML. */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false, breaks: true, gfm: true });
  return sanitizeHtml(typeof raw === "string" ? raw : String(raw));
}
