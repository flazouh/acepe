import { describe, expect, it } from "bun:test";

import { CanonicalModeId } from "$lib/acp/types/canonical-mode-id.js";

import {
	buildKanbanNewSessionProjectChangeState,
	buildKanbanNewSessionResetState,
	resolveKanbanNewSessionDefaults,
	resolveKanbanNewSessionOpenChangeAction,
} from "./kanban-new-session-dialog-state.js";

describe("resolveKanbanNewSessionDefaults", () => {
	it("uses the requested project and agent when they are available", () => {
		const result = resolveKanbanNewSessionDefaults({
			projects: [
				{ path: "/a", name: "Alpha", color: "#111", createdAt: new Date() },
				{ path: "/b", name: "Beta", color: "#222", createdAt: new Date() },
			],
			focusedProjectPath: "/a",
			availableAgents: [
				{ id: "cursor", name: "Cursor", icon: "cursor.svg" },
				{ id: "claude-code", name: "Claude Code", icon: "claude.svg" },
			],
			selectedAgentIds: ["cursor"],
			requestedProjectPath: "/b",
			requestedAgentId: "claude-code",
		});

		expect(result.projectPath).toBe("/b");
		expect(result.agentId).toBe("claude-code");
	});

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

	it("ignores requested defaults that are no longer available", () => {
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
			requestedProjectPath: "/missing",
			requestedAgentId: "missing-agent",
		});

		expect(result.projectPath).toBe("/b");
		expect(result.agentId).toBe("claude-code");
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

	it("builds reset state for opening the dialog", () => {
		const result = buildKanbanNewSessionResetState({
			projects: [
				{ path: "/a", name: "Alpha", color: "#111", createdAt: new Date() },
				{ path: "/b", name: "Beta", color: "#222", createdAt: new Date() },
			],
			focusedProjectPath: "/a",
			availableAgents: [
				{ id: "cursor", name: "Cursor", icon: "cursor.svg" },
				{ id: "claude-code", name: "Claude Code", icon: "claude.svg" },
			],
			selectedAgentIds: ["cursor"],
			defaultAgentId: null,
			request: {
				projectPath: "/b",
				agentId: "claude-code",
				modeId: CanonicalModeId.PLAN,
			},
			currentComposerKey: 4,
			fallbackModeId: CanonicalModeId.BUILD,
			isProjectWorktreeEnabled: () => true,
		});

		expect(result).toEqual({
			selectedProjectPath: "/b",
			selectedAgentId: "claude-code",
			initialModeId: CanonicalModeId.PLAN,
			composerKey: 5,
			activeWorktreePath: null,
			preparedWorktreeLaunch: null,
			worktreePending: true,
		});
	});

	it("does not enable worktree pending when reset has no project", () => {
		const result = buildKanbanNewSessionResetState({
			projects: [],
			focusedProjectPath: null,
			availableAgents: [],
			selectedAgentIds: [],
			currentComposerKey: 1,
			fallbackModeId: CanonicalModeId.BUILD,
			isProjectWorktreeEnabled: () => true,
		});
		expect(result.selectedProjectPath).toBeNull();
		expect(result.selectedAgentId).toBeNull();
		expect(result.initialModeId).toBe(CanonicalModeId.BUILD);
		expect(result.composerKey).toBe(2);
		expect(result.worktreePending).toBe(false);
	});

	it("builds project change state with re-resolved worktree pending", () => {
		const result = buildKanbanNewSessionProjectChangeState({
			projectPath: "/new",
			isProjectWorktreeEnabled: (path) => path === "/new",
		});

		expect(result).toEqual({
			selectedProjectPath: "/new",
			activeWorktreePath: null,
			preparedWorktreeLaunch: null,
			worktreePending: true,
		});
	});

	it("resolves open-change actions", () => {
		expect(
			resolveKanbanNewSessionOpenChangeAction({
				nextOpen: false,
				currentOpen: false,
				pendingRequest: null,
			})
		).toEqual({ kind: "ignore" });
		expect(
			resolveKanbanNewSessionOpenChangeAction({
				nextOpen: false,
				currentOpen: true,
				pendingRequest: null,
			})
		).toEqual({ kind: "close" });
		expect(
			resolveKanbanNewSessionOpenChangeAction({
				nextOpen: true,
				currentOpen: false,
				pendingRequest: { modeId: CanonicalModeId.PLAN },
			})
		).toEqual({ kind: "open", request: { modeId: CanonicalModeId.PLAN } });
	});
});
