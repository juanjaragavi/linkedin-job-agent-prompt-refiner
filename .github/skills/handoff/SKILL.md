---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

<!-- skillbridge-adapter -->
## SkillBridge Installation Notes

This skill was installed from https://github.com/mattpocock/skills.
Installed command: `/handoff`.

Use it in VS Code Chat / Copilot Agent Mode by typing:

`/handoff <your arguments>`

This source repository contains shared resources outside individual skill folders. SkillBridge copied those resources here:

`.github/skills/.skillbridge/packs/mattpocock__skills`

If an original instruction mentions a repository-root path such as `.github/skills/.skillbridge/packs/mattpocock__skills/scripts/foo.py`, use the SkillBridge-adapted path shown in this file instead.

> Review bundled scripts before allowing an agent to run terminal commands. SkillBridge copies files but does not execute remote installers automatically.

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
