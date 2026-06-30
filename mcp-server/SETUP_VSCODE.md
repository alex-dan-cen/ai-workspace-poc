# Cum rulezi MCP-ul din VS Code — pas cu pas

## De ce nu apare nimic la Cline când dai pe rotiță

Cline citește serverele MCP dintr-un fișier JSON. Dacă fișierul e gol
sau lipsește calea absolută către `dist/index.js`, lista e goală. Rotița
deschide doar UI-ul; nu adaugă servere automat.

Există 3 moduri să rulezi MCP-ul din VS Code:

| Mod | Când îl folosești |
|-----|-------------------|
| **A. Cline extension** | Vrei chat cu agentul direct în VS Code |
| **B. Continue / Roo Code** | Alternativă la Cline, același JSON |
| **C. Claude Desktop** | Cel mai stabil, recomandat pt. demo |

Toate trei folosesc aceeași comandă: `node /cale/absoluta/dist/index.js`.

---

## Pasul 0 — Build (o singură dată)

```bash
cd mcp-server
npm install
npm run build
# verifică că s-a creat fișierul:
ls -la dist/index.js
pwd   # copiază această cale, o folosești mai jos
```

---

## Pasul 1 — Configurează Cline în VS Code

1. Instalează extensia **Cline** (saoudrizwan.claude-dev) din Marketplace.
2. Click pe iconița Cline din sidebar → rotița (Settings) → tab **MCP Servers**
   → butonul **"Edit MCP Settings"** (sau "Configure MCP Servers").
3. Se deschide `cline_mcp_settings.json`. Lipește:

```json
{
  "mcpServers": {
    "multi-agent-orchestrator": {
      "command": "node",
      "args": ["/CALEA/TA/ABSOLUTĂ/mcp-server/dist/index.js"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "PUNE_AICI_GHP_TOKEN",
        "ATLASSIAN_SITE_NAME": "PUNE_AICI_SUBDOMAIN",
        "ATLASSIAN_USER_EMAIL": "PUNE_AICI_EMAIL",
        "ATLASSIAN_API_TOKEN": "PUNE_AICI_JIRA_TOKEN"
      },
      "disabled": false,
      "autoApprove": []
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

4. Salvează fișierul. Cline reîncarcă automat. În tab-ul MCP Servers ar trebui
   să vezi `multi-agent-orchestrator` cu bulină verde și lista de tool-uri
   (`agent_developer`, `agent_reviewer`, `agent_refactor`, `run_squad`, ...).

**Dacă rămâne roșu:** click pe el → vezi logul. Cele mai dese cauze:
- cale greșită la `dist/index.js` (trebuie absolută, nu `~`)
- n-ai rulat `npm run build`
- versiune Node < 18 → `node -v`

---

## Pasul 2 — Test fără niciun token (smoke test)

Am pus un fișier dummy cu bug-uri intenționate:
`mcp-server/demo-target/src/Cart.ts`
și un steering file `mcp-server/demo-target/.clinerules`.

În chat-ul Cline scrie:

```
@multi-agent-orchestrator agent_reviewer
  projectRoot="/CALEA/TA/mcp-server/demo-target"
  targetFiles=["src/Cart.ts"]
  rawPrompt="Review acest fișier și listează problemele"
```

Agentul va:
1. citi `.clinerules` din `demo-target/`
2. distila `Cart.ts` (ca să nu consume tokeni inutil)
3. îți întoarce un raport cu bug-urile (==, mutație, catch gol, magic number).

Dacă vrei și fix automat:

```
@multi-agent-orchestrator agent_refactor
  projectRoot="/CALEA/TA/mcp-server/demo-target"
  targetFiles=["src/Cart.ts"]
```

Agentul propune diff-ul. Cline îți cere confirmare înainte să-l scrie pe disc.

---

## Pasul 3 — Conectează GitHub (token + review pe repo real)

### 3.1 Generează tokenul
1. GitHub → click pe avatar → **Settings** → **Developer settings** (jos de tot) → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Resource owner**: tu sau organizația.
3. **Repository access**: *Only select repositories* → alege repo-ul tău.
4. **Permissions** → *Repository permissions*:
   - Contents: **Read & write** (pt PR-uri)
   - Pull requests: **Read & write**
   - Issues: **Read & write**
   - Metadata: **Read** (auto)
5. Generate → copiază `github_pat_...` (apare o singură dată!).

### 3.2 Pune-l în config
În `cline_mcp_settings.json` înlocuiește `ghp_xxx` cu tokenul. Restart Cline (rotița → Restart MCP).

### 3.3 Test pe repo real

```
@multi-agent-orchestrator agent_reviewer
  projectRoot="/cale/catre/repoul-tau"
  rawPrompt="Review ultimul PR deschis pe userul/repo"
```

Sau direct:
```
@multi-agent-orchestrator downstream_call
  server="github"
  tool="list_pull_requests"
  args={"owner":"userul-tau","repo":"numele-repo","state":"open"}
```

Dacă întoarce JSON cu PR-uri → tokenul merge.

---

## Pasul 4 — Conectează Jira

### 4.1 Generează tokenul
1. https://id.atlassian.com/manage-profile/security/api-tokens → **Create API token**.
2. Label: `mcp-orchestrator` → Create → copiază.

### 4.2 Config
În `cline_mcp_settings.json`:
- `ATLASSIAN_API_TOKEN`: tokenul de mai sus
- `ATLASSIAN_EMAIL`: emailul tău Atlassian
- `ATLASSIAN_DOMAIN`: ex. `firma.atlassian.net` (fără https://)

Restart Cline.

### 4.3 Test
```
@multi-agent-orchestrator agent_developer
  projectRoot="/cale/catre/repoul-tau"
  ticketId="ABC-123"
```
(unde `ABC-123` e un ticket real din boardul tău).

Agentul: citește ticketul → derivă fișierele țintă din descriere/diff →
aplică `.clinerules` → propune plan + cod.

---

## Pasul 5 — SonarQube (opțional, la final)

1. SonarCloud/SonarQube → My Account → Security → Generate Token.
2. `SONAR_TOKEN` + `SONAR_HOST_URL` în config.
3. `run_squad` îl va folosi automat pentru issue-uri de calitate.

---

## Checklist de demo (5 minute)

- [ ] `npm run build` rulat, există `dist/index.js`
- [ ] Cline vede `multi-agent-orchestrator` cu verde
- [ ] `agent_reviewer` pe `demo-target/src/Cart.ts` întoarce raport
- [ ] `agent_refactor` pe același fișier propune diff
- [ ] `downstream_call server="github" tool="list_pull_requests"` întoarce JSON
- [ ] `agent_developer` cu `ticketId="ABC-123"` citește din Jira

Dacă oricare pas pică, copiază eroarea din logul Cline și ți-o explic exact.