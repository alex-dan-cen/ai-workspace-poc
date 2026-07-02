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
export interface SessionTelemetry {
    sessions: Record<string, {
        ticketId: string;
        startedAt: string;
        endedAt?: string;
        inputTokens: number;
        outputTokens: number;
        toolHops: number;
        downstreamCalls: Record<string, number>;
        model: string;
    }>;
}
export declare class Logger {
    static log(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>): void;
    static info(scope: string, msg: string, data?: Record<string, unknown>): void;
    static warn(scope: string, msg: string, data?: Record<string, unknown>): void;
    static error(scope: string, msg: string, data?: Record<string, unknown>): void;
    static audit(scope: string, msg: string, data?: Record<string, unknown>): void;
}
export declare class LogParser {
    static readAll(): LogEntry[];
    static findAnomalies(): LogEntry[];
    static stepsForTicket(ticketId: string): LogEntry[];
}
/** Reference pricing matrix (USD per 1M tokens). Edit freely. */
export declare const PRICING: Record<string, {
    input: number;
    output: number;
}>;
export declare class Telemetry {
    static start(sessionId: string, ticketId: string, model?: string): void;
    static record(sessionId: string, patch: Partial<{
        inputTokens: number;
        outputTokens: number;
        toolHops: number;
        downstreamTool: string;
    }>): void;
    static end(sessionId: string): void;
    /** Build the CLI invoice block consumed by `generate_task_metrics_report`. */
    static buildInvoice(sessionId?: string): string;
}
