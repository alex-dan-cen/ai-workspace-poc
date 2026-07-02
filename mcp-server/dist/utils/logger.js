import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
/**
 * Resolve a writable directory for runtime state files.
 * Cline (and some MCP hosts) launch the server with cwd="/", which is
 * read-only on macOS. Honour MCP_STATE_DIR if provided, else fall back
 * to ~/.mcp-orchestrator, else os tmpdir.
 */
function resolveStateDir() {
    const envDir = process.env.MCP_STATE_DIR;
    const candidates = [
        envDir,
        process.cwd() !== "/" ? process.cwd() : undefined,
        homedir() ? join(homedir(), ".mcp-orchestrator") : undefined,
        tmpdir(),
    ].filter((p) => typeof p === "string" && p.length > 0);
    for (const dir of candidates) {
        try {
            // best-effort ensure dir exists & is writable
            const { mkdirSync, accessSync, constants } = require("node:fs");
            mkdirSync(dir, { recursive: true });
            accessSync(dir, constants.W_OK);
            return dir;
        }
        catch {
            continue;
        }
    }
    return tmpdir();
}
const STATE_DIR = resolveStateDir();
const LOG_FILE = join(STATE_DIR, "mcp-framework.log");
const TELEMETRY_FILE = join(STATE_DIR, "mcp-telemetry.json");
function readTelemetry() {
    if (!existsSync(TELEMETRY_FILE))
        return { sessions: {} };
    try {
        return JSON.parse(readFileSync(TELEMETRY_FILE, "utf-8"));
    }
    catch {
        return { sessions: {} };
    }
}
function writeTelemetry(t) {
    writeFileSync(TELEMETRY_FILE, JSON.stringify(t, null, 2), "utf-8");
}
export class Logger {
    static log(level, scope, message, data) {
        const entry = {
            ts: new Date().toISOString(),
            level,
            scope,
            message,
            ...(data ? { data } : {}),
        };
        try {
            appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
        }
        catch {
            // Never crash the orchestrator on logging failure.
        }
        // Mirror to stderr (StdIO transport reserves stdout for JSON-RPC).
        process.stderr.write(`[${entry.level}] ${entry.scope} :: ${entry.message}\n`);
    }
    static info(scope, msg, data) {
        this.log("INFO", scope, msg, data);
    }
    static warn(scope, msg, data) {
        this.log("WARN", scope, msg, data);
    }
    static error(scope, msg, data) {
        this.log("ERROR", scope, msg, data);
    }
    static audit(scope, msg, data) {
        this.log("AUDIT", scope, msg, data);
    }
}
/* ────────────────────────────────────────────────────────────── *
 *   Log Parser - reads mcp-framework.log to verify agent steps  *
 *   and surface anomalies (errors, denied commands, dead hops). *
 * ────────────────────────────────────────────────────────────── */
export class LogParser {
    static readAll() {
        if (!existsSync(LOG_FILE))
            return [];
        return readFileSync(LOG_FILE, "utf-8")
            .split("\n")
            .filter(Boolean)
            .map((l) => {
            try {
                return JSON.parse(l);
            }
            catch {
                return null;
            }
        })
            .filter((e) => e !== null);
    }
    static findAnomalies() {
        return this.readAll().filter((e) => e.level === "ERROR" ||
            (e.level === "AUDIT" && /denied|blocked|unauthorized/i.test(e.message)));
    }
    static stepsForTicket(ticketId) {
        return this.readAll().filter((e) => e.message.includes(ticketId) ||
            (e.data && JSON.stringify(e.data).includes(ticketId)));
    }
}
/* ────────────────────────────────────────────────────────────── *
 *   Financial Self-Reporting telemetry helpers                  *
 * ────────────────────────────────────────────────────────────── */
/** Reference pricing matrix (USD per 1M tokens). Edit freely. */
export const PRICING = {
    "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
    "claude-3-7-sonnet": { input: 3.0, output: 15.0 },
    "claude-3-haiku": { input: 0.25, output: 1.25 },
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
};
export class Telemetry {
    static start(sessionId, ticketId, model = "claude-3-5-sonnet") {
        const t = readTelemetry();
        t.sessions[sessionId] = {
            ticketId,
            startedAt: new Date().toISOString(),
            inputTokens: 0,
            outputTokens: 0,
            toolHops: 0,
            downstreamCalls: {},
            model,
        };
        writeTelemetry(t);
    }
    static record(sessionId, patch) {
        const t = readTelemetry();
        const s = t.sessions[sessionId];
        if (!s)
            return;
        if (patch.inputTokens)
            s.inputTokens += patch.inputTokens;
        if (patch.outputTokens)
            s.outputTokens += patch.outputTokens;
        if (patch.toolHops)
            s.toolHops += patch.toolHops;
        if (patch.downstreamTool) {
            s.downstreamCalls[patch.downstreamTool] =
                (s.downstreamCalls[patch.downstreamTool] ?? 0) + 1;
        }
        writeTelemetry(t);
    }
    static end(sessionId) {
        const t = readTelemetry();
        const s = t.sessions[sessionId];
        if (!s)
            return;
        s.endedAt = new Date().toISOString();
        writeTelemetry(t);
    }
    /** Build the CLI invoice block consumed by `generate_task_metrics_report`. */
    static buildInvoice(sessionId) {
        const t = readTelemetry();
        const ids = sessionId ? [sessionId] : Object.keys(t.sessions);
        if (ids.length === 0)
            return "No telemetry sessions recorded.";
        const lines = [];
        lines.push("╔══════════════════════════════════════════════════════════════╗");
        lines.push("║          MCP MULTI-AGENT FRAMEWORK · TASK INVOICE            ║");
        lines.push("╚══════════════════════════════════════════════════════════════╝");
        let grand = 0;
        for (const id of ids) {
            const s = t.sessions[id];
            if (!s)
                continue;
            const price = PRICING[s.model] ?? PRICING["claude-3-5-sonnet"];
            const inCost = (s.inputTokens / 1_000_000) * price.input;
            const outCost = (s.outputTokens / 1_000_000) * price.output;
            const total = inCost + outCost;
            grand += total;
            lines.push("");
            lines.push(`Session     : ${id}`);
            lines.push(`Ticket      : ${s.ticketId}`);
            lines.push(`Model       : ${s.model}`);
            lines.push(`Started     : ${s.startedAt}`);
            lines.push(`Ended       : ${s.endedAt ?? "(in-progress)"}`);
            lines.push("--------------------------------------------------------------");
            lines.push(`Input  tokens : ${s.inputTokens.toLocaleString()}`);
            lines.push(`Output tokens : ${s.outputTokens.toLocaleString()}`);
            lines.push(`Tool hops     : ${s.toolHops}`);
            lines.push(`Downstream    : ${JSON.stringify(s.downstreamCalls)}`);
            lines.push("--------------------------------------------------------------");
            lines.push(`Input  cost  : $${inCost.toFixed(6)}`);
            lines.push(`Output cost  : $${outCost.toFixed(6)}`);
            lines.push(`SUBTOTAL     : $${total.toFixed(6)}`);
        }
        lines.push("");
        lines.push("══════════════════════════════════════════════════════════════");
        lines.push(`GRAND TOTAL  : $${grand.toFixed(6)}`);
        lines.push("══════════════════════════════════════════════════════════════");
        return lines.join("\n");
    }
}
//# sourceMappingURL=logger.js.map