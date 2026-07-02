import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Logger, Telemetry } from "./logger.js";
/** Default launch specs for each downstream MCP server. */
export const DOWNSTREAM_SPECS = {
    github: () => ({
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "",
        },
    }),
    jira: () => ({
        command: "npx",
        args: ["-y", "@aashari/mcp-server-atlassian-jira"],
        env: {
            ATLASSIAN_SITE_NAME: process.env.ATLASSIAN_SITE_NAME ?? "",
            ATLASSIAN_USER_EMAIL: process.env.ATLASSIAN_USER_EMAIL ?? "",
            ATLASSIAN_API_TOKEN: process.env.ATLASSIAN_API_TOKEN ?? "",
        },
    }),
    confluence: () => ({
        command: "npx",
        args: ["-y", "@aashari/mcp-server-atlassian-confluence"],
        env: {
            ATLASSIAN_SITE_NAME: process.env.ATLASSIAN_SITE_NAME ?? "",
            ATLASSIAN_USER_EMAIL: process.env.ATLASSIAN_USER_EMAIL ?? "",
            ATLASSIAN_API_TOKEN: process.env.ATLASSIAN_API_TOKEN ?? "",
        },
    }),
    sonarqube: () => ({
        command: "npx",
        args: ["-y", "sonarqube-mcp-server"],
        env: {
            SONARQUBE_URL: process.env.SONARQUBE_URL ?? "",
            SONARQUBE_TOKEN: process.env.SONARQUBE_TOKEN ?? "",
            SONARQUBE_PROJECT_KEY: process.env.SONARQUBE_PROJECT_KEY ?? "",
        },
    }),
    chrome: () => ({
        command: "npx",
        args: ["-y", "chrome-devtools-mcp@latest"],
        env: {},
    }),
};
const POOL = new Map();
async function spawnClient(id) {
    const spec = DOWNSTREAM_SPECS[id]();
    Logger.info("MCPClient", `Spawning downstream`, { id, cmd: spec.command });
    const transport = new StdioClientTransport({
        command: spec.command,
        args: spec.args,
        env: { ...process.env, ...spec.env },
    });
    const client = new Client({ name: `orchestrator-${id}`, version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    Logger.audit("MCPClient", `Connected to downstream`, { id });
    return client;
}
export class MCPDownstream {
    /** Reuse a persistent client per downstream id (pool). */
    static async get(id) {
        let existing = POOL.get(id);
        if (!existing) {
            existing = spawnClient(id);
            POOL.set(id, existing);
        }
        return existing;
    }
    /** Call a tool on a downstream server. */
    static async call(id, toolName, args, sessionId) {
        const client = await MCPDownstream.get(id);
        Logger.info("MCPClient", `→ ${id}.${toolName}`, { args });
        if (sessionId)
            Telemetry.record(sessionId, { toolHops: 1, downstreamTool: id });
        try {
            const res = await client.callTool({ name: toolName, arguments: args });
            Logger.info("MCPClient", `← ${id}.${toolName} ok`);
            return res;
        }
        catch (err) {
            Logger.error("MCPClient", `${id}.${toolName} failed`, {
                error: err.message,
            });
            throw err;
        }
    }
    /** List tools exposed by a downstream server (for discovery / debugging). */
    static async listTools(id) {
        const client = await MCPDownstream.get(id);
        return client.listTools();
    }
    /** Close every pooled connection. */
    static async closeAll() {
        for (const [id, p] of POOL.entries()) {
            try {
                const c = await p;
                await c.close();
                Logger.audit("MCPClient", `Closed downstream`, { id });
            }
            catch (err) {
                Logger.warn("MCPClient", `Close failed`, { id, error: err.message });
            }
        }
        POOL.clear();
    }
}
//# sourceMappingURL=mcp-client.js.map