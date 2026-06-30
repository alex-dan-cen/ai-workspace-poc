import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Multi-Agent MCP Orchestrator" },
      { name: "description", content: "Headless multi-agent MCP framework for code editors" },
      { property: "og:title", content: "Multi-Agent MCP Orchestrator" },
      { property: "og:description", content: "Headless multi-agent MCP framework for code editors" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground p-8">
      <div className="max-w-2xl space-y-4 text-center">
        <h1 className="text-4xl font-bold">Multi-Agent MCP Orchestrator</h1>
        <p className="text-muted-foreground">
          See <code className="px-1 py-0.5 rounded bg-muted">mcp-server/SETUP_VSCODE.md</code> for
          setup instructions.
        </p>
      </div>
    </main>
  );
}
