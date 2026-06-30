import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, homedir } from "node:os";

/**
 * Structural Audit Streamer.
 * Appends every state transition, intercepted command and tool hop
 * into a persistent log file at <cwd>/mcp-framework.log.
 *
 * Also exposes a built-in log parser used by the
 * `generate_task_metrics_report` MCP tool and by anomaly detection.
 */


export type LogLevel = "INFO" | "WARN" | "ERROR" | "AUDIT" | "TELEMETRY";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a writable directory for runtime state files.
 * Cline (and some MCP hosts) launch the server with cwd="/", which is
 * read-only on macOS. Honour MCP_STATE_DIR if provided, else fall back
 * to ~/.mcp-orchestrator, else os tmpdir.
 */
function resolveStateDir(): string {
  const envDir = process.env.MCP_STATE_DIR;
  const candidates = [
    envDir,
    process.cwd() !== "/" ? process.cwd() : undefined,
    homedir() ? join(homedir(), ".mcp-orchestrator") : undefined,
    tmpdir(),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  for (const dir of candidates) {
    try {
      // best-effort ensure dir exists & is writable
      const { mkdirSync, accessSync, constants } = require("node:fs") as typeof import("node:fs");
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
      return dir;
    } catch {
      continue;
    }
  }
  return tmpdir();
}
const STATE_DIR = resolveStateDir();
const LOG_FILE = join(STATE_DIR, "mcp-framework.log");
const TELEMETRY_FILE = join(STATE_DIR, "mcp-telemetry.json");

export interface SessionTelemetry {
  sessions: Record<
    string,
    {
      ticketId: string;
      startedAt: string;
      endedAt?: string;
      inputTokens: number;
      outputTokens: number;
      toolHops: number;
      downstreamCalls: Record<string, number>;
      model: string;
    }
  >;
}

function readTelemetry(): SessionTelemetry {
  if (!existsSync(TELEMETRY_FILE)) return { sessions: {} };
  try {
    return JSON.parse(readFileSync(TELEMETRY_FILE, "utf-8")) as SessionTelemetry;
  } catch {
    return { sessions: {} };
  }
}

function writeTelemetry(t: SessionTelemetry): void {
  writeFileSync(TELEMETRY_FILE, JSON.stringify(t, null, 2), "utf-8");
}

export class Logger {
  static log(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...(data ? { data } : {}),
    };
    try {
      appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // Never crash the orchestrator on logging failure.
    }
    // Mirror to stderr (StdIO transport reserves stdout for JSON-RPC).
    process.stderr.write(`[${entry.level}] ${entry.scope} :: ${entry.message}\n`);
  }

  static info(scope: string, msg: string, data?: Record<string, unknown>) {
    this.log("INFO", scope, msg, data);
  }
  static warn(scope: string, msg: string, data?: Record<string, unknown>) {
    this.log("WARN", scope, msg, data);
  }
  static error(scope: string, msg: string, data?: Record<string, unknown>) {
    this.log("ERROR", scope, msg, data);
  }
  static audit(scope: string, msg: string, data?: Record<string, unknown>) {
    this.log("AUDIT", scope, msg, data);
  }
}

/* ────────────────────────────────────────────────────────────── *
 *   Log Parser - reads mcp-framework.log to verify agent steps  *
 *   and surface anomalies (errors, denied commands, dead hops). *
 * ────────────────────────────────────────────────────────────── */
export class LogParser {
  static readAll(): LogEntry[] {
    if (!existsSync(LOG_FILE)) return [];
    return readFileSync(LOG_FILE, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is LogEntry => e !== null);
  }

  static findAnomalies(): LogEntry[] {
    return this.readAll().filter(
      (e) =>
        e.level === "ERROR" ||
        (e.level === "AUDIT" && /denied|blocked|unauthorized/i.test(e.message)),
    );
  }

  static stepsForTicket(ticketId: string): LogEntry[] {
    return this.readAll().filter(
      (e) =>
        e.message.includes(ticketId) ||
        (e.data && JSON.stringify(e.data).includes(ticketId)),
    );
  }
}

/* ────────────────────────────────────────────────────────────── *
 *   Financial Self-Reporting telemetry helpers                  *
 * ────────────────────────────────────────────────────────────── */

/** Reference pricing matrix (USD per 1M tokens). Edit freely. */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-haiku":   { input: 0.25, output: 1.25 },
  "gpt-4o":           { input: 2.5,  output: 10.0 },
  "gpt-4o-mini":      { input: 0.15, output: 0.6 },
};

export class Telemetry {
  static start(sessionId: string, ticketId: string, model = "claude-3-5-sonnet"): void {
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

  static record(
    sessionId: string,
    patch: Partial<{
      inputTokens: number;
      outputTokens: number;
      toolHops: number;
      downstreamTool: string;
    }>,
  ): void {
    const t = readTelemetry();
    const s = t.sessions[sessionId];
    if (!s) return;
    if (patch.inputTokens) s.inputTokens += patch.inputTokens;
    if (patch.outputTokens) s.outputTokens += patch.outputTokens;
    if (patch.toolHops) s.toolHops += patch.toolHops;
    if (patch.downstreamTool) {
      s.downstreamCalls[patch.downstreamTool] =
        (s.downstreamCalls[patch.downstreamTool] ?? 0) + 1;
    }
    writeTelemetry(t);
  }

  static end(sessionId: string): void {
    const t = readTelemetry();
    const s = t.sessions[sessionId];
    if (!s) return;
    s.endedAt = new Date().toISOString();
    writeTelemetry(t);
  }

  /** Build the CLI invoice block consumed by `generate_task_metrics_report`. */
  static buildInvoice(sessionId?: string): string {
    const t = readTelemetry();
    const ids = sessionId ? [sessionId] : Object.keys(t.sessions);
    if (ids.length === 0) return "No telemetry sessions recorded.";

    const lines: string[] = [];
    lines.push("╔══════════════════════════════════════════════════════════════╗");
    lines.push("║          MCP MULTI-AGENT FRAMEWORK · TASK INVOICE            ║");
    lines.push("╚══════════════════════════════════════════════════════════════╝");

    let grand = 0;
    for (const id of ids) {
      const s = t.sessions[id];
      if (!s) continue;
      const price = PRICING[s.model] ?? PRICING["claude-3-5-sonnet"]!;
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