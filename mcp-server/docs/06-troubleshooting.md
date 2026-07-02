# 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Cline shows the server **red** | Wrong path to `dist/index.js` | Use an absolute path; re-run `npm run build`. |
| `Cannot find module …/dist/index.js` | You forgot to build | `cd mcp-server && npm run build`. |
| `401 Unauthorized` on GitHub calls | PAT expired or missing scopes | Regenerate PAT with `Contents RW`, `Pull requests RW`, `Metadata R`. |
| Jira returns empty | `ATLASSIAN_SITE_NAME` contains `https://` | Use only the subdomain (`acenusa`, not `https://acenusa.atlassian.net`). |
| `git worktree add` fails | `projectRoot` is not a git repo | Run `git init` in `projectRoot`. |
| Sandbox contains the mcp-server folder | You accidentally committed `mcp-server/` into `projectRoot` | `git rm -rf --cached mcp-server` in the project repo, add to `.gitignore`, recommit. |
| Cline edits `projectRoot` instead of the sandbox | The LLM ignored the execution contract | Reject the edit. The plan says "use sandboxPath" — re-paste the plan or add a `.clinerules` rule enforcing sandbox scope. |
| `agent_reviewer` posts nothing on the PR | Missing `owner`/`repo`/`prNumber`, or `autoPost: false` | Include all three, and either omit `autoPost` or pass `true`. |
| `create_pull_request_review` fails with "review cannot be blank" | `body` was empty and no inline comments | The auto-poster always sets a body — check the `steps` array for the actual error. |
| Denied commands in the log | The Permission Manager is working | Not a bug. Inspect via `parse_audit_log anomaliesOnly=true`. |
| Invoice says `$0` | Session had no logged tokens | Estimates are `chars/4` from prompt inputs; run a real agent tool first. |

## Restarting a server

In Cline/Cursor: toggle the server off then on in MCP settings. This spawns a
fresh child process — needed after any rebuild.

In Claude Desktop: restart the app.

## Rebuilding after code changes

```bash
cd mcp-server && npm run build
```

Then toggle the server off/on in the editor.

## Where the state lives

| File | Purpose |
| --- | --- |
| `mcp-server/mcp-framework.log` | Every log entry (info/warn/error/audit). |
| `mcp-server/mcp-telemetry.json` | Per-session metrics for the invoice. |
| `<projectRoot>/mcp-behavior-profile.json` | Learned rules per project. |
| `<projectRoot>/.clinerules` | Team standards, hand-authored. |
| `<parent>/sandbox-<TICKET>/` | Git worktree for the ticket. |
| `<sandbox>/.mcp-plan-<TICKET>.md` | The plan the developer agent wrote. |

Delete `mcp-behavior-profile.json` to reset auto-steering for a project.
Delete `mcp-framework.log` and `mcp-telemetry.json` to reset audit + invoices.