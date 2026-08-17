---
name: resolving-merge-conflicts
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
---

<!-- skillbridge-adapter -->
## SkillBridge Installation Notes

This skill was installed from https://github.com/mattpocock/skills.
Installed command: `/resolving-merge-conflicts`.

Use it in VS Code Chat / Copilot Agent Mode by typing:

`/resolving-merge-conflicts <your arguments>`

This source repository contains shared resources outside individual skill folders. SkillBridge copied those resources here:

`.github/skills/.skillbridge/packs/mattpocock__skills`

If an original instruction mentions a repository-root path such as `.github/skills/.skillbridge/packs/mattpocock__skills/scripts/foo.py`, use the SkillBridge-adapted path shown in this file instead.

> Review bundled scripts before allowing an agent to run terminal commands. SkillBridge copies files but does not execute remote installers automatically.

1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the merge's stated goal and note the trade-off. Do **not** invent new behaviour. Always resolve; never `--abort`.

4. Discover the project's **automated checks** and run them — typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Finish the merge/rebase.** Stage everything and commit. If rebasing, continue the rebase process until all commits are rebased.
