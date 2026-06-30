import { execSync, type ExecSyncOptions } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, isAbsolute, relative } from "node:path";
import { Logger } from "./logger.js";

/**
 * Isolated Worktree Sandbox + Permission Manager.
 *
 * - Creates a dedicated git worktree per ticket so agents can never mutate
 *   the developer's working tree.
 * - Intercepts every shell command via runSafe(): denylist + path scoping.
 */

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf?\b/i,
  /\bsudo\b/i,
  /\bmkfs(\.|\s)/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{.*\};:/, // fork bomb
  /\bchmod\s+777\b/i,
  /\bchown\s+/i,
  /\bcurl\s.+\|\s*(ba)?sh\b/i,
  /\bwget\s.+\|\s*(ba)?sh\b/i,
  /\bnpm\s+publish\b/i,
  /\bgit\s+push\s+--force\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bshutdown\b|\breboot\b|\bhalt\b/i,
];

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(`[PermissionManager] ${message}`);
    this.name = "PermissionDeniedError";
  }
}

export interface SandboxHandle {
  ticketId: string;
  branch: string;
  worktreePath: string;
  projectRoot: string;
}

export class Sandbox {
  /**
   * Create (or reuse) an isolated git worktree for the given ticket.
   *   git worktree add ../sandbox-<ticketId> -b feature/<ticketId>
   */
  static createWorktree(projectRoot: string, ticketId: string): SandboxHandle {
    const safeTicket = ticketId.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const branch = `feature/${safeTicket}`;
    const worktreePath = resolve(projectRoot, "..", `sandbox-${safeTicket}`);

    if (!existsSync(projectRoot)) {
      throw new Error(`projectRoot does not exist: ${projectRoot}`);
    }

    if (existsSync(worktreePath)) {
      Logger.audit("Sandbox", `Worktree already exists, reusing`, { worktreePath, branch });
      return { ticketId: safeTicket, branch, worktreePath, projectRoot };
    }

    try {
      mkdirSync(resolve(worktreePath, ".."), { recursive: true });
      Sandbox.runSafe(`git worktree add "${worktreePath}" -b "${branch}"`, {
        cwd: projectRoot,
        scopeRoot: projectRoot,
      });
      Logger.audit("Sandbox", `Worktree created`, { worktreePath, branch, ticketId: safeTicket });
    } catch (err) {
      // Branch might already exist - try without -b
      Logger.warn("Sandbox", `Worktree create with new branch failed, retrying`, {
        error: (err as Error).message,
      });
      Sandbox.runSafe(`git worktree add "${worktreePath}" "${branch}"`, {
        cwd: projectRoot,
        scopeRoot: projectRoot,
      });
    }

    return { ticketId: safeTicket, branch, worktreePath, projectRoot };
  }

  static removeWorktree(handle: SandboxHandle): void {
    try {
      Sandbox.runSafe(`git worktree remove --force "${handle.worktreePath}"`, {
        cwd: handle.projectRoot,
        scopeRoot: handle.projectRoot,
      });
      Logger.audit("Sandbox", `Worktree removed`, { worktreePath: handle.worktreePath });
    } catch (err) {
      Logger.warn("Sandbox", `Worktree removal failed`, { error: (err as Error).message });
    }
  }

  /**
   * Permission-checked command execution.
   *  - Denylist of destructive patterns.
   *  - All path operands must resolve inside `scopeRoot` (sandbox boundary).
   */
  static runSafe(
    command: string,
    opts: ExecSyncOptions & { scopeRoot: string },
  ): string {
    Sandbox.assertSafeCommand(command);
    Sandbox.assertPathsInScope(command, opts.scopeRoot);

    Logger.audit("PermissionManager", `EXEC ${command}`, { cwd: opts.cwd });
    try {
      const out = execSync(command, {
        ...opts,
        stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      });
      return typeof out === "string" ? out : String(out);
    } catch (err) {
      const e = err as Error & { stderr?: Buffer | string };
      const stderr =
        typeof e.stderr === "string"
          ? e.stderr
          : e.stderr
            ? Buffer.from(e.stderr as Buffer).toString()
            : "";
      Logger.error("PermissionManager", `EXEC failed`, { command, stderr });
      throw err;
    }
  }

  private static assertSafeCommand(command: string): void {
    for (const re of DANGEROUS_PATTERNS) {
      if (re.test(command)) {
        const msg = `Dangerous command pattern detected (${re}): ${command}`;
        Logger.audit("PermissionManager", `DENIED ${msg}`);
        throw new PermissionDeniedError(msg);
      }
    }
  }

  private static assertPathsInScope(command: string, scopeRoot: string): void {
    const absScope = resolve(scopeRoot);
    // Pull double-quoted path-like operands and absolute-path tokens.
    const candidates = [
      ...Array.from(command.matchAll(/"([^"]+)"/g)).map((m) => m[1]!),
      ...command.split(/\s+/).filter((t) => isAbsolute(t)),
    ];
    for (const c of candidates) {
      // Allow non-path-looking quoted tokens.
      if (!c.includes("/") && !c.includes("\\")) continue;
      const abs = isAbsolute(c) ? c : resolve(absScope, c);
      const rel = relative(absScope, abs);
      // Allow inside scope OR inside the sibling sandbox dir.
      const allowedSibling = abs.startsWith(resolve(absScope, "..") + "/sandbox-");
      if ((rel.startsWith("..") || isAbsolute(rel)) && !allowedSibling) {
        const msg = `Path outside sandbox scope blocked: ${abs} (scope=${absScope})`;
        Logger.audit("PermissionManager", `DENIED ${msg}`);
        throw new PermissionDeniedError(msg);
      }
    }
  }
}