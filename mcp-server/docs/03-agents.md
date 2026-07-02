# 3. Agent Cookbook

Every command is meant to be pasted **into the editor chat** (Cline, Cursor,
Codex, Claude Desktop). The `@multi-agent-orchestrator` prefix targets our
MCP server.

## 3.1 `agent_developer` — implement a ticket

**Input**

| Field | Required | Notes |
| --- | --- | --- |
| `projectRoot` | ✅ | Absolute path to the target repo (must be a git root). |
| `ticketId` | ✅ | Jira issue key, e.g. `SCRUM-42`. Also becomes the branch name (`feature/SCRUM-42`). |
| `targetFiles` | ❌ | Optional file list. If omitted, derived from the Jira ticket text; otherwise from `git diff main…HEAD`. |
| `rawPrompt` | ❌ | Optional override. If omitted, uses Jira ticket `summary + description`. |

**Command**

```
@multi-agent-orchestrator agent_developer
{
  "projectRoot": "/Users/you/dummy-poc/shop-ui",
  "ticketId": "SCRUM-42"
}
```

**What happens (step by step)**

1. Creates git worktree at `../sandbox-SCRUM-42` on branch `feature/SCRUM-42`.
2. Calls Jira MCP → `jira_get /rest/api/3/issue/SCRUM-42` → extracts summary + description.
3. In parallel: `github.search_code` (repo context) + `Distiller.distillMany` (local files).
4. Loads `.clinerules` and merges with learned steering rules.
5. Writes `.mcp-plan-SCRUM-42.md` inside the sandbox — contains the execution contract.
6. Returns `{ sandboxPath, plan, distilledContext, steps }` to your editor.

**What your editor does next**
- Reads the plan.
- Applies edits **only inside `sandboxPath`**.
- Runs `npm run typecheck` from the sandbox.
- Commits + pushes `feature/SCRUM-42`.
- Opens the PR via `github.create_pull_request`.

## 3.2 `agent_reviewer` — review a PR

**Input**

| Field | Required | Notes |
| --- | --- | --- |
| `projectRoot` | ✅ | Same repo as the developer used. |
| `ticketId` | ✅ | Same ticket ID. |
| `owner` | ✅* | GitHub org/user (`alex-dan-cen`). |
| `repo` | ✅* | GitHub repo name (`shop-ui-demo`). |
| `prNumber` | ✅* | PR number returned by `gh pr create`. |
| `autoPost` | ❌ | Default `true`. Set `false` to only return the plan without commenting on the PR. |

\* Required for auto-posting. Without them the agent still returns a plan but can't post.

**Command**

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

**What happens**

1. In parallel: `github.get_pull_request_files` (PR diff) + `sonarqube.search_issues` (skipped if not configured).
2. Loads `.clinerules` and merges with learned steering rules.
3. **Auto-posts** a review on the PR via `github.create_pull_request_review` with `event: "COMMENT"`.
   - Body includes: files changed, steering rules enforced, Sonar summary.
   - GitHub disallows self-approval, so we always use `COMMENT`.
4. Returns `{ steps, plan }` — check `steps` for `github.create_pull_request_review → ok` to confirm the post.

**Skip auto-post** (for dry-run):

```
@multi-agent-orchestrator agent_reviewer
{ ..., "autoPost": false }
```

## 3.3 `agent_refactor` — refactor without changing behavior

**Input**

| Field | Required | Notes |
| --- | --- | --- |
| `projectRoot` | ✅ | |
| `ticketId` | ✅ | Used for the worktree branch. |
| `targetFiles` | ❌ | Defaults to `git diff main…HEAD`. |
| `rawPrompt` | ❌ | E.g. `"Extract shared logic. Keep public API."` |

**Command**

```
@multi-agent-orchestrator agent_refactor
{
  "projectRoot": "/Users/you/dummy-poc/shop-ui",
  "ticketId": "REFACTOR-7",
  "targetFiles": ["src/legacy/payment.ts"],
  "rawPrompt": "Extract duplicated logic, preserve public API."
}
```

**What happens**

1. Creates sandbox worktree.
2. In parallel: distill files + fetch Sonar issues.
3. Emits a refactor plan constrained by steering rules and refactor heuristics
   (no `any`, no side effects in pure fns, surgical diffs).

## 3.4 `run_squad` — developer + reviewer + refactor in parallel

```
@multi-agent-orchestrator run_squad
{
  "projectRoot": "/Users/you/dummy-poc/shop-ui",
  "ticketId": "SCRUM-42",
  "targetFiles": ["src/Cart.ts"],
  "rawPrompt": "Implement SCRUM-42 and auto-review.",
  "agents": ["developer", "refactor", "reviewer"],
  "owner": "alex-dan-cen",
  "repo": "shop-ui-demo",
  "prNumber": 1
}
```

All three run through `Promise.all`. Fastest way to demo parallelism.

## 3.5 Utility tools

### `capture_behavior_feedback` — teach the agent

Use when the LLM did something wrong and you corrected it. The rule becomes
permanent and is auto-injected into every future prompt for this project.

```
@multi-agent-orchestrator capture_behavior_feedback
{
  "projectRoot": "/Users/you/dummy-poc/shop-ui",
  "source": "rejection",
  "rule": "Never use plain CSS. Only Tailwind utility classes."
}
```

### `parse_audit_log` — inspect what happened

```
@multi-agent-orchestrator parse_audit_log { "ticketId": "SCRUM-42" }
@multi-agent-orchestrator parse_audit_log { "anomaliesOnly": true }
```

### `generate_task_metrics_report` — the invoice

```
@multi-agent-orchestrator generate_task_metrics_report {}
```

Returns: tokens in/out (estimated), tool hops, downstream calls, USD cost per session.

### `downstream_list_tools` / `downstream_call` — raw escape hatch

Manually call any tool on any downstream MCP server:

```
@multi-agent-orchestrator downstream_list_tools { "server": "jira" }
@multi-agent-orchestrator downstream_call
{
  "server": "jira",
  "tool": "jira_get",
  "args": { "path": "/rest/api/3/issue/SCRUM-42", "outputFormat": "json" }
}
```