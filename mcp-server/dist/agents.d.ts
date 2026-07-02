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
    steps: Array<{
        tool: string;
        ok: boolean;
        summary: string;
        data?: unknown;
    }>;
    plan?: string;
    patchPath?: string;
}
export declare function agentDeveloper(input: {
    projectRoot: string;
    ticketId: string;
    targetFiles?: string[];
    rawPrompt?: string;
    sessionId: string;
}): Promise<AgentReport>;
export declare function agentReviewer(input: {
    projectRoot: string;
    ticketId: string;
    prNumber?: number;
    owner?: string;
    repo?: string;
    sessionId: string;
}): Promise<AgentReport>;
export declare function agentRefactor(input: {
    projectRoot: string;
    ticketId: string;
    targetFiles?: string[];
    rawPrompt?: string;
    sessionId: string;
}): Promise<AgentReport>;
export declare function runSquad(input: {
    projectRoot: string;
    ticketId: string;
    targetFiles: string[];
    rawPrompt: string;
    prNumber?: number;
    owner?: string;
    repo?: string;
    agents: Array<"developer" | "reviewer" | "refactor">;
    sessionId: string;
}): Promise<AgentReport[]>;
