import { describe, expect, it } from "bun:test";

import { resolveAgentPanelWorktreePending } from "../worktree-pending.js";

describe("resolveAgentPanelWorktreePending", () => {
	it("uses the panel-owned pending state before the first send", () => {
		expect(
			resolveAgentPanelWorktreePending({
				activeWorktreePath: null,
				hasMessages: false,
				pendingWorktreeEnabled: true,
			})
		).toBe(true);
	});

	it("respects an explicit opted-out panel state", () => {
		expect(
			resolveAgentPanelWorktreePending({
				activeWorktreePath: null,
				hasMessages: false,
				pendingWorktreeEnabled: false,
			})
		).toBe(false);
	});

	it("does not fall back to a new global value after the panel was seeded", () => {
		expect(
			resolveAgentPanelWorktreePending({
				activeWorktreePath: null,
				hasMessages: false,
				pendingWorktreeEnabled: true,
			})
		).toBe(true);
	});

	it("returns false once a worktree already exists", () => {
		expect(
			resolveAgentPanelWorktreePending({
				activeWorktreePath: "/tmp/worktree",
				hasMessages: false,
				pendingWorktreeEnabled: true,
			})
		).toBe(false);
	});

	it("stays pending when a prepared launch already created the worktree", () => {
		expect(
			resolveAgentPanelWorktreePending({
				activeWorktreePath: "/tmp/worktree",
				hasMessages: false,
				pendingWorktreeEnabled: true,
				hasPreparedWorktreeLaunch: true,
			})
		).toBe(true);
	});

	it("stays pending after the first user message until the worktree is created", () => {
		expect(
			resolveAgentPanelWorktreePending({
				activeWorktreePath: null,
				hasMessages: true,
				pendingWorktreeEnabled: true,
			})
		).toBe(true);
	});

	it("returns false when the panel has no pending worktree choice", () => {
		expect(
			resolveAgentPanelWorktreePending({
				activeWorktreePath: null,
				hasMessages: false,
				pendingWorktreeEnabled: null,
			})
		).toBe(false);
	});
});
