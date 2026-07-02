# 5. Source Code Guide

File-by-file walkthrough of `mcp-server/src/`. Read top-to-bottom; each file
builds on the previous.

---

## 5.1 `utils/logger.ts` — logs, audit trail, telemetry

Three responsibilities, one file:

### `Logger`
A stdout logger with levels (`info`, `warn`, `error`, `audit`) that also
appends every line to `mcp-framework.log`. Every downstream call, sandbox
creation, and denied command flows through here.

### `LogParser`
Reads back `mcp-framework.log` for the `parse_audit_log` MCP tool:
- `readAll()` → every log entry.
- `stepsForTicket(id)` → only entries tagged with that ticket.
- `findAnomalies()` → errors + `Permission denied` entries. Great for
  security demos: shows what the sandbox blocked.

### `Telemetry`
Per-session metrics: input/output tokens, tool hops, downstream calls, USD
cost estimate. Persists to `mcp-telemetry.json`. Consumed by
`generate_task_metrics_report` → the "invoice" you show clients.

> Token counts are **estimated** (`chars/4`). Not billing-grade, but good
> enough for cost trend graphs.

---

## 5.2 `utils/sandbox.ts` — git worktree + permission manager

### `Sandbox.createWorktree(projectRoot, ticketId)`
Creates `../sandbox-<TICKET>` as a real git worktree of `projectRoot`, on
branch `feature/<TICKET>`. Idempotent — running twice reuses the existing
worktree instead of erroring.

### `Sandbox.runSafe(cmd, { cwd, scopeRoot })`
Wraps `child_process.execSync` with two guards:
1. **Command allowlist**: blocks `rm -rf`, `sudo`, `curl | sh`, etc.
2. **Path scope**: verifies every path arg stays inside `scopeRoot`.
   Anything outside throws `PermissionDeniedError` — the framework never
   executes it.

Every denial is written to the audit log. `parse_audit_log anomaliesOnly=true`
surfaces them.

---

## 5.3 `utils/distiller.ts` — token optimization

`Distiller.distillFile(absPath)` reads a source file and strips:
- comments (line + block)
- blank lines and trailing whitespace
- import groups (kept as a compact summary)

Then truncates to a token budget. Returns
`{ path, originalLength, distilledLength, truncated, content }`.

`Distiller.distillMany([...])` parallelizes it. The developer agent runs
this on `targetFiles` to fit more context into a single LLM call.

---

## 5.4 `utils/tracker.ts` — behavior profile (auto-steering)

Persists a per-project JSON file (`mcp-behavior-profile.json`) that
accumulates rules from three sources:

| Source | Trigger |
| --- | --- |
| `clinerules` | Every agent run reads `projectRoot/.clinerules` and ingests each non-comment line as a rule. |
| `manual_steering` | You call `capture_behavior_feedback` with `source: "manual_steering"`. |
| `rejection` | You call `capture_behavior_feedback` with `source: "rejection"` after you rejected an LLM suggestion. |

`BehaviorTracker.applySteering(projectRoot, rawPrompt)` prepends every rule to
the raw prompt with a `## Steering boundaries` header. This is how the
framework guarantees the team's standards land in every LLM call.

---

## 5.5 `utils/mcp-client.ts` — downstream MCP pool

The bridge that turns this from an "advisor" into a real multi-agent runtime.

### `DOWNSTREAM_SPECS`
Static registry of each downstream MCP server's launch command + env:
`github`, `jira`, `sonarqube`, `confluence`, `chrome`. Add a new one by
extending this record.

### `MCPDownstream.get(id)`
Lazy-spawns a child process running the downstream MCP over stdio, wraps it
in the official MCP `Client`, and pools it. Subsequent calls reuse the same
client — no re-connect cost.

### `MCPDownstream.call(id, toolName, args, sessionId?)`
Forwards a `tools/call` JSON-RPC to the downstream. Records a `toolHops`
telemetry entry. Logs the call for audit.

### `MCPDownstream.listTools(id)`
Introspection — used by the `downstream_list_tools` MCP tool for debugging.

### `MCPDownstream.closeAll()`
Called on shutdown to cleanly terminate every pooled client.

---

## 5.6 `src/agents.ts` — the preset agents

Every agent has the same shape:

```ts
1. Sandbox.createWorktree
2. Downstream calls IN PARALLEL (Promise.all)
3. Distill / analyze
4. BehaviorTracker.applySteering
5. Build a plan (Markdown)
6. (reviewer only) auto-post the plan to GitHub
7. Return { sandboxPath, steps, plan }
```

### `agentDeveloper`
- Calls Jira `jira_get /rest/api/3/issue/<id>` to fetch the ticket.
- Extracts prompt + files from Atlassian Document Format via `adfToPlainText`.
- Distills local files while `github.search_code` runs in parallel.
- Writes `.mcp-plan-<TICKET>.md` inside the sandbox.
- The plan contains a **CRITICAL EXECUTION CONTRACT** section that forbids
  the executing LLM from touching anything outside `sandboxPath`.

### `agentReviewer`
- Calls `github.get_pull_request_files` + `sonarqube.search_issues` in parallel.
- Loads `.clinerules`.
- **Auto-posts** a review comment via `github.create_pull_request_review`
  with `event: "COMMENT"` (never `APPROVE` — GitHub blocks self-approval).
- The comment body lists changed files, steering rules enforced, Sonar summary.
- Pass `autoPost: false` to skip posting and only return the plan.

### `agentRefactor`
- Distills target files + Sonar issues in parallel.
- Returns a plan constrained by refactor heuristics and steering rules.

### `runSquad`
- Runs any subset of the three agents in parallel through `Promise.all`.
- Fastest way to demo the multi-agent parallelism story.

---

## 5.7 `src/index.ts` — the MCP server entry point

This is what your editor spawns via stdio.

### Tool registry (`TOOL_DEFS`)
Every tool exposed to the editor:
- `execute_parallel_pipeline` — low-level orchestrator (advanced).
- `agent_developer`, `agent_reviewer`, `agent_refactor`, `run_squad` — preset agents.
- `capture_behavior_feedback`, `parse_audit_log`, `generate_task_metrics_report` — utilities.
- `downstream_call`, `downstream_list_tools` — raw escape hatch to downstream MCPs.

### Zod input schemas
All tool inputs go through Zod. `stringArray` accepts JSON, CSV, or single
strings for editor tolerance (Cline sometimes passes CSVs where the schema
wants arrays).

### Dispatch
`CallToolRequestSchema` handler routes tool names to their implementation
functions. Errors are caught, logged, and returned as MCP `isError: true`
responses so the editor can surface them without killing the process.

### Lifecycle
On SIGINT/SIGTERM, `MCPDownstream.closeAll()` shuts down every pooled
downstream client cleanly.