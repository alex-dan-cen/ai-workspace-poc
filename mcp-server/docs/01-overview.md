# 1. Overview

## What it is

A **local MCP server** you register once in your editor. It exposes preset
"agents" (developer, reviewer, refactor) that read Jira tickets, isolate work
in a git worktree sandbox, apply your team's `.clinerules`, and — for the
reviewer — auto-post code review comments on GitHub PRs.

It is **not** an LLM. It is an orchestrator: it plans, calls downstream MCP
servers in parallel (GitHub / Jira / SonarQube / Confluence / Chrome DevTools),
and hands the LLM in your editor a distilled, steering-aware plan to execute.

## Why it exists

- One `.clinerules` file per repo → every agent auto-injects it. Team standards
  are enforced without repeating them in every prompt.
- Ticket-driven: give it `SCRUM-42`, it pulls the ticket from Jira, extracts
  the acceptance criteria, and builds the prompt for you.
- Sandbox isolation: never touches your working tree. All experiments live in
  `../sandbox-<TICKET>/` on a dedicated branch.
- Auditable: every downstream call is logged. `parse_audit_log` and
  `generate_task_metrics_report` give you a per-session invoice.

## Architecture

```text
┌──────────────────────┐        stdio        ┌────────────────────────────┐
│   Editor (Cline /    │  ─────────────────▶ │  multi-agent-orchestrator  │
│   Cursor / Codex /   │                     │  (this MCP server)         │
│   Claude Desktop)    │  ◀───────────────── │                            │
└──────────────────────┘   JSON tool result  └──────────────┬─────────────┘
                                                            │ spawns
                        ┌───────────────────────────────────┼────────────────────────────┐
                        ▼                                   ▼                            ▼
                ┌──────────────┐                   ┌──────────────┐             ┌────────────────┐
                │ github MCP   │                   │  jira MCP    │             │ sonarqube MCP  │
                │ (@modelcon…) │                   │ (@aashari/…) │             │ (optional)     │
                └──────────────┘                   └──────────────┘             └────────────────┘
```

All downstream MCP servers run as child processes managed by
`utils/mcp-client.ts`. They are lazy-spawned the first time an agent needs
them and pooled for the rest of the session.

## The 4 building blocks

| Block | File | Job |
| --- | --- | --- |
| Sandbox | `utils/sandbox.ts` | Create isolated `git worktree` per ticket, block dangerous shell commands. |
| Distiller | `utils/distiller.ts` | Shrink target files (strip comments/whitespace) to save LLM tokens. |
| BehaviorTracker | `utils/tracker.ts` | Load `.clinerules` + captured rejections, prepend them to every prompt. |
| MCPDownstream | `utils/mcp-client.ts` | Spawn and pool official MCP servers (github/jira/sonar/…). |

The agents (`src/agents.ts`) glue these together. `src/index.ts` exposes them
as MCP tools to your editor.