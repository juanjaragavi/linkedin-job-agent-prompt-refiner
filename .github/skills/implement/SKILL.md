---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

<!-- skillbridge-adapter -->
## SkillBridge Installation Notes

This skill was installed from https://github.com/mattpocock/skills.
Installed command: `/implement`.

Use it in VS Code Chat / Copilot Agent Mode by typing:

`/implement <your arguments>`

This source repository contains shared resources outside individual skill folders. SkillBridge copied those resources here:

`.github/skills/.skillbridge/packs/mattpocock__skills`

If an original instruction mentions a repository-root path such as `.github/skills/.skillbridge/packs/mattpocock__skills/scripts/foo.py`, use the SkillBridge-adapted path shown in this file instead.

> Review bundled scripts before allowing an agent to run terminal commands. SkillBridge copies files but does not execute remote installers automatically.

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.
