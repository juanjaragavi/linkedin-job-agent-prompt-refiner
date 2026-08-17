import { describe, expect, it } from "vitest";
import { applyCaseRule, caseStatus } from "./cases";
import type { RegressionCase } from "./types";

const item: RegressionCase = {
  id: "captcha-otp",
  scenario: "The browser presents CAPTCHA.",
  expected: "Stop and report the blocker.",
  severity: "critical",
  section: "Operating Rules",
  detect: ["captcha", "otp"],
  rule: "Stop and report CAPTCHA or OTP blockers. Never attempt a bypass.",
};

describe("caseStatus", () => {
  it("is actionable when the prompt does not mention the case", () => {
    expect(caseStatus(item, "# Prompt\n\nApply to roles.")).toBe("actionable");
  });

  it("is covered when a detect phrase appears, regardless of case", () => {
    expect(caseStatus(item, "Pause on any CAPTCHA challenge.")).toBe("covered");
  });

  it("is reference when the case carries no insertable rule", () => {
    const { rule, ...withoutRule } = item;
    void rule;
    expect(caseStatus(withoutRule, "anything")).toBe("reference");
  });
});

describe("applyCaseRule", () => {
  it("appends the rule under an existing section", () => {
    const content = "# Prompt\n\n## Operating Rules\n\n- Be careful.\n";
    const next = applyCaseRule(content, item);
    expect(next).toContain("- Be careful.\n- Stop and report CAPTCHA");
  });

  it("keeps later sections intact", () => {
    const content =
      "## Operating Rules\n\n- Be careful.\n\n## Reporting\n\n- Summarize.\n";
    const next = applyCaseRule(content, item);
    const rules = next.indexOf("Stop and report CAPTCHA");
    expect(rules).toBeGreaterThan(-1);
    expect(rules).toBeLessThan(next.indexOf("## Reporting"));
    expect(next).toContain("- Summarize.");
  });

  it("creates the section when it is missing", () => {
    const next = applyCaseRule("# Prompt\n\nDo the thing.\n", item);
    expect(next).toContain("## Operating Rules");
    expect(next).toContain("Stop and report CAPTCHA");
  });

  it("returns content unchanged when there is no rule", () => {
    const { rule, ...withoutRule } = item;
    void rule;
    expect(applyCaseRule("# Prompt", withoutRule)).toBe("# Prompt");
  });

  it("makes an applied case report as covered", () => {
    const applied = applyCaseRule("# Prompt\n", item);
    expect(caseStatus(item, applied)).toBe("covered");
  });
});
