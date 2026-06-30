import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "./logger.js";

/**
 * Compliance Behavior Tracker & Auto-Steering.
 *
 *  - Persists rejected actions / manual steering corrections as logical
 *    behavior rules inside `mcp-behavior-profile.json` at project root.
 *  - On every new run, the tracker reads the profile and rewrites the
 *    incoming raw prompt to inject historical boundaries automatically.
 *
 * This lets engineers who don't know how to prompt build an implicit
 * steering profile just by saying "no, not like that" once.
 */

export interface BehaviorRule {
  id: string;
  createdAt: string;
  source: "rejection" | "manual_steering" | "clinerules";
  rule: string;
  hits: number;
}

export interface BehaviorProfile {
  projectRoot: string;
  rules: BehaviorRule[];
}

const PROFILE_FILENAME = "mcp-behavior-profile.json";

function profilePath(projectRoot: string) {
  return join(projectRoot, PROFILE_FILENAME);
}

export class BehaviorTracker {
  static load(projectRoot: string): BehaviorProfile {
    const p = profilePath(projectRoot);
    if (!existsSync(p)) return { projectRoot, rules: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as BehaviorProfile;
    } catch (err) {
      Logger.warn("BehaviorTracker", `Corrupt profile, starting fresh`, {
        error: (err as Error).message,
      });
      return { projectRoot, rules: [] };
    }
  }

  static save(profile: BehaviorProfile): void {
    writeFileSync(profilePath(profile.projectRoot), JSON.stringify(profile, null, 2), "utf-8");
  }

  /**
   * Capture an interaction:
   *  - If the developer rejected an action OR
   *  - injected manual steering (e.g. "Don't use 'any'", "Enforce Tailwind utilities"),
   * append it as a permanent rule.
   */
  static capture(
    projectRoot: string,
    source: BehaviorRule["source"],
    rule: string,
  ): BehaviorRule {
    const profile = BehaviorTracker.load(projectRoot);
    const normalized = rule.trim();
    const existing = profile.rules.find(
      (r) => r.rule.toLowerCase() === normalized.toLowerCase(),
    );
    if (existing) {
      existing.hits += 1;
      BehaviorTracker.save(profile);
      Logger.info("BehaviorTracker", `Reinforced existing rule`, { id: existing.id, hits: existing.hits });
      return existing;
    }
    const entry: BehaviorRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      source,
      rule: normalized,
      hits: 1,
    };
    profile.rules.push(entry);
    BehaviorTracker.save(profile);
    Logger.audit("BehaviorTracker", `New behavior rule captured`, entry as unknown as Record<string, unknown>);
    return entry;
  }

  /**
   * Intercept incoming raw prompt and prepend historical boundaries.
   * This is the "auto-steering" that helps non-prompt-experts.
   */
  static applySteering(projectRoot: string, rawPrompt: string): string {
    const profile = BehaviorTracker.load(projectRoot);
    if (profile.rules.length === 0) return rawPrompt;

    const sorted = [...profile.rules].sort((a, b) => b.hits - a.hits);
    const header = [
      "### AUTO-STEERING BOUNDARIES (learned from this project)",
      "You MUST respect every rule below. They were captured from prior",
      "developer rejections / manual corrections in this exact workspace:",
      "",
      ...sorted.map((r, i) => `  ${i + 1}. [${r.source}] ${r.rule}`),
      "",
      "### ORIGINAL USER PROMPT",
    ].join("\n");

    return `${header}\n${rawPrompt}`;
  }

  /** Convenience: ingest a `.clinerules` text file as a single bulk steering block. */
  static ingestClinerules(projectRoot: string, clinerulesContent: string): void {
    const lines = clinerulesContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    for (const l of lines) {
      BehaviorTracker.capture(projectRoot, "clinerules", l);
    }
  }
}