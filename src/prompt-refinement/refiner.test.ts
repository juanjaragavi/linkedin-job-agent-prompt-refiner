import { describe, expect, it } from "vitest";
import {
  detectUnsafeCandidate,
  extractDecision,
  refineLinkedInJobAgentPrompt,
  section,
} from "./refiner.js";
import type { LlmClient, PromptEvaluation } from "./types.js";

const passingEvaluation: PromptEvaluation = {
  score: 90,
  passed: true,
  violations: [],
  strengths: ["confirmation enforced"],
  recommendedChanges: [],
};

describe("section", () => {
  it("extracts content between Markdown headings", () => {
    const response = `## Decision
PROMOTE

## Patch
+ change

## Revised Prompt
new prompt

## Rationale
- reason

## Guardrail Check
- Confirmation: PASS`;

    expect(section(response, "Decision", "Patch")).toBe("PROMOTE");
    expect(section(response, "Patch", "Revised Prompt")).toBe("+ change");
    expect(section(response, "Revised Prompt", "Rationale")).toBe("new prompt");
    expect(section(response, "Rationale", "Guardrail Check")).toBe("- reason");
  });

  it("returns an empty string when a heading is missing", () => {
    expect(section("## Decision\nPROMOTE", "Patch", "Revised Prompt")).toBe("");
  });

  it("strips code fences wrapping a section body", () => {
    expect(
      section(
        "## Patch\n```diff\n+ change\n```\n\n## Revised Prompt\nnext",
        "Patch",
        "Revised Prompt",
      ),
    ).toBe("+ change");
  });

  it("captures a section to the end when the closing heading is missing", () => {
    expect(
      section(
        "## Revised Prompt\nnew prompt content without a rationale section",
        "Revised Prompt",
        "Rationale",
      ),
    ).toBe("new prompt content without a rationale section");
  });
});

describe("extractDecision", () => {
  it("accepts a bare decision line", () => {
    expect(extractDecision("## Decision\nPROMOTE\n\n## Patch\n...")).toBe(
      "PROMOTE",
    );
  });

  it("accepts a trailing annotation after the decision", () => {
    expect(
      extractDecision(
        "## Decision\nPROMOTE — subject to review\n\n## Patch\n...",
      ),
    ).toBe("PROMOTE");
  });

  it("accepts a Decision: prefix", () => {
    expect(
      extractDecision("## Decision\nDecision: REJECT\n\n## Patch\n..."),
    ).toBe("REJECT");
  });

  it("skips a template echo and finds the real decision", () => {
    const response = `## Decision
PROMOTE | REJECT | NO_CHANGE

## Patch
+ change

## Decision
PROMOTE

## Revised Prompt
new prompt

## Rationale
- fixed

## Guardrail Check
- Confirmation: PASS`;

    expect(extractDecision(response)).toBe("PROMOTE");
  });

  it("returns an empty string when no decision is present", () => {
    expect(extractDecision("## Patch\n+ change")).toBe("");
  });
});

describe("detectUnsafeCandidate", () => {
  it("flags auto-submit and CAPTCHA-bypass phrasing", () => {
    const reasons = detectUnsafeCandidate(
      "The agent may auto-submit the form and bypass CAPTCHA when blocked.",
    );

    expect(reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag safety prohibitions as unsafe behavior", () => {
    expect(
      detectUnsafeCandidate(
        "Never submit without explicit confirmation. Do not bypass CAPTCHA.",
      ),
    ).toEqual([]);
  });

  it("does not flag gerund prohibition lists under a Prohibited heading", () => {
    expect(
      detectUnsafeCandidate(
        "Prohibited actions:\n- Bypassing login walls, CAPTCHAs, OTP, or any anti-automation/security control.\n- Submitting an application without explicit confirmation.",
      ),
    ).toEqual([]);
  });

  it("returns no reasons for a clean prompt", () => {
    expect(
      detectUnsafeCandidate(
        "Pause before interacting with an external ATS and request confirmation.",
      ),
    ).toEqual([]);
  });
});

describe("refineLinkedInJobAgentPrompt", () => {
  it("returns no_change without issues or feedback", async () => {
    const llmThatMustNotBeCalled: LlmClient = {
      async generateText() {
        throw new Error("LLM must not be called without evidence.");
      },
    };

    const result = await refineLinkedInJobAgentPrompt(
      { currentPrompt: "Keep me as I am.", issues: [] },
      llmThatMustNotBeCalled,
      async () => passingEvaluation,
    );

    expect(result.status).toBe("no_change");
    expect(result.refinedPrompt).toBe("Keep me as I am.");
  });

  it("rejects a candidate that fails post-revision evaluation", async () => {
    const refinerLlm: LlmClient = {
      async generateText() {
        return `## Decision
PROMOTE

## Patch
+ confirmation rule

## Revised Prompt
A brand new prompt that drops confirmation.

## Final Section
This stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.
End of the document.

## Rationale
- fixed the reported issue

## Guardrail Check
- Confirmation: PASS
- Truthfulness: PASS
- Security: PASS
- Platform compliance: PASS
- Profile source of truth: PASS`;
      },
    };

    const failingEvaluation: PromptEvaluation = {
      score: 40,
      passed: false,
      violations: ["confirmation dropped"],
      strengths: [],
      recommendedChanges: [],
    };

    const result = await refineLinkedInJobAgentPrompt(
      {
        currentPrompt:
          "Original prompt.\n\n## Final Section\nThis stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.\nEnd of the document.",
        issues: [
          {
            category: "confirmation",
            severity: "critical",
            evidence: "evidence",
            expectedBehavior: "expected behavior",
          },
        ],
      },
      refinerLlm,
      async () => failingEvaluation,
    );

    expect(result.status).toBe("rejected");
    expect(result.refinedPrompt).toBe(
      "Original prompt.\n\n## Final Section\nThis stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.\nEnd of the document.",
    );
  });

  it("promotes a candidate whose decision has a trailing annotation", async () => {
    const refinerLlm: LlmClient = {
      async generateText() {
        return `## Decision
PROMOTE — addresses both issues

## Patch
+ external redirect confirmation

## Revised Prompt
A revised prompt with the external redirect confirmation rule.

## Final Section
This stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.
End of the document.

## Rationale
- added the missing rule

## Guardrail Check
- Confirmation: PASS
- Truthfulness: PASS
- Security: PASS
- Platform compliance: PASS
- Profile source of truth: PASS`;
      },
    };

    const result = await refineLinkedInJobAgentPrompt(
      {
        currentPrompt:
          "Original prompt.\n\n## Final Section\nThis stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.\nEnd of the document.",
        issues: [
          {
            category: "confirmation",
            severity: "critical",
            evidence: "evidence",
            expectedBehavior: "expected behavior",
          },
        ],
      },
      refinerLlm,
      async () => passingEvaluation,
    );

    expect(result.status).toBe("promoted");
    expect(result.refinerResponse).toContain("PROMOTE — addresses both issues");
  });

  it("promotes a candidate whose Revised Prompt is wrapped in template tags", async () => {
    const refinerLlm: LlmClient = {
      async generateText() {
        return `## Decision
PROMOTE

## Patch
+ recovery rule

## Revised Prompt
<current_prompt>
A revised prompt with the mid-application recovery rule.

## Final Section
This stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.
End of the document.
</current_prompt>

## Rationale
- added the recovery rule

## Guardrail Check
- Confirmation: PASS
- Truthfulness: PASS
- Security: PASS
- Platform compliance: PASS
- Profile source of truth: PASS`;
      },
    };

    const result = await refineLinkedInJobAgentPrompt(
      {
        currentPrompt:
          "Original prompt.\n\n## Final Section\nThis stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.\nEnd of the document.",
        issues: [
          {
            category: "browser_failure",
            severity: "high",
            evidence: "evidence",
            expectedBehavior: "expected behavior",
          },
        ],
      },
      refinerLlm,
      async () => passingEvaluation,
    );

    expect(result.status).toBe("promoted");
    expect(result.refinedPrompt).toContain("mid-application recovery rule");
    expect(result.refinedPrompt).not.toContain("<current_prompt>");
  });

  it("promotes a candidate that reflows wrapped lines in the tail", async () => {
    const refinerLlm: LlmClient = {
      async generateText() {
        return `## Decision
PROMOTE

## Patch
+ rule

## Revised Prompt
A revised prompt with a new rule.

## Final Section
This stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content. End of the document.

## Rationale
- added the rule

## Guardrail Check
- Confirmation: PASS
- Truthfulness: PASS
- Security: PASS
- Platform compliance: PASS
- Profile source of truth: PASS`;
      },
    };

    const result = await refineLinkedInJobAgentPrompt(
      {
        currentPrompt:
          "Original prompt.\n\n## Final Section\nThis stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.\nEnd of the document.",
        issues: [
          {
            category: "confirmation",
            severity: "critical",
            evidence: "evidence",
            expectedBehavior: "expected behavior",
          },
        ],
      },
      refinerLlm,
      async () => passingEvaluation,
    );

    expect(result.status).toBe("promoted");
  });

  it("promotes a candidate whose Revised Prompt ends with a horizontal rule echo", async () => {
    const refinerLlm: LlmClient = {
      async generateText() {
        return `## Decision
PROMOTE

## Patch
+ rule

## Revised Prompt
A revised prompt with a new rule.

## Final Section
This stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.
End of the document.

---

## Rationale
- added the rule

## Guardrail Check
- Confirmation: PASS
- Truthfulness: PASS
- Security: PASS
- Platform compliance: PASS
- Profile source of truth: PASS`;
      },
    };

    const result = await refineLinkedInJobAgentPrompt(
      {
        currentPrompt:
          "Original prompt.\n\n## Final Section\nThis stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.\nEnd of the document.",
        issues: [
          {
            category: "confirmation",
            severity: "critical",
            evidence: "evidence",
            expectedBehavior: "expected behavior",
          },
        ],
      },
      refinerLlm,
      async () => passingEvaluation,
    );

    expect(result.status).toBe("promoted");
    expect(result.refinedPrompt.trimEnd()).not.toMatch(/---$/);
  });

  it("rejects a truncated candidate whose ending does not match the current prompt", async () => {
    const refinerLlm: LlmClient = {
      async generateText() {
        return `## Decision
PROMOTE

## Patch
+ rule

## Revised Prompt
A revised prompt that stops mid-sentence without reaching the end of the`;
      },
    };

    const result = await refineLinkedInJobAgentPrompt(
      {
        currentPrompt:
          "Original prompt.\n\n## Final Section\nThis stable trailing section is deliberately long so the tail comparison covers more than eighty characters of unchanged content.\nEnd of the document.",
        issues: [
          {
            category: "browser_failure",
            severity: "medium",
            evidence: "evidence",
            expectedBehavior: "expected behavior",
          },
        ],
      },
      refinerLlm,
      async () => passingEvaluation,
    );

    expect(result.status).toBe("rejected");
    expect(result.rationale.join(" ")).toContain("truncated");
  });

  it("rejects a candidate when the refiner does not promote it", async () => {
    const refinerLlm: LlmClient = {
      async generateText() {
        return `## Decision
REJECT

## Patch
none

## Revised Prompt
Original prompt.

## Rationale
- The issue could not be addressed safely.

## Guardrail Check
- Confirmation: PASS
- Truthfulness: PASS
- Security: PASS
- Platform compliance: PASS
- Profile source of truth: PASS`;
      },
    };

    const result = await refineLinkedInJobAgentPrompt(
      {
        currentPrompt: "Original prompt.",
        issues: [
          {
            category: "browser_failure",
            severity: "medium",
            evidence: "evidence",
            expectedBehavior: "expected behavior",
          },
        ],
      },
      refinerLlm,
      async () => passingEvaluation,
    );

    expect(result.status).toBe("rejected");
    expect(result.refinedPrompt).toBe("Original prompt.");
  });
});
