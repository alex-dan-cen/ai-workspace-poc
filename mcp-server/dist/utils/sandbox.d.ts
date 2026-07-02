import { type ExecSyncOptions } from "node:child_process";
export declare class PermissionDeniedError extends Error {
    constructor(message: string);
}
export interface SandboxHandle {
    ticketId: string;
    branch: string;
    worktreePath: string;
    projectRoot: string;
}
export declare class Sandbox {
    /**
     * Create (or reuse) an isolated git worktree for the given ticket.
     *   git worktree add ../sandbox-<ticketId> -b feature/<ticketId>
     */
    static createWorktree(projectRoot: string, ticketId: string): SandboxHandle;
    static removeWorktree(handle: SandboxHandle): void;
    /**
     * Permission-checked command execution.
     *  - Denylist of destructive patterns.
     *  - All path operands must resolve inside `scopeRoot` (sandbox boundary).
     */
    static runSafe(command: string, opts: ExecSyncOptions & {
        scopeRoot: string;
    }): string;
    private static assertSafeCommand;
    private static assertPathsInScope;
}
