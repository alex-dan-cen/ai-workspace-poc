import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "./logger.js";
const PROFILE_FILENAME = "mcp-behavior-profile.json";
function profilePath(projectRoot) {
    return join(projectRoot, PROFILE_FILENAME);
}
export class BehaviorTracker {
    static load(projectRoot) {
        const p = profilePath(projectRoot);
        if (!existsSync(p))
            return { projectRoot, rules: [] };
        try {
            return JSON.parse(readFileSync(p, "utf-8"));
        }
        catch (err) {
            Logger.warn("BehaviorTracker", `Corrupt profile, starting fresh`, {
                error: err.message,
            });
            return { projectRoot, rules: [] };
        }
    }
    static save(profile) {
        writeFileSync(profilePath(profile.projectRoot), JSON.stringify(profile, null, 2), "utf-8");
    }
    /**
     * Capture an interaction:
     *  - If the developer rejected an action OR
     *  - injected manual steering (e.g. "Don't use 'any'", "Enforce Tailwind utilities"),
     * append it as a permanent rule.
     */
    static capture(projectRoot, source, rule) {
        const profile = BehaviorTracker.load(projectRoot);
        const normalized = rule.trim();
        const existing = profile.rules.find((r) => r.rule.toLowerCase() === normalized.toLowerCase());
        if (existing) {
            existing.hits += 1;
            BehaviorTracker.save(profile);
            Logger.info("BehaviorTracker", `Reinforced existing rule`, { id: existing.id, hits: existing.hits });
            return existing;
        }
        const entry = {
            id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            createdAt: new Date().toISOString(),
            source,
            rule: normalized,
            hits: 1,
        };
        profile.rules.push(entry);
        BehaviorTracker.save(profile);
        Logger.audit("BehaviorTracker", `New behavior rule captured`, entry);
        return entry;
    }
    /**
     * Intercept incoming raw prompt and prepend historical boundaries.
     * This is the "auto-steering" that helps non-prompt-experts.
     */
    static applySteering(projectRoot, rawPrompt) {
        const profile = BehaviorTracker.load(projectRoot);
        if (profile.rules.length === 0)
            return rawPrompt;
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
    static ingestClinerules(projectRoot, clinerulesContent) {
        const lines = clinerulesContent
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#"));
        for (const l of lines) {
            BehaviorTracker.capture(projectRoot, "clinerules", l);
        }
    }
}
//# sourceMappingURL=tracker.js.map