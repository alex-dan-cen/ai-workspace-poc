# 🧪 Testing & First Run — Pas cu Pas

## 0. Prerechizite

- Node.js ≥ 18 (`node -v`)
- `git` instalat (worktree-ul are nevoie)
- Un repo Git real în care vrei să rulezi (sandbox-ul = git worktree, nu merge fără git)
- Un editor cu suport MCP: **Cline** (VS Code), **Cursor**, sau **Claude Desktop**

---

## 1. Build local

```bash
cd mcp-server
npm install
npm run build
```

✅ Verifică că s-a creat `mcp-server/dist/index.js`.

---

## 2. Pune cheile (UN SINGUR LOC)

Cheile NU stau în cod. Stau ca **environment variables**, citite de orchestrator și pasate copiilor (Jira/GitHub/Sonar MCP).

### Varianta A — fișier `.env` (recomandat)
```bash
cp .env.example .env
# editează .env cu valorile tale reale
```
Apoi, **înainte să pornești editorul**, în același terminal:
```bash
set -a; source mcp-server/.env; set +a
code .          # sau: cursor . / open -a "Claude"
```
Asta exportă variabilele în procesul editorului, care le moștenește mai departe spre MCP server.

### Varianta B — direct în `mcp_settings.json`
Înlocuiește `"${env:GITHUB_PERSONAL_ACCESS_TOKEN}"` cu valoarea literală. **NU comite fișierul după asta.**

### De unde iei cheile
| Serviciu | URL | Permisiuni |
|---|---|---|
| GitHub PAT | https://github.com/settings/tokens?type=beta | `repo`, `pull_requests:write` |
| Atlassian (Jira+Confluence) | https://id.atlassian.com/manage-profile/security/api-tokens | API Token |
| SonarQube | `<sonar-url>/account/security` | `Execute Analysis` + `Browse` |
| Chrome | — | nu cere token |

---

## 3. Înregistrează serverul în editor

### Cline (VS Code)
1. Deschide VS Code, click pe iconița Cline din sidebar.
2. Settings (⚙) → **MCP Servers** → **Edit MCP Settings**.
3. Lipește conținutul din `mcp_settings.json`, dar înlocuiește calea relativă:
   ```json
   "args": ["/CALE/ABSOLUTA/CATRE/mcp-server/dist/index.js"]
   ```
4. Save → Cline reîncarcă automat.
5. În panoul MCP ar trebui să vezi 5 servere verzi: `multi-agent-orchestrator`, `github`, `jira`, `sonarqube`, `confluence`, `chrome`.

### Cursor
- Edit `~/.cursor/mcp.json` (creează-l dacă nu există) cu același conținut.
- Settings → MCP → Reload.

### Claude Desktop
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Restart la app.

---

## 4. Verificare rapidă (smoke test)

În chatul editorului, scrie pe rând:

### Test 1 — orchestratorul respiră
```
@multi-agent-orchestrator parse_audit_log
```
Așteptat: JSON cu `{ "count": 0, "entries": [] }` (sau orice rânduri vechi).

### Test 2 — descoperă tool-urile downstream
```
@multi-agent-orchestrator downstream_list_tools server="github"
```
Așteptat: listă cu tool-uri GitHub (`get_pull_request`, `create_issue`, etc.). Dacă pică pe „401 Unauthorized" → cheia GitHub e greșită sau lipsește.

Repetă pentru `jira`, `sonarqube`, `confluence`, `chrome`.

### Test 3 — citește un ticket real Jira
```
@multi-agent-orchestrator downstream_call
  server="jira"
  tool="get_issue"
  args={"issueKey":"ABC-123"}
```
Așteptat: JSON cu titlul + descrierea ticketului.

---

## 5. Demo cu agenții preset

Asta e ce arăți colegilor.

### A) Developer Agent — implementează un ticket
```
@multi-agent-orchestrator agent_developer
  projectRoot="/Users/tu/proiect"
  ticketId="ABC-123"
  targetFiles=["src/api/users.ts","src/api/auth.ts"]
  rawPrompt="Implementează acceptance criteria din ABC-123. Folosește Zod pentru validare."
```
Ce se întâmplă:
1. Creează `../sandbox-ABC-123` ca git worktree pe branch-ul `feature/ABC-123`.
2. Cheamă Jira → citește ticketul.
3. În paralel: cheamă GitHub pentru context + distilează fișierele.
4. Aplică regulile din `.clinerules` + behavior profile.
5. Scrie `.mcp-plan-ABC-123.md` în sandbox.

### B) Code Reviewer — review pe un PR
```
@multi-agent-orchestrator agent_reviewer
  projectRoot="/Users/tu/proiect"
  ticketId="ABC-123"
  owner="organizatia-ta"
  repo="repo-ul-tau"
  prNumber=42
```
Ce se întâmplă: pull PR diff din GitHub **în paralel** cu Sonar issues, întoarce planul de review.

### C) Refactor Agent
```
@multi-agent-orchestrator agent_refactor
  projectRoot="/Users/tu/proiect"
  ticketId="REFACTOR-7"
  targetFiles=["src/legacy/payment.ts"]
  rawPrompt="Extrage logica duplicată, păstrează API public."
```

### D) Squad — toți trei deodată
```
@multi-agent-orchestrator run_squad
  projectRoot="/Users/tu/proiect"
  ticketId="ABC-123"
  targetFiles=["src/api/users.ts"]
  rawPrompt="Implementează ABC-123 și fă review automat."
  agents=["developer","refactor","reviewer"]
  owner="org" repo="repo" prNumber=42
```
Toți 3 agenții rulează **în paralel** (`Promise.all`).

---

## 6. Învățarea (auto-steering)

Când Claude face ceva greșit și-l corectezi, capturează manual regula:
```
@multi-agent-orchestrator capture_behavior_feedback
  projectRoot="/Users/tu/proiect"
  source="rejection"
  rule="Nu folosi 'any', preferă generics + Zod."
```
Din momentul ăsta, regula apare automat la fiecare prompt viitor (în `mcp-behavior-profile.json`).

---

## 7. Invoice la final

```
@multi-agent-orchestrator generate_task_metrics_report
```
Arată: tokeni in/out, tool hops, downstream calls, cost USD per sesiune. Perfect pentru slide-ul „cât costă un task".

---

## 8. Audit log

```
@multi-agent-orchestrator parse_audit_log anomaliesOnly=true
```
Vezi comenzile blocate de Permission Manager (`rm -rf`, `sudo`, path-uri în afara sandbox-ului). Bun pentru demo de security.

---

## 🆘 Troubleshooting

| Simptom | Cauză | Fix |
|---|---|---|
| Server „red" în Cline | path greșit la `dist/index.js` | folosește cale absolută |
| `Cannot find module` | n-ai rulat `npm run build` | `cd mcp-server && npm run build` |
| `401 Unauthorized` la GitHub | token expirat / fără scope | regenerează PAT cu scope `repo` |
| Jira întoarce gol | `ATLASSIAN_SITE_NAME` are `https://` | scrie doar subdomeniul (`yourcompany`) |
| „git worktree add" eșuează | `projectRoot` nu e repo | `git init` în proiect |
| Comenzi blocate | Permission Manager funcționează corect | verifică `parse_audit_log` |
| Niciun cost în invoice | tokenii sunt estimați din chars/4 | normal — e o aproximare, nu billing real |

---

## 📦 Ce să arăți colegilor

1. **Slide 1**: `.clinerules` în repo → un singur fișier care setează standardele
2. **Slide 2**: `agent_developer` rulând pe ticket real Jira → arată sandbox-ul creat
3. **Slide 3**: respingi ceva → `capture_behavior_feedback` → next prompt are deja regula
4. **Slide 4**: `run_squad` cu 3 agenți în paralel → arată log-ul cu hops paralele
5. **Slide 5**: `generate_task_metrics_report` → invoice cu cost USD
6. **Slide 6**: `parse_audit_log anomaliesOnly=true` → security guardrails