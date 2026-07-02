# 2. Editor Setup

You install the MCP server **once** locally. Each editor has its own config
file where you point at `dist/index.js`.

## 2.1 Prerequisites

- Node ≥ 18 (`node -v`)
- Git (worktree support — any Git ≥ 2.5)
- A Jira account + API token
- A GitHub Personal Access Token (fine-grained, `repo` + `pull_requests:write`)
- (Optional) SonarQube URL + token

## 2.2 Build once

```bash
cd mcp-server
npm install
npm run build     # produces mcp-server/dist/index.js
```

Re-run `npm run build` any time you edit files under `src/`. In the editor,
toggle the server off/on to reload the fresh `dist/`.

## 2.3 Where to get tokens

| Token | URL | Scope |
| --- | --- | --- |
| GitHub PAT | https://github.com/settings/tokens?type=beta | Repository access to the target repo, `Contents: RW`, `Pull requests: RW`, `Issues: RW`, `Metadata: R` |
| Jira API token | https://id.atlassian.com/manage-profile/security/api-tokens | Label = `mcp-orchestrator` |
| `ATLASSIAN_SITE_NAME` | — | The subdomain only. If Jira is `acenusa.atlassian.net`, the value is `acenusa`. |
| `ATLASSIAN_USER_EMAIL` | — | Your Atlassian login email. |
| SonarQube token | `<sonar-url>/account/security` | Optional. |

## 2.4 Cline (VS Code)

1. Open VS Code → Cline sidebar → gear icon → **MCP Servers** → **Edit MCP Settings**.
2. Paste the block below. Replace the ALL-CAPS placeholders and the absolute
   path to `dist/index.js`.

```json
{
  "mcpServers": {
    "multi-agent-orchestrator": {
      "command": "node",
      "args": ["/ABS/PATH/TO/mcp-server/dist/index.js"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_...",
        "ATLASSIAN_SITE_NAME": "your-subdomain",
        "ATLASSIAN_USER_EMAIL": "you@company.com",
        "ATLASSIAN_API_TOKEN": "atlassian-token"
      },
      "disabled": false,
      "autoApprove": ["parse_audit_log", "generate_task_metrics_report", "downstream_list_tools"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    },
    "jira": {
      "command": "npx",
      "args": ["-y", "@aashari/mcp-server-atlassian-jira"],
      "env": {
        "ATLASSIAN_SITE_NAME": "your-subdomain",
        "ATLASSIAN_USER_EMAIL": "you@company.com",
        "ATLASSIAN_API_TOKEN": "atlassian-token"
      }
    }
  }
}
```

3. Save. Cline reloads automatically. Three green dots on `multi-agent-orchestrator`, `github`, `jira`.

## 2.5 Cursor

Edit `~/.cursor/mcp.json` (create if missing). Same JSON as Cline. Settings → MCP → Reload.

## 2.6 Codex CLI (OpenAI)

Codex reads `~/.codex/mcp.json`. Same structure. After editing:

```bash
codex mcp list        # should show multi-agent-orchestrator
codex mcp reload
```

## 2.7 Claude Desktop

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Same JSON, then **restart** Claude Desktop (Cline/Cursor hot-reload; Claude Desktop does not).

## 2.8 Smoke test

In the editor chat:

```
@multi-agent-orchestrator downstream_list_tools { "server": "github" }
```

Expected: a list of GitHub MCP tools (`get_pull_request`, `create_issue`, …).
If you see `401 Unauthorized`, the GitHub PAT is wrong or missing scopes.

Repeat with `"server": "jira"`.

## 2.9 Per-project setup (target repo)

In every repo you want the agents to work on:

1. `cd /path/to/your-repo && git init` (if not already a Git repo).
2. Add a `.clinerules` file at the root with your team standards. See
   `mcp-server/steering-boilerplates/.clinerules` for a starter.
3. Add a GitHub remote (`git remote add origin git@github.com:org/repo.git`)
   so the reviewer can post on PRs.
4. Add `sandbox-*/` and `.mcp-plan-*.md` to `.gitignore`.