import type { RegressionCase } from "./types";

export type CaseStatus = "covered" | "actionable" | "reference";

/**
 * A case is `actionable` only when it carries an insertable rule and the
 * prompt does not already cover it. Cases without a rule are `reference`
 * so the UI never offers a button that cannot do anything.
 */
export function caseStatus(item: RegressionCase, content: string): CaseStatus {
  if (!item.rule || !item.detect?.length) return "reference";
  return isCovered(item, content) ? "covered" : "actionable";
}

function isCovered(item: RegressionCase, content: string): boolean {
  const haystack = content.toLowerCase();
  return (item.detect ?? []).some((phrase) =>
    haystack.includes(phrase.toLowerCase()),
  );
}

/**
 * Inserts the case rule as a bullet under its target heading, or appends a
 * new section when that heading is absent. Returns the original content
 * unchanged when there is no rule to apply.
 */
export function applyCaseRule(content: string, item: RegressionCase): string {
  if (!item.rule) return content;

  const bullet = `- ${item.rule}`;
  const section = item.section ?? "Operating Rules";
  const lines = content.split("\n");
  const headingIndex = lines.findIndex(
    (line) =>
      /^#{1,6}\s+/.test(line) &&
      line
        .replace(/^#{1,6}\s+/, "")
        .trim()
        .toLowerCase() === section.toLowerCase(),
  );

  if (headingIndex === -1) {
    const spacer = content.endsWith("\n") ? "" : "\n";
    return `${content}${spacer}\n## ${section}\n\n${bullet}\n`;
  }

  // Append after the heading's last non-empty line so the bullet joins the
  // existing list rather than splitting it.
  let insertAt = headingIndex + 1;
  let lastContent = headingIndex;
  while (insertAt < lines.length && !/^#{1,6}\s+/.test(lines[insertAt] ?? "")) {
    if ((lines[insertAt] ?? "").trim() !== "") lastContent = insertAt;
    insertAt += 1;
  }

  const next = [...lines];
  next.splice(lastContent + 1, 0, bullet);
  return next.join("\n");
}
