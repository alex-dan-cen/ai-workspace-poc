# 4. Sandbox Workflow (two-phase loop)

The framework enforces a **hard separation** between your working tree and
what the agent does. Nothing the agent proposes ever touches
`projectRoot`. Everything lives in a git worktree named
`sandbox-<TICKET>` next to it.

```text
/Users/you/dummy-poc/
├── shop-ui/                   ← projectRoot (your real repo)
│   ├── .git/
│   ├── .clinerules
│   └── src/…
└── sandbox-SCRUM-42/          ← auto-created git worktree
    ├── src/…                  (branch: feature/SCRUM-42)
    └── .mcp-plan-SCRUM-42.md
```

Both directories share the same `.git` (worktree magic). Commits made in the
sandbox live on branch `feature/SCRUM-42` and never touch `main` until you
decide to merge.

## Phase 1 — developer

```
@multi-agent-orchestrator agent_developer
{ "projectRoot": "/Users/you/dummy-poc/shop-ui", "ticketId": "SCRUM-42" }
```

1. Sandbox created. Plan written. Return payload includes `sandboxPath`.
2. **You (or Cline) execute the plan inside the sandbox.** Only accept edits
   whose absolute path starts with `sandboxPath`. Reject anything under
   `projectRoot/src/…`.
3. From the sandbox terminal:
   ```bash
   cd /Users/you/dummy-poc/sandbox-SCRUM-42
   npm install         # first time only
   npm run typecheck
   git add -A
   git commit -m "feat(SCRUM-42): implement modal"
   git push -u origin feature/SCRUM-42
   gh pr create --base main --head feature/SCRUM-42 \
     --title "SCRUM-42 modal" --body "See .mcp-plan-SCRUM-42.md"
   ```
4. Note the PR number from `gh pr create`.

## Phase 2 — reviewer

```
@multi-agent-orchestrator agent_reviewer
{
  "projectRoot": "/Users/you/dummy-poc/shop-ui",
  "ticketId": "SCRUM-42",
  "owner": "alex-dan-cen",
  "repo": "shop-ui-demo",
  "prNumber": 1
}
```

The reviewer fetches the PR diff, applies `.clinerules`, and **auto-posts a
review comment** on the PR. Refresh the PR on GitHub — the comment is there.

## Merge back to main

Once the review is green:

```bash
gh pr merge 1 --squash --delete-branch
cd /Users/you/dummy-poc/shop-ui
git pull origin main
```

## Cleanup the sandbox

```bash
cd /Users/you/dummy-poc/shop-ui
git worktree remove --force ../sandbox-SCRUM-42
git worktree prune
```

## Why worktree instead of a branch checkout?

- You can keep working on `main` in `shop-ui/` while the agent works on
  `feature/SCRUM-42` in `sandbox-SCRUM-42/`. Both open in your editor
  simultaneously.
- Zero risk of the agent accidentally committing on `main`.
- Removing the sandbox is one command; no branch mess left behind.