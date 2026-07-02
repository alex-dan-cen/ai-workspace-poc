import { readFileSync, existsSync, statSync } from "node:fs";
import { Logger } from "./logger.js";
/**
 * Pre-Agent Context Distiller.
 *
 *  - Strips inline/block comments and redundant whitespace.
 *  - For files > 5,000 chars, replaces function/class bodies with `{ /* …truncated… *​/ }`
 *    via a structural regex pass, producing a light skeleton of:
 *      exports, interfaces/types, signatures, function/class headers.
 */
const TRUNCATION_THRESHOLD = 5_000;
export class Distiller {
    static stripComments(source) {
        // Remove /* block */ comments (non-greedy, multiline)
        let s = source.replace(/\/\*[\s\S]*?\*\//g, "");
        // Remove // line comments but preserve URLs (http://...) and shebangs
        s = s.replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
        return s;
    }
    static collapseWhitespace(source) {
        return source
            .replace(/[ \t]+\n/g, "\n") // trailing spaces
            .replace(/\n{3,}/g, "\n\n") // 3+ blank lines -> 1 blank line
            .replace(/[ \t]{2,}/g, " "); // run-on spaces
    }
    /**
     * Replace function / method / class bodies with `{ /* …truncated… *​/ }`.
     * Keeps signatures, exports, interfaces and type aliases intact.
     */
    static structuralTruncate(source) {
        let out = source;
        // function foo(...): T { ... }   /  async function foo(...) { ... }
        out = out.replace(/((?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*(?::\s*[^\{;]+)?)\s*\{[\s\S]*?\n\}/g, "$1 { /* truncated */ }");
        // arrow assigned to const/let: const foo = (...): T => { ... }
        out = out.replace(/((?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+?)?\s*=>)\s*\{[\s\S]*?\n\}/g, "$1 { /* truncated */ }");
        // class methods: name(args): T { ... }  (inside a class block, best-effort)
        out = out.replace(/(^\s*(?:public|private|protected|static|async|\s)*\s*\w+\s*\([^)]*\)\s*(?::\s*[^\{;]+)?)\s*\{[\s\S]*?\n\s*\}/gm, "$1 { /* truncated */ }");
        return out;
    }
    static distillString(path, source) {
        const originalLength = source.length;
        let s = Distiller.stripComments(source);
        s = Distiller.collapseWhitespace(s);
        let truncated = false;
        if (s.length > TRUNCATION_THRESHOLD) {
            s = Distiller.structuralTruncate(s);
            s = Distiller.collapseWhitespace(s);
            truncated = true;
        }
        return {
            path,
            originalLength,
            distilledLength: s.length,
            truncated,
            content: s,
        };
    }
    static distillFile(path) {
        if (!existsSync(path) || !statSync(path).isFile()) {
            Logger.warn("Distiller", `Skipping missing file`, { path });
            return { path, originalLength: 0, distilledLength: 0, truncated: false, content: "" };
        }
        const src = readFileSync(path, "utf-8");
        const out = Distiller.distillString(path, src);
        Logger.info("Distiller", `Distilled ${path}`, {
            originalLength: out.originalLength,
            distilledLength: out.distilledLength,
            truncated: out.truncated,
        });
        return out;
    }
    static distillMany(paths) {
        return paths.map((p) => Distiller.distillFile(p));
    }
}
//# sourceMappingURL=distiller.js.map