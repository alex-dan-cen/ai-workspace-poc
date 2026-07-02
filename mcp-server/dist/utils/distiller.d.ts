export interface DistilledFile {
    path: string;
    originalLength: number;
    distilledLength: number;
    truncated: boolean;
    content: string;
}
export declare class Distiller {
    static stripComments(source: string): string;
    static collapseWhitespace(source: string): string;
    /**
     * Replace function / method / class bodies with `{ /* …truncated… *​/ }`.
     * Keeps signatures, exports, interfaces and type aliases intact.
     */
    static structuralTruncate(source: string): string;
    static distillString(path: string, source: string): DistilledFile;
    static distillFile(path: string): DistilledFile;
    static distillMany(paths: string[]): DistilledFile[];
}
