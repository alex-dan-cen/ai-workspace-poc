import { resolve } from "node:path";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { Logger, Telemetry } from "./utils/logger.js";
import { Sandbox } from "./utils/sandbox.js";
import { Distiller } from "./utils/distiller.js";
import { BehaviorTracker } from "./utils/tracker.js";
import { MCPDownstream, type DownstreamId } from "./utils/mcp-client.js";

/**
 * Preset Agents.
 *
 * Each agent = a fixed system role + a fixed downstream-tool sequence.
 * The orchestrator drives them via `Promise.all` where independent.
 * Returns a structured execution report instead of opening a chat loop —
 * the host editor (or a parent LLM) consumes this report.
 */

export interface AgentReport {
  agent: string;
  ticketId: string;
  sandboxPath: string;
  steps: Array<{ tool: string; ok: boolean; summary: string; data?: unknown }>;
  plan?: string;
  patchPath?: string;
}

function step(agent: string, tool: string, ok: boolean, summary: string, data?: unknown) {
  Logger.info(`Agent:${agent}`, `${tool} → ${ok ? "ok" : "FAIL"} :: ${summary}`);
  return { tool, ok, summary, ...(data !== undefined ? { data } : {}) };
}

async function safeCall(
  id: DownstreamId,
  tool: string,
  args: Record<string, unknown>,
  sessionId: string,
) {
  try {
    const data = await MCPDownstream.call(id, tool, args, sessionId);
    return { ok: true as const, data };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
}


async function safeCallAny(
  id: DownstreamId,
  tools: string[],
  argsByTool: (tool: string) => Record<string, unknown>,
  sessionId: string,
) {
  let lastErr = "no candidates";
  for (const t of tools) {
    const r = await safeCall(id, t, argsByTool(t), sessionId);
    if (r.ok) return { ...r, tool: t };
    lastErr = r.error;
  }
  return { ok: false as const, error: lastErr, tool: tools[tools.length - 1] ?? "" };
}
/**
 * 
/**
 * Best-effort: pull a plain-text prompt and a list of file paths out of a
 * Jira ticket payload. Different Jira MCP servers shape responses slightly
 * differently, so we look in the most common spots and degrade gracefully.
 */
function extractFromJira(jiraData: unknown): { prompt: string; files: string[] } {
  try {
    const text = JSON.stringify(jiraData);
    // ATTACHED FILES: pull anything that looks like a src path
    const fileMatches = text.match(/\b(?:src|app|lib|packages|components|pages|routes|tests?)\/[A-Za-z0-9_\-./]+\.[A-Za-z]{1,6}\b/g) ?? [];
    const files = Array.from(new Set(fileMatches)).slice(0, 20);

    // PROMPT: prefer fields.summary + fields.description, fall back to raw text.
    const j = jiraData as { fields?: { summary?: string; description?: unknown } } | null;
    const summary = j?.fields?.summary ?? "";
    const description =
      typeof j?.fields?.description === "string"
        ? j!.fields!.description
        : JSON.stringify(j?.fields?.description ?? "");
    const prompt = [summary, description].filter(Boolean).join("\n\n") || text.slice(0, 4000);
    return { prompt, files };
  } catch {
    return { prompt: "", files: [] };
  }
}

/** Read every file changed on the worktree branch (vs main) — used when the user gave nothing. */
function gitChangedFiles(worktreePath: string): string[] {
  try {
    const out = Sandbox.runSafe(
      `git diff --name-only $(git merge-base HEAD main 2>/dev/null || echo HEAD~1) HEAD`,
      { cwd: worktreePath, scopeRoot: worktreePath },
    );
    return out.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30);
  } catch {
    return [];
  }
}

/* ──────────────────────────── DEVELOPER AGENT ──────────────────────────── */
export async function agentDeveloper(input: {
  projectRoot: string;
  ticketId: string;
  targetFiles?: string[];
  rawPrompt?: string;
  sessionId: string;
}): Promise<AgentReport> {
  const root = resolve(input.projectRoot);
  const sandbox = Sandbox.createWorktree(root, input.ticketId);
  const steps: AgentReport["steps"] = [];

  // 1. Pull ticket from Jira (always — it's also our fallback source for prompt+files)
  // 1. Pull ticket from Jira (always — it's also our fallback source for prompt+files).
  // Different Jira MCP servers expose this under different tool names, so try the
  // common variants and also pass the ticket id under multiple common arg keys.
  const jira = await safeCallAny(
    "jira",
    ["jira_get_issue", "get_issue", "get-issue", "issue.get"],
    () => ({ issueKey: input.ticketId, issueIdOrKey: input.ticketId, key: input.ticketId }),
    input.sessionId,
  );
  steps.push(step("developer", `jira.${jira.tool}`, jira.ok,
    jira.ok ? `Loaded ${input.ticketId}` : `Jira error: ${jira.error}`,
    jira.ok ? jira.data : undefined,
  ));

  // 2. RESOLVE inputs the caller didn't supply.
  const fromJira = jira.ok ? extractFromJira(jira.data) : { prompt: "", files: [] };
  const effectivePrompt =
    (input.rawPrompt && input.rawPrompt.trim()) ||
    fromJira.prompt ||
    `Implement the acceptance criteria of ticket ${input.ticketId}.`;
  const effectiveFiles =
    (input.targetFiles && input.targetFiles.length > 0 && input.targetFiles) ||
    (fromJira.files.length > 0 ? fromJira.files : gitChangedFiles(sandbox.worktreePath));
  steps.push(step("developer", "resolve.inputs", true,
    `prompt: ${input.rawPrompt ? "user" : fromJira.prompt ? "jira" : "default"} · files: ${input.targetFiles?.length ? "user" : fromJira.files.length ? "jira" : "git-diff"} (${effectiveFiles.length})`));

  // 3. Pull repo context from GitHub in parallel with distilling local files
  const [ghRepo, distilled] = await Promise.all([
    safeCall("github", "search_code", { q: `repo:org/repo ${input.ticketId}` }, input.sessionId),
    Promise.resolve(Distiller.distillMany(effectiveFiles.map((f) => join(sandbox.worktreePath, f)))),
  ]);
  steps.push(step("developer", "github.search_code", ghRepo.ok,
    ghRepo.ok ? `Repo context fetched` : `GitHub error: ${ghRepo.error}`));
  steps.push(step("developer", "distiller.distillMany", true,
    `Distilled ${distilled.length} files (truncated: ${distilled.filter((d) => d.truncated).length})`));

  // 4. Auto-steering (always pulls .clinerules + learned rules from this project)
  const steered = BehaviorTracker.applySteering(root, effectivePrompt);

  // 5. Build a deterministic implementation plan
  const plan = [
    `# Implementation plan for ${input.ticketId}`,
    ``,
    `## Context`,
    `- Sandbox worktree: ${sandbox.worktreePath}`,
    `- Branch: ${sandbox.branch}`,
    `- Files in scope: ${effectiveFiles.join(", ") || "(none — first run, no diff yet)"}`,
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
export async function agentReviewer(input: {
  projectRoot: string;
  ticketId: string;
  prNumber?: number;
  owner?: string;
  repo?: string;
  sessionId: string;
}): Promise<AgentReport> {
  const root = resolve(input.projectRoot);
  const sandbox = Sandbox.createWorktree(root, input.ticketId);
  const steps: AgentReport["steps"] = [];

  // Pull PR diff + Sonar issues IN PARALLEL
  const sonarConfigured = Boolean(process.env.SONARQUBE_URL && process.env.SONARQUBE_TOKEN);
  const [pr, sonar] = await Promise.all([
    input.prNumber && input.owner && input.repo
      ? safeCall("github", "get_pull_request_files",
          { owner: input.owner, repo: input.repo, pull_number: input.prNumber }, input.sessionId)
      : Promise.resolve({ ok: false as const, error: "missing prNumber/owner/repo" }),
    sonarConfigured
      ? safeCall("sonarqube", "search_issues",
          { projectKey: process.env.SONARQUBE_PROJECT_KEY ?? "" }, input.sessionId)
      : Promise.resolve({ ok: true as const, data: { skipped: "sonarqube not configured" } }),
  ]);

  steps.push(step("reviewer", "github.get_pull_request_files", pr.ok,
    pr.ok ? `Loaded PR #${input.prNumber}` : `GitHub error: ${pr.error}`,
    pr.ok ? pr.data : undefined));
  steps.push(step("reviewer", "sonarqube.search_issues", sonar.ok,
    sonar.ok
      ? (sonarConfigured ? `Loaded Sonar issues` : `Skipped (sonarqube not configured)`)
      : `Sonar error: ${sonar.error}`,
    sonar.ok ? sonar.data : undefined));

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
export async function agentRefactor(input: {
  projectRoot: string;
  ticketId: string;
  targetFiles?: string[];
  rawPrompt?: string;
  sessionId: string;
}): Promise<AgentReport> {
  const root = resolve(input.projectRoot);
  const sandbox = Sandbox.createWorktree(root, input.ticketId);
  const steps: AgentReport["steps"] = [];

  const files =
    (input.targetFiles && input.targetFiles.length > 0 && input.targetFiles) ||
    gitChangedFiles(sandbox.worktreePath);
  const prompt = input.rawPrompt?.trim() || `Refactor for clarity, preserve public API.`;

  // Distill + Sonar in parallel
  const sonarConfigured = Boolean(process.env.SONARQUBE_URL && process.env.SONARQUBE_TOKEN);
  const [distilled, sonar] = await Promise.all([
    Promise.resolve(Distiller.distillMany(files.map((f) => join(sandbox.worktreePath, f)))),
    sonarConfigured
      ? safeCall("sonarqube", "search_issues",
          { projectKey: process.env.SONARQUBE_PROJECT_KEY ?? "", files }, input.sessionId)
      : Promise.resolve({ ok: true as const, data: { skipped: "sonarqube not configured" } }),
  ]);

  steps.push(step("refactor", "distiller", true, `Distilled ${distilled.length} files`));
  steps.push(step("refactor", "sonarqube.search_issues", sonar.ok,
    sonar.ok
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
export async function runSquad(input: {
  projectRoot: string;
  ticketId: string;
  targetFiles: string[];
  rawPrompt: string;
  prNumber?: number;
  owner?: string;
  repo?: string;
  agents: Array<"developer" | "reviewer" | "refactor">;
  sessionId: string;
}): Promise<AgentReport[]> {
  const jobs = input.agents.map((a) => {
    if (a === "developer") return agentDeveloper(input);
    if (a === "reviewer") return agentReviewer(input);
    return agentRefactor(input);
  });
  return Promise.all(jobs);
}