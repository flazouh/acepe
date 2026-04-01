import { describe, expect, it } from "bun:test";

import { resolveKanbanNewSessionDefaults } from "./kanban-new-session-dialog-state.js";

describe("resolveKanbanNewSessionDefaults", () => {
	it("prefers the focused project and first selected available agent", () => {
		const result = resolveKanbanNewSessionDefaults({
			projects: [
				{ path: "/a", name: "Alpha", color: "#111", createdAt: new Date() },
				{ path: "/b", name: "Beta", color: "#222", createdAt: new Date() },
			],
			focusedProjectPath: "/b",
			availableAgents: [
				{ id: "cursor", name: "Cursor", icon: "cursor.svg" },
				{ id: "claude-code", name: "Claude Code", icon: "claude.svg" },
			],
			selectedAgentIds: ["claude-code"],
		});

		expect(result.projectPath).toBe("/b");
		expect(result.agentId).toBe("claude-code");
	});

	it("falls back to the first project and first available agent", () => {
		const result = resolveKanbanNewSessionDefaults({
			projects: [
				{ path: "/a", name: "Alpha", color: "#111", createdAt: new Date() },
				{ path: "/b", name: "Beta", color: "#222", createdAt: new Date() },
			],
			focusedProjectPath: "/missing",
			availableAgents: [
				{ id: "cursor", name: "Cursor", icon: "cursor.svg" },
				{ id: "claude-code", name: "Claude Code", icon: "claude.svg" },
			],
			selectedAgentIds: [],
		});

		expect(result.projectPath).toBe("/a");
		expect(result.agentId).toBe("cursor");
	});

	it("returns null values when no projects or agents are available", () => {
		const result = resolveKanbanNewSessionDefaults({
			projects: [],
			focusedProjectPath: null,
			availableAgents: [],
			selectedAgentIds: [],
		});

		expect(result.projectPath).toBeNull();
		expect(result.agentId).toBeNull();
	});
});