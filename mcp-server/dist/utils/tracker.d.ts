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
export declare class BehaviorTracker {
    static load(projectRoot: string): BehaviorProfile;
    static save(profile: BehaviorProfile): void;
    /**
     * Capture an interaction:
     *  - If the developer rejected an action OR
     *  - injected manual steering (e.g. "Don't use 'any'", "Enforce Tailwind utilities"),
     * append it as a permanent rule.
     */
    static capture(projectRoot: string, source: BehaviorRule["source"], rule: string): BehaviorRule;
    /**
     * Intercept incoming raw prompt and prepend historical boundaries.
     * This is the "auto-steering" that helps non-prompt-experts.
     */
    static applySteering(projectRoot: string, rawPrompt: string): string;
    /** Convenience: ingest a `.clinerules` text file as a single bulk steering block. */
    static ingestClinerules(projectRoot: string, clinerulesContent: string): void;
}
