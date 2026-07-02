#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Logger, LogParser, Telemetry } from "./utils/logger.js";
import { Sandbox, PermissionDeniedError } from "./utils/sandbox.js";
import { Distiller } from "./utils/distiller.js";
import { BehaviorTracker } from "./utils/tracker.js";
import { MCPDownstream } from "./utils/mcp-client.js";
import { agentDeveloper, agentReviewer, agentRefactor, runSquad } from "./agents.js";
/* ────────────────────────────────────────────────────────────── *
 *  Multi-Agent MCP Orchestrator (StdIO transport, headless).    *
 *                                                                *
 *  Tools exposed to the editor (VS Code/Cline, Cursor, Claude): *
 *    - execute_parallel_pipeline                                *
 *    - generate_task_metrics_report                             *
 *    - capture_behavior_feedback                                *
 *    - parse_audit_log                                          *
 * ────────────────────────────────────────────────────────────── */
/** Accept JSON-string, comma-string, or single string and coerce to string[]. */
const stringArray = z.preprocess((v) => {
    if (Array.isArray(v))
        return v;
    if (typeof v === "string") {
        const s = v.trim();
        if (!s)
            return [];
        if (s.startsWith("[")) {
            try {
                return JSON.parse(s);
            }
            catch { /* fall through */ }
        }
        return s.split(",").map((x) => x.trim()).filter(Boolean);
    }
    return v;
}, z.array(z.string()));
const PipelineInput = z.object({
    projectRoot: z.string().min(1).describe("Absolute path to the developer's project root."),
    ticketId: z.string().min(1).describe("Jira/Linear/issue ID used to scope the worktree branch."),
    targetFiles: stringArray.default([]).describe("Files inside projectRoot to distill into context."),
    rawPrompt: z.string().min(1).describe("Raw user instruction. Auto-steering rules will be prepended."),
    model: z.string().optional().describe("Model identifier used for billing (default claude-3-5-sonnet)."),
    downstreamServers: z
        .preprocess((v) => {
        if (Array.isArray(v))
            return v;
        if (typeof v === "string") {
            const s = v.trim();
            if (!s)
                return [];
            if (s.startsWith("[")) {
                try {
                    return JSON.parse(s);
                }
                catch { }
            }
            return s.split(",").map((x) => x.trim()).filter(Boolean);
        }
        return v;
    }, z.array(z.enum(["github", "jira", "sonarqube"])))
        .default([])
        .describe("Which downstream MCP servers the editor should fan out to in parallel."),
});
const MetricsInput = z.object({
    sessionId: z.string().optional(),
});
const FeedbackInput = z.object({
    projectRoot: z.string().min(1),
    source: z.enum(["rejection", "manual_steering", "clinerules"]),
    rule: z.string().min(1),
});
const ParseLogInput = z.object({
    ticketId: z.string().optional(),
    anomaliesOnly: z.boolean().default(false),
});
const AgentInput = z.object({
    projectRoot: z.string().min(1),
    ticketId: z.string().min(1),
    targetFiles: stringArray.default([]),
    rawPrompt: z.string().default(""),
    prNumber: z.number().optional(),
    owner: z.string().optional(),
    repo: z.string().optional(),
});
const SquadInput = AgentInput.extend({
    agents: z.preprocess((v) => {
        if (Array.isArray(v))
            return v;
        if (typeof v === "string") {
            const s = v.trim();
            if (s.startsWith("[")) {
                try {
                    return JSON.parse(s);
                }
                catch { }
            }
            return s.split(",").map((x) => x.trim()).filter(Boolean);
        }
        return v;
    }, z.array(z.enum(["developer", "reviewer", "refactor"])).min(1)),
});
const DownstreamCallInput = z.object({
    server: z.enum(["github", "jira", "sonarqube", "confluence", "chrome"]),
    tool: z.string().min(1),
    args: z.record(z.unknown()).default({}),
});
function readClinerules(projectRoot) {
    const p = join(projectRoot, ".clinerules");
    if (!existsSync(p))
        return null;
    return readFileSync(p, "utf-8");
}
/* ────────────────────────────────────────────────────────────── *
 *  Tool: execute_parallel_pipeline                              *
 * ────────────────────────────────────────────────────────────── */
async function executeParallelPipeline(raw) {
    const input = PipelineInput.parse(raw);
    const projectRoot = resolve(input.projectRoot);
    const sessionId = `sess_${Date.now()}_${input.ticketId}`;
    Telemetry.start(sessionId, input.ticketId, input.model ?? "claude-3-5-sonnet");
    Logger.info("Orchestrator", `Pipeline start`, { sessionId, projectRoot, ticketId: input.ticketId });
    // 1. Ingest project .clinerules into the behavior profile (idempotent).
    const clinerules = readClinerules(projectRoot);
    if (clinerules) {
        BehaviorTracker.ingestClinerules(projectRoot, clinerules);
        Logger.audit("Orchestrator", `Loaded .clinerules`, { bytes: clinerules.length });
    }
    // 2. Sandbox the work in an isolated git worktree.
    let sandbox;
    try {
        sandbox = Sandbox.createWorktree(projectRoot, input.ticketId);
    }
    catch (err) {
        Logger.error("Orchestrator", `Sandbox creation failed`, { error: err.message });
        throw err;
    }
    // 3. Distill target files in parallel (token optimization).
    const distilled = await Promise.all(input.targetFiles.map(async (rel) => {
        const abs = resolve(sandbox.worktreePath, rel);
        return Distiller.distillFile(abs);
    }));
    // 4. Apply auto-steering rewrite on the raw prompt.
    const steeredPrompt = BehaviorTracker.applySteering(projectRoot, input.rawPrompt);
    // 5. Build the parallel fan-out plan for the editor's MCP client.
    //    The editor (Cline / Cursor / Claude Code) will invoke these
    //    downstream official MCP servers concurrently.
    const fanout = await Promise.all(input.downstreamServers.map(async (srv) => {
        Telemetry.record(sessionId, { toolHops: 1, downstreamTool: srv });
        switch (srv) {
            case "github":
                return {
                    server: "github",
                    suggestedTool: "create_pull_request_review",
                    hint: `Run code review on branch ${sandbox.branch}.`,
                };
            case "jira":
                return {
                    server: "jira",
                    suggestedTool: "get_issue",
                    args: { issueKey: input.ticketId },
                    hint: `Read ticket ${input.ticketId} acceptance criteria, derive sub-plan.`,
                };
            case "sonarqube":
                return {
                    server: "sonarqube",
                    suggestedTool: "get_issues",
                    hint: `Scan files: ${input.targetFiles.join(", ")} for quality gates.`,
                };
        }
    }));
    // 6. Rough token accounting for the invoice.
    const promptChars = steeredPrompt.length + distilled.reduce((a, d) => a + d.distilledLength, 0);
    const estimatedInputTokens = Math.ceil(promptChars / 4);
    Telemetry.record(sessionId, { inputTokens: estimatedInputTokens, toolHops: 1 });
    Telemetry.end(sessionId);
    Logger.info("Orchestrator", `Pipeline ready`, { sessionId, fanoutCount: fanout.length });
    const payload = {
        sessionId,
        ticketId: input.ticketId,
        sandbox,
        steeredPrompt,
        distilledContext: distilled,
        parallelFanout: fanout,
        instructions: "Run the parallelFanout MCP tool calls concurrently in the host editor, then synthesize the final patch inside the sandbox worktree path.",
    };
    return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
}
/* ────────────────────────────────────────────────────────────── *
 *  Tool: generate_task_metrics_report                           *
 * ────────────────────────────────────────────────────────────── */
async function generateTaskMetricsReport(raw) {
    const { sessionId } = MetricsInput.parse(raw ?? {});
    const invoice = Telemetry.buildInvoice(sessionId);
    return { content: [{ type: "text", text: invoice }] };
}
/* ────────────────────────────────────────────────────────────── *
 *  Tool: capture_behavior_feedback                              *
 * ────────────────────────────────────────────────────────────── */
async function captureBehaviorFeedback(raw) {
    const input = FeedbackInput.parse(raw);
    const entry = BehaviorTracker.capture(resolve(input.projectRoot), input.source, input.rule);
    return {
        content: [
            {
                type: "text",
                text: `Captured behavior rule:\n${JSON.stringify(entry, null, 2)}`,
            },
        ],
    };
}
/* ────────────────────────────────────────────────────────────── *
 *  Tool: parse_audit_log                                        *
 * ────────────────────────────────────────────────────────────── */
async function parseAuditLog(raw) {
    const input = ParseLogInput.parse(raw ?? {});
    const entries = input.anomaliesOnly
        ? LogParser.findAnomalies()
        : input.ticketId
            ? LogParser.stepsForTicket(input.ticketId)
            : LogParser.readAll();
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ count: entries.length, entries }, null, 2),
            },
        ],
    };
}
/* ────────────────────────────────────────────────────────────── *
 *  Agent tool dispatcher                                         *
 * ────────────────────────────────────────────────────────────── */
async function handleAgentTool(name, raw) {
    const sessionId = `sess_${Date.now()}`;
    if (name === "downstream_call") {
        const i = DownstreamCallInput.parse(raw);
        const out = await MCPDownstream.call(i.server, i.tool, i.args, sessionId);
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    }
    if (name === "downstream_list_tools") {
        const i = z.object({ server: z.enum(["github", "jira", "sonarqube", "confluence", "chrome"]) }).parse(raw);
        const out = await MCPDownstream.listTools(i.server);
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    }
    if (name === "run_squad") {
        const i = SquadInput.parse(raw);
        Telemetry.start(sessionId, i.ticketId);
        const reports = await runSquad({ ...i, sessionId });
        Telemetry.end(sessionId);
        return { content: [{ type: "text", text: JSON.stringify({ sessionId, reports }, null, 2) }] };
    }
    const i = AgentInput.parse(raw);
    Telemetry.start(sessionId, i.ticketId);
    let report;
    if (name === "agent_developer")
        report = await agentDeveloper({ ...i, sessionId });
    else if (name === "agent_reviewer")
        report = await agentReviewer({ ...i, sessionId });
    else
        report = await agentRefactor({ ...i, sessionId });
    Telemetry.end(sessionId);
    return { content: [{ type: "text", text: JSON.stringify({ sessionId, report }, null, 2) }] };
}
/* ────────────────────────────────────────────────────────────── *
 *  MCP Server bootstrap                                          *
 * ────────────────────────────────────────────────────────────── */
const server = new Server({ name: "mcp-multi-agent-framework", version: "0.1.0" }, { capabilities: { tools: {} } });
const TOOL_DEFS = [
    {
        name: "execute_parallel_pipeline",
        description: "Primary orchestrator. Reads .clinerules, opens a git worktree sandbox, distills target files, applies learned auto-steering to the prompt, and emits a parallel fan-out plan for downstream MCP servers (GitHub, Jira, SonarQube).",
        inputSchema: {
            type: "object",
            properties: {
                projectRoot: { type: "string" },
                ticketId: { type: "string" },
                targetFiles: { type: "array", items: { type: "string" } },
                rawPrompt: { type: "string" },
                model: { type: "string" },
                downstreamServers: {
                    type: "array",
                    items: { type: "string", enum: ["github", "jira", "sonarqube"] },
                },
            },
            required: ["projectRoot", "ticketId", "rawPrompt"],
        },
    },
    {
        name: "generate_task_metrics_report",
        description: "Reads persistent session telemetry and returns a plain-text CLI invoice block: tokens, tool hops, downstream calls, and USD cost per session.",
        inputSchema: {
            type: "object",
            properties: { sessionId: { type: "string" } },
        },
    },
    {
        name: "capture_behavior_feedback",
        description: "Persist a rejection or steering instruction as a permanent behavior rule for this project. Auto-injected into future prompts.",
        inputSchema: {
            type: "object",
            properties: {
                projectRoot: { type: "string" },
                source: { type: "string", enum: ["rejection", "manual_steering", "clinerules"] },
                rule: { type: "string" },
            },
            required: ["projectRoot", "source", "rule"],
        },
    },
    {
        name: "parse_audit_log",
        description: "Inspect mcp-framework.log. Filter by ticketId, or return only anomalies (errors and denied commands).",
        inputSchema: {
            type: "object",
            properties: {
                ticketId: { type: "string" },
                anomaliesOnly: { type: "boolean" },
            },
        },
    },
    {
        name: "agent_developer",
        description: "Developer agent: reads the Jira ticket, pulls repo context from GitHub, distills local files, applies auto-steering, writes an implementation plan inside the sandbox worktree. Only projectRoot + ticketId are required — targetFiles and rawPrompt are auto-derived from the Jira ticket (with .clinerules always applied).",
        inputSchema: {
            type: "object",
            properties: {
                projectRoot: { type: "string" },
                ticketId: { type: "string" },
                targetFiles: { type: "array", items: { type: "string" }, description: "Optional. If omitted, derived from Jira ticket text, else from git diff vs main." },
                rawPrompt: { type: "string", description: "Optional. If omitted, uses the Jira ticket summary + description as the prompt." },
            },
            required: ["projectRoot", "ticketId"],
        },
    },
    {
        name: "agent_reviewer",
        description: "Code-review agent: pulls PR diff from GitHub and SonarQube issues IN PARALLEL, then returns a review plan to post via github.create_pull_request_review.",
        inputSchema: {
            type: "object",
            properties: {
                projectRoot: { type: "string" },
                ticketId: { type: "string" },
                prNumber: { type: "number" },
                owner: { type: "string" },
                repo: { type: "string" },
            },
            required: ["projectRoot", "ticketId"],
        },
    },
    {
        name: "agent_refactor",
        description: "Refactor agent: distills the target files and pulls SonarQube quality issues in parallel, then returns a refactor plan respecting the steering profile. targetFiles is optional — defaults to git diff vs main.",
        inputSchema: {
            type: "object",
            properties: {
                projectRoot: { type: "string" },
                ticketId: { type: "string" },
                targetFiles: { type: "array", items: { type: "string" } },
                rawPrompt: { type: "string" },
            },
            required: ["projectRoot", "ticketId"],
        },
    },
    {
        name: "run_squad",
        description: "Run multiple preset agents (developer/reviewer/refactor) IN PARALLEL on the same ticket and return all reports together.",
        inputSchema: {
            type: "object",
            properties: {
                projectRoot: { type: "string" },
                ticketId: { type: "string" },
                targetFiles: { type: "array", items: { type: "string" } },
                rawPrompt: { type: "string" },
                prNumber: { type: "number" },
                owner: { type: "string" },
                repo: { type: "string" },
                agents: {
                    type: "array",
                    items: { type: "string", enum: ["developer", "reviewer", "refactor"] },
                },
            },
            required: ["projectRoot", "ticketId", "agents"],
        },
    },
    {
        name: "downstream_call",
        description: "Low-level escape hatch: directly call a tool on a spawned downstream MCP server (github/jira/sonarqube/confluence/chrome). The orchestrator manages the child process and connection pool.",
        inputSchema: {
            type: "object",
            properties: {
                server: { type: "string", enum: ["github", "jira", "sonarqube", "confluence", "chrome"] },
                tool: { type: "string" },
                args: { type: "object" },
            },
            required: ["server", "tool"],
        },
    },
    {
        name: "downstream_list_tools",
        description: "Discover what tools a downstream MCP server exposes. Useful before crafting a downstream_call.",
        inputSchema: {
            type: "object",
            properties: {
                server: { type: "string", enum: ["github", "jira", "sonarqube", "confluence", "chrome"] },
            },
            required: ["server"],
        },
    },
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
        switch (name) {
            case "execute_parallel_pipeline":
                return await executeParallelPipeline(args);
            case "generate_task_metrics_report":
                return await generateTaskMetricsReport(args);
            case "capture_behavior_feedback":
                return await captureBehaviorFeedback(args);
            case "parse_audit_log":
                return await parseAuditLog(args);
            case "agent_developer":
            case "agent_reviewer":
            case "agent_refactor":
            case "run_squad":
            case "downstream_call":
            case "downstream_list_tools":
                return await handleAgentTool(name, args);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (err) {
        const isPerm = err instanceof PermissionDeniedError;
        Logger.error("Orchestrator", `Tool ${name} failed`, {
            error: err.message,
            kind: isPerm ? "permission_denied" : "runtime",
        });
        return {
            isError: true,
            content: [
                {
                    type: "text",
                    text: `Error executing ${name}: ${err.message}`,
                },
            ],
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    Logger.info("Boot", "MCP Multi-Agent Framework online (StdIO).");
}
main().catch((err) => {
    Logger.error("Boot", "Fatal startup failure", { error: err.message });
    process.exit(1);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
        Logger.info("Boot", `Received ${sig}, closing downstream MCP clients`);
        await MCPDownstream.closeAll();
        process.exit(0);
    });
}
//# sourceMappingURL=index.js.map