# Workflow: fix → commit → review

> Rulează **local pe laptopul tău**. Tokenurile le pui **direct în
> `cline_mcp_settings.json`**, în blocul `env` al fiecărui server. Nu mai
> trebuie nimic în `~/.zshrc`. După ce salvezi JSON-ul, Cline reîncarcă
> singur serverele.

## Pasul 1 — De unde iei tokenurile

1. **GitHub PAT** → `https://github.com/settings/tokens?type=beta`
   - Repository access: `alex-dan-cen/ai-workspace-poc`
   - Permissions: Contents (RW), Pull requests (RW), Issues (RW), Metadata (R)
   - Copy `ghp_...`.

2. **Jira API token** → `https://id.atlassian.com/manage-profile/security/api-tokens`
   - Label: `mcp-orchestrator` → Create → copy.
   - `ATLASSIAN_SITE_NAME` = subdomain-ul (dacă Jira e `acenusa.atlassian.net`,
     scrii `acenusa`).
   - `ATLASSIAN_USER_EMAIL` = emailul tău Atlassian.

Sonar e opțional — sări peste, pasul se marchează `Skipped`.

## Pasul 2 — Lipește în `cline_mcp_settings.json`

În Cline: rotița → MCP Servers → **Edit MCP Settings**. Lipește exact
blocul de mai jos și înlocuiește doar valorile `PUNE_AICI_...`. Restul
(numele câmpurilor, comenzile) le lași ca atare.

```json
{
  "mcpServers": {
    "multi-agent-orchestrator": {
      "command": "node",
      "args": ["/Users/acenusa1/Downloads/ai-mcp-poc/mcp-server/dist/index.js"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "PUNE_AICI_GHP_TOKEN",
        "ATLASSIAN_SITE_NAME": "PUNE_AICI_SUBDOMAIN",
        "ATLASSIAN_USER_EMAIL": "PUNE_AICI_EMAIL",
        "ATLASSIAN_API_TOKEN": "PUNE_AICI_JIRA_TOKEN"
      },
      "disabled": false,
      "autoApprove": ["parse_audit_log", "generate_task_metrics_report", "downstream_list_tools"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "PUNE_AICI_GHP_TOKEN"
      },
      "disabled": false
    },
    "jira": {
      "command": "npx",
      "args": ["-y", "@aashari/mcp-server-atlassian-jira"],
      "env": {
        "ATLASSIAN_SITE_NAME": "PUNE_AICI_SUBDOMAIN",
        "ATLASSIAN_USER_EMAIL": "PUNE_AICI_EMAIL",
        "ATLASSIAN_API_TOKEN": "PUNE_AICI_JIRA_TOKEN"
      },
      "disabled": false
    }
  }
}
```

Salvează fișierul. Cline arată bulină verde pe toate trei (orchestrator,
github, jira). Dacă rămâne roșu pe vreunul, click pe el → vezi log-ul
(de obicei: token greșit sau cale greșită la `dist/index.js`).

## Two-phase loop

Phase 1 fix local pe `src/Cart.ts`, commit & push, Phase 2 review pe PR.
Ticket-ul tău în Jira e **SCRUM-1**, deci `ticketId: "SCRUM-1"` peste tot.

## Build MCP server (după orice modificare în `mcp-server/src/`)

```bash
cd mcp-server
npm install   # doar prima dată
npm run build
```

Apoi în Cline: toggle off → on pe `multi-agent-orchestrator` ca să încarce
noul `dist/`.

## Pregătirea repo-ului `demo-target` (o singură dată)

`demo-target` trebuie să fie un repo git real, conectat la GitHub, ca să
poți deschide PR.

```bash
cd /Users/acenusa1/Downloads/ai-mcp-poc/mcp-server/demo-target
# Dacă nu e încă git repo, orchestratorul îl inițializează automat la
# primul run. Dar pentru PR pe GitHub ai nevoie de remote:
gh repo create alex-dan-cen/ai-workspace-poc --private --source=. --push
# sau manual:
#   git init -b main && git add -A && git commit -m "init"
#   git remote add origin git@github.com:alex-dan-cen/ai-workspace-poc.git
#   git push -u origin main
```

---

## Phase 1 — fix bugs în `src/Cart.ts` (înainte de commit)

Tu modifici `src/Cart.ts` cum vrei (sau lași varianta cu buguri). Apoi în
Cline rulezi developer-ul, care:
- citește ticket-ul **SCRUM-1** din Jira (titlu + descriere = prompt),
- aplică `.clinerules` ca steering,
- distilează `Cart.ts`,
- scrie planul de fix în sandbox-ul izolat.

```
@multi-agent-orchestrator agent_developer
{
  "projectRoot": "/Users/acenusa1/Downloads/ai-mcp-poc/mcp-server/demo-target",
  "ticketId": "SCRUM-1",
  "targetFiles": ["src/Cart.ts"],
  "rawPrompt": "Fix all bugs in Cart.ts. Apply .clinerules."
}
```

> `rawPrompt` e **opțional** — dacă-l omiți, agent_developer folosește
> automat summary + description din ticket-ul SCRUM-1 ca prompt.

Ce primești înapoi:
- `sandboxPath` → `…/mcp-server/sandbox-SCRUM-1` (worktree izolat pe branch
  `feature/SCRUM-1`).
- `plan` → planul de fix scris în `.mcp-plan-SCRUM-1.md` în sandbox.
- `distilledContext` → conținutul `Cart.ts` distilat + `.clinerules` aplicate
  ca steering.

Cline va aplica patch-ul în sandbox. Tu copiezi modificările în
`demo-target/src/Cart.ts`, sau lucrezi direct în worktree:

```bash
cd /Users/acenusa1/Downloads/ai-mcp-poc/mcp-server/sandbox-SCRUM-1
# edit src/Cart.ts după plan
git add src/Cart.ts
git commit -m "fix(SCRUM-1): cart bugs"
git push -u origin feature/SCRUM-1
gh pr create --base main --head feature/SCRUM-1 \
  --title "SCRUM-1 fix cart" --body "Fixes per agent plan"
```

Notează `prNumber` returnat de `gh pr create` (ex. `1`) — îl folosești la Phase 2.

---

## Phase 2 — review pe PR

După ce PR-ul e deschis pe GitHub, rulezi reviewer-ul. El cere prin GitHub
MCP diff-ul PR-ului în paralel cu Sonar (dacă e configurat) și-ți întoarce
planul de review:

```
@multi-agent-orchestrator agent_reviewer
{
  "projectRoot": "/Users/acenusa1/Downloads/ai-mcp-poc/mcp-server/demo-target",
  "ticketId": "SCRUM-1",
  "owner": "alex-dan-cen",
  "repo": "ai-workspace-poc",
  "prNumber": 1
}
```

Ce primești:
- `steps[0]` → `github.get_pull_request_files` cu diff-ul real al PR-ului.
- `steps[1]` → Sonar (Skipped dacă nu e configurat — OK).
- `plan` → ce comentarii să posteze pe PR, derivate din `.clinerules`.

Ca să posteze efectiv review-ul pe GitHub, lași Cline să cheme apoi
`github.create_pull_request_review` cu comentariile din plan.

---

## Bonus — rulează ambii agenți în paralel

```
@multi-agent-orchestrator run_squad
{
  "projectRoot": "/Users/acenusa1/Downloads/ai-mcp-poc/mcp-server/demo-target",
  "ticketId": "SCRUM-1",
  "targetFiles": ["src/Cart.ts"],
  "agents": ["developer", "reviewer"],
  "owner": "alex-dan-cen",
  "repo": "ai-workspace-poc",
  "prNumber": 1
}
```

## Cost / audit

```
@multi-agent-orchestrator generate_task_metrics_report {}
@multi-agent-orchestrator parse_audit_log { "ticketId": "SCRUM-1" }
```