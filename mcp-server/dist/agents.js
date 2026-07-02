import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { Logger } from "./utils/logger.js";
import { Sandbox } from "./utils/sandbox.js";
import { Distiller } from "./utils/distiller.js";
import { BehaviorTracker } from "./utils/tracker.js";
import { MCPDownstream } from "./utils/mcp-client.js";
function step(agent, tool, ok, summary, data) {
    Logger.info(`Agent:${agent}`, `${tool} → ${ok ? "ok" : "FAIL"} :: ${summary}`);
    return { tool, ok, summary, ...(data !== undefined ? { data } : {}) };
}
async function safeCall(id, tool, args, sessionId) {
    try {
        const data = await MCPDownstream.call(id, tool, args, sessionId);
        const r = data;
        const errText = r?.content?.map((c) => c.text ?? "").join("").trim() ?? "";
        const isErr = r?.isError === true ||
            Boolean(r?.metadata?.errorType) ||
            (typeof r?.metadata?.statusCode === "number" && r.metadata.statusCode >= 400) ||
            /^error[:\s]/i.test(errText);
        if (isErr) {
            const msg = errText || r?.metadata?.errorDetails?.message || "MCP tool returned an error";
            return { ok: false, error: msg };
        }
        return { ok: true, data };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
/**
 * Try a list of candidate tool names against a downstream server and return
 * the first one that succeeds. Different MCP server implementations expose
 * different tool names for the same operation (e.g. Jira: `get_issue` vs
 * `jira_get_issue` vs `get-issue`).
 */
async function safeCallAny(id, tools, argsByTool, sessionId) {
    let lastErr = "no candidates";
    for (const t of tools) {
        const r = await safeCall(id, t, argsByTool(t), sessionId);
        if (r.ok)
            return { ...r, tool: t };
        lastErr = r.error;
    }
    return { ok: false, error: lastErr, tool: tools[tools.length - 1] ?? "" };
}
/**
 * Best-effort: pull a plain-text prompt and a list of file paths out of a
 * Jira ticket payload. Different Jira MCP servers shape responses slightly
 * differently, so we look in the most common spots and degrade gracefully.
 */
/** Walk an Atlassian Document Format node and concatenate all text runs. */
function adfToPlainText(node) {
    if (!node)
        return "";
    if (typeof node === "string")
        return node;
    const n = node;
    const kids = Array.isArray(n.content) ? n.content.map(adfToPlainText).join("") : "";
    const self = typeof n.text === "string" ? n.text : "";
    const block = n.type && ["paragraph", "heading", "listItem", "bulletList", "orderedList"].includes(n.type);
    return self + kids + (block ? "\n" : "");
}
function extractFromJira(jiraData) {
    try {
        // MCP passthrough servers wrap the real payload as { content: [{ type: "text", text: "..." }] }
        // where `text` is a JSON string (we asked for outputFormat: json). Unwrap it.
        let payload = jiraData;
        const wrap = jiraData;
        if (wrap?.content?.length) {
            const joined = wrap.content.map((c) => c.text ?? "").join("");
            try {
                payload = JSON.parse(joined);
            }
            catch {
                payload = joined;
            }
        }
        // PROMPT: summary + description as plain text (ADF → text if needed).
        const j = payload;
        const summary = j?.fields?.summary ?? "";
        const rawDesc = j?.fields?.description;
        const description = typeof rawDesc === "string" ? rawDesc : adfToPlainText(rawDesc).trim();
        const prompt = [summary, description].filter(Boolean).join("\n\n") || (typeof payload === "string" ? payload : JSON.stringify(payload)).slice(0, 4000);
        // FILES: only pull paths mentioned in the plain-text prompt (not in ADF metadata).
        const fileMatches = prompt.match(/\b(?:src|app|lib|packages|components|pages|routes|tests?)\/[A-Za-z0-9_\-./]+\.[A-Za-z]{1,6}\b/g) ?? [];
        const files = Array.from(new Set(fileMatches)).slice(0, 20);
        return { prompt, files };
    }
    catch {
        return { prompt: "", files: [] };
    }
}
/** Read every file changed on the worktree branch (vs main) — used when the user gave nothing. */
function gitChangedFiles(worktreePath) {
    try {
        const out = Sandbox.runSafe(`git diff --name-only $(git merge-base HEAD main 2>/dev/null || echo HEAD~1) HEAD`, { cwd: worktreePath, scopeRoot: worktreePath });
        return out.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30);
    }
    catch {
        return [];
    }
}
/* ──────────────────────────── DEVELOPER AGENT ──────────────────────────── */
export async function agentDeveloper(input) {
    const root = resolve(input.projectRoot);
    const sandbox = Sandbox.createWorktree(root, input.ticketId);
    const steps = [];
    // 1. Pull ticket from Jira. This server exposes a REST passthrough
    // (jira_get / jira_post / ...), NOT semantic tools. We hit the v3 issue
    // endpoint directly and ask for JSON so downstream extraction works.
    const jira = await safeCallAny("jira", ["jira_get"], () => ({
        path: `/rest/api/3/issue/${input.ticketId}`,
        queryParams: { fields: "summary,description,attachment,issuetype,status" },
        outputFormat: "json",
    }), input.sessionId);
    steps.push(step("developer", `jira.${jira.tool}`, jira.ok, jira.ok ? `Loaded ${input.ticketId}` : `Jira error: ${jira.error}`, jira.ok ? jira.data : undefined));
    // 2. RESOLVE inputs the caller didn't supply.
    //    When Jira gave us a real prompt we TRUST it and ignore caller-supplied
    //    targetFiles (Cline auto-injects them from workspace scan; for a "new
    //    component" ticket this points at the wrong file and derails the agent).
    const fromJira = jira.ok ? extractFromJira(jira.data) : { prompt: "", files: [] };
    const jiraHasPrompt = Boolean(fromJira.prompt.trim());
    const effectivePrompt = fromJira.prompt ||
        (input.rawPrompt && input.rawPrompt.trim()) ||
        `Implement the acceptance criteria of ticket ${input.ticketId}.`;
    let filesSource;
    let effectiveFiles;
    if (fromJira.files.length > 0) {
        effectiveFiles = fromJira.files;
        filesSource = "jira";
    }
    else if (jiraHasPrompt) {
        // Jira spoke, but named no files → this is a NEW feature. Do not fall
        // back to caller/git diff; let the plan tell the coder to create files.
        effectiveFiles = [];
        filesSource = "none";
    }
    else if (input.targetFiles && input.targetFiles.length > 0) {
        effectiveFiles = input.targetFiles;
        filesSource = "user";
    }
    else {
        effectiveFiles = gitChangedFiles(sandbox.worktreePath);
        filesSource = "git-diff";
    }
    steps.push(step("developer", "resolve.inputs", true, `prompt: ${fromJira.prompt ? "jira" : input.rawPrompt ? "user" : "default"} · files: ${filesSource} (${effectiveFiles.length})`));
    // 3. Pull repo context from GitHub in parallel with distilling local files
    const [ghRepo, distilled] = await Promise.all([
        safeCall("github", "search_code", { q: `repo:org/repo ${input.ticketId}` }, input.sessionId),
        Promise.resolve(Distiller.distillMany(effectiveFiles.map((f) => join(sandbox.worktreePath, f)))),
    ]);
    steps.push(step("developer", "github.search_code", ghRepo.ok, ghRepo.ok ? `Repo context fetched` : `GitHub error: ${ghRepo.error}`));
    steps.push(step("developer", "distiller.distillMany", true, `Distilled ${distilled.length} files (truncated: ${distilled.filter((d) => d.truncated).length})`));
    // 4. Auto-steering (always pulls .clinerules + learned rules from this project)
    const steered = BehaviorTracker.applySteering(root, effectivePrompt);
    // 5. Build a deterministic implementation plan
    const plan = [
        `# Implementation plan for ${input.ticketId}`,
        ``,
        `## Context`,
        `- Sandbox worktree: ${sandbox.worktreePath}`,
        `- Branch: ${sandbox.branch}`,
        `- Files in scope: ${effectiveFiles.join(", ") || "(none — NEW feature, create the file(s) required by the ticket)"}`,
        ``,
        `## Ticket (from Jira)`,
        effectivePrompt,
        ``,
        `## Steering boundaries`,
        steered,
        ``,
        `## Suggested next steps`,
        `1. Read distilled context above.`,
        `2. Apply changes ONLY inside ${sandbox.worktreePath}.`,
        `3. Commit with Conventional Commits referencing ${input.ticketId}.`,
        `4. Open PR via github MCP create_pull_request.`,
    ].join("\n");
    const planPath = join(sandbox.worktreePath, `.mcp-plan-${input.ticketId}.md`);
    mkdirSync(dirname(planPath), { recursive: true });
    writeFileSync(planPath, plan, "utf-8");
    steps.push(step("developer", "fs.writePlan", true, `Plan written: ${planPath}`));
    return { agent: "developer", ticketId: input.ticketId, sandboxPath: sandbox.worktreePath, steps, plan, patchPath: planPath };
}
/* ──────────────────────────── CODE REVIEWER AGENT ──────────────────────────── */
export async function agentReviewer(input) {
    const root = resolve(input.projectRoot);
    const sandbox = Sandbox.createWorktree(root, input.ticketId);
    const steps = [];
    // Pull PR diff + Sonar issues IN PARALLEL
    const sonarConfigured = Boolean(process.env.SONARQUBE_URL && process.env.SONARQUBE_TOKEN);
    const [pr, sonar] = await Promise.all([
        input.prNumber && input.owner && input.repo
            ? safeCall("github", "get_pull_request_files", { owner: input.owner, repo: input.repo, pull_number: input.prNumber }, input.sessionId)
            : Promise.resolve({ ok: false, error: "missing prNumber/owner/repo" }),
        sonarConfigured
            ? safeCall("sonarqube", "search_issues", { projectKey: process.env.SONARQUBE_PROJECT_KEY ?? "" }, input.sessionId)
            : Promise.resolve({ ok: true, data: { skipped: "sonarqube not configured" } }),
    ]);
    steps.push(step("reviewer", "github.get_pull_request_files", pr.ok, pr.ok ? `Loaded PR #${input.prNumber}` : `GitHub error: ${pr.error}`, pr.ok ? pr.data : undefined));
    steps.push(step("reviewer", "sonarqube.search_issues", sonar.ok, sonar.ok
        ? (sonarConfigured ? `Loaded Sonar issues` : `Skipped (sonarqube not configured)`)
        : `Sonar error: ${sonar.error}`, sonar.ok ? sonar.data : undefined));
    const plan = [
        `# Code Review for ${input.ticketId}`,
        `Sandbox: ${sandbox.worktreePath}`,
        ``,
        `Combine the GitHub diff with SonarQube quality-gate issues above and post the review via`,
        `github.create_pull_request_review with **event: "COMMENT"** (NOT "APPROVE" — GitHub forbids`,
        `approving your own PR, and "COMMENT" works for self-authored PRs too).`,
        ``,
        `Auto-steering rules to enforce while reviewing:`,
        BehaviorTracker.applySteering(root, "review for correctness, security and style"),
    ].join("\n");
    return { agent: "reviewer", ticketId: input.ticketId, sandboxPath: sandbox.worktreePath, steps, plan };
}
/* ──────────────────────────── REFACTOR AGENT ──────────────────────────── */
export async function agentRefactor(input) {
    const root = resolve(input.projectRoot);
    const sandbox = Sandbox.createWorktree(root, input.ticketId);
    const steps = [];
    const files = (input.targetFiles && input.targetFiles.length > 0 && input.targetFiles) ||
        gitChangedFiles(sandbox.worktreePath);
    const prompt = input.rawPrompt?.trim() || `Refactor for clarity, preserve public API.`;
    // Distill + Sonar in parallel
    const sonarConfigured = Boolean(process.env.SONARQUBE_URL && process.env.SONARQUBE_TOKEN);
    const [distilled, sonar] = await Promise.all([
        Promise.resolve(Distiller.distillMany(files.map((f) => join(sandbox.worktreePath, f)))),
        sonarConfigured
            ? safeCall("sonarqube", "search_issues", { projectKey: process.env.SONARQUBE_PROJECT_KEY ?? "", files }, input.sessionId)
            : Promise.resolve({ ok: true, data: { skipped: "sonarqube not configured" } }),
    ]);
    steps.push(step("refactor", "distiller", true, `Distilled ${distilled.length} files`));
    steps.push(step("refactor", "sonarqube.search_issues", sonar.ok, sonar.ok
        ? (sonarConfigured ? `Quality issues fetched` : `Skipped (sonarqube not configured)`)
        : `Sonar error: ${sonar.error}`));
    const plan = [
        `# Refactor plan for ${input.ticketId}`,
        `Sandbox: ${sandbox.worktreePath}`,
        `Files: ${files.join(", ")}`,
        ``,
        `Constraints (preserve public API):`,
        BehaviorTracker.applySteering(root, prompt),
        ``,
        `Heuristics to apply:`,
        `- Extract duplicated logic into helpers.`,
        `- Replace 'any' with typed generics.`,
        `- Move side effects out of pure functions.`,
        `- Keep diffs surgical; one concern per commit.`,
    ].join("\n");
    return { agent: "refactor", ticketId: input.ticketId, sandboxPath: sandbox.worktreePath, steps, plan };
}
/* ──────────────────────── PARALLEL SQUAD RUNNER ──────────────────────── */
export async function runSquad(input) {
    const jobs = input.agents.map((a) => {
        if (a === "developer")
            return agentDeveloper(input);
        if (a === "reviewer")
            return agentReviewer(input);
        return agentRefactor(input);
    });
    return Promise.all(jobs);
}
//# sourceMappingURL=agents.js.map