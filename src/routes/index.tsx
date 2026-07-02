import { createFileRoute } from "@tanstack/react-router";
import React, { useState } from 'react';
import Modal from '../components/Modal';

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
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground p-8">
      <div className="max-w-2xl space-y-4 text-center">
        <h1 className="text-4xl font-bold">Multi-Agent MCP Orchestrator</h1>
        <p className="text-muted-foreground">
          See <code className="px-1 py-0.5 rounded bg-muted">mcp-server/SETUP_VSCODE.md</code> for
          setup instructions.
        </p>
        <button
          onClick={openModal}
          className="mt-4 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Verify POC
        </button>
      </div>

      <Modal isOpen={isModalOpen} onClose={closeModal}>
        <h2 className="text-2xl font-bold mb-4 text-gray-900">POC Verification</h2>
        <p className="text-gray-700">ai poc working</p>
      </Modal>
    </main>
  );
}
