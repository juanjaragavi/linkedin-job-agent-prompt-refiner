---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

<!-- skillbridge-adapter -->
## SkillBridge Installation Notes

This skill was installed from https://github.com/mattpocock/skills.
Installed command: `/research`.

Use it in VS Code Chat / Copilot Agent Mode by typing:

`/research <your arguments>`

This source repository contains shared resources outside individual skill folders. SkillBridge copied those resources here:

`.github/skills/.skillbridge/packs/mattpocock__skills`

If an original instruction mentions a repository-root path such as `.github/skills/.skillbridge/packs/mattpocock__skills/scripts/foo.py`, use the SkillBridge-adapted path shown in this file instead.

> Review bundled scripts before allowing an agent to run terminal commands. SkillBridge copies files but does not execute remote installers automatically.

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
