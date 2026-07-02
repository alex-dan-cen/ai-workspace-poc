import { Client } from "@modelcontextprotocol/sdk/client/index.js";
/**
 * Internal MCP Client.
 *
 * Lets the orchestrator spawn downstream official MCP servers
 * (GitHub, Jira, SonarQube, Confluence, Chrome DevTools) as child
 * processes and call their tools DIRECTLY — no host editor needed.
 *
 * This is what turns the framework from "advisor" into a real
 * autonomous multi-agent system.
 */
export type DownstreamId = "github" | "jira" | "sonarqube" | "confluence" | "chrome";
export interface DownstreamSpec {
    command: string;
    args: string[];
    env?: Record<string, string>;
}
/** Default launch specs for each downstream MCP server. */
export declare const DOWNSTREAM_SPECS: Record<DownstreamId, () => DownstreamSpec>;
export declare class MCPDownstream {
    /** Reuse a persistent client per downstream id (pool). */
    static get(id: DownstreamId): Promise<Client>;
    /** Call a tool on a downstream server. */
    static call(id: DownstreamId, toolName: string, args: Record<string, unknown>, sessionId?: string): Promise<unknown>;
    /** List tools exposed by a downstream server (for discovery / debugging). */
    static listTools(id: DownstreamId): Promise<unknown>;
    /** Close every pooled connection. */
    static closeAll(): Promise<void>;
}
