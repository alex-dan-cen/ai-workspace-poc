# MCP Multi-Agent Framework

Headless Node.js + TypeScript MCP server (StdIO transport) that turns any
MCP-aware code editor (VS Code/Cline, Cursor, Claude Code) into a
coordinated multi-agent workspace and fans tasks out to the official
**GitHub**, **Jira** and **SonarQube** MCP servers.

## What you get

| Module                              | Purpose                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `src/index.ts`                      | MCP server + `execute_parallel_pipeline` orchestrator tool              |
| `src/utils/sandbox.ts`              | `git worktree` isolation + Permission Manager (denylist & path scoping) |
| `src/utils/distiller.ts`            | Token optimizer: strip comments, collapse whitespace, AST-ish truncate  |
| `src/utils/logger.ts`               | Structural audit streamer + log parser + telemetry/invoice              |
| `src/utils/tracker.ts`              | Behavior tracker → `mcp-behavior-profile.json` → auto-steering rewrite  |
| `mcp_settings.json`                 | Drop-in editor config for orchestrator + GitHub/Jira/SonarQube          |
| `steering-boilerplates/.clinerules` | Corporate baseline (TS strict, Tailwind, Conventional Commits)          |

## Build & run

```bash
cd mcp-server
npm install        # or: bun install / pnpm install
npm run build
node dist/index.js # the editor launches this for you via mcp_settings.json
```

## Wiring it into an editor

Copy the relevant `mcpServers` block from `mcp_settings.json` into:

- **VS Code + Cline** → `cline_mcp_settings.json`
- **Cursor**         → `~/.cursor/mcp.json`
- **Claude Code**    → `claude_desktop_config.json`

Provide tokens via environment variables:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=...
export ATLASSIAN_SITE_NAME=...
export ATLASSIAN_USER_EMAIL=...
export ATLASSIAN_API_TOKEN=...
export SONARQUBE_URL=...
export SONARQUBE_TOKEN=...
export SONARQUBE_PROJECT_KEY=...
```

## Tools exposed

| Tool                             | What it does                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `execute_parallel_pipeline`      | Reads `.clinerules`, opens a `git worktree` sandbox, distills files, applies learned auto-steering, returns a parallel fan-out plan for downstream MCP servers. |
| `generate_task_metrics_report`   | Plain-text CLI invoice: tokens, hops, downstream calls, USD cost per session.           |
| `capture_behavior_feedback`      | Persist a rejection / steering instruction as a permanent rule for this project.        |
| `parse_audit_log`                | Inspect `mcp-framework.log` by ticket or anomalies-only.                                |

## Demo flow (what to show colleagues)

1. Drop `steering-boilerplates/.clinerules` into a real project.
2. From the editor, call `execute_parallel_pipeline` with `ticketId=ABC-123`, the touched files, and the raw prompt.
3. The orchestrator opens `../sandbox-ABC-123` as a worktree, distills code, rewrites the prompt with auto-steering, and tells the editor to call `github`, `jira`, `sonarqube` MCP servers **in parallel**.
4. When the developer rejects an action, call `capture_behavior_feedback` — the rule is now baked into every future prompt.
5. Finish with `generate_task_metrics_report` to print a USD invoice for the session.

## Safety

- All shell exec goes through `Sandbox.runSafe` (denylist + path scoping).
- Worktree path scope blocks edits outside the sandbox.
- StdIO transport reserves stdout for JSON-RPC; logs go to stderr + file.