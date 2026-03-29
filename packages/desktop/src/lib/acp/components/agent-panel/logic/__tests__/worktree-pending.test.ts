import { describe, expect, it } from "bun:test";

import { resolveAgentPanelWorktreePending } from "../worktree-pending.js";

describe("resolveAgentPanelWorktreePending", () => {
	it("uses persisted toggle state before the first send", () => {
		expect(
			resolveAgentPanelWorktreePending({
				panelId: "panel-1",
				activeWorktreePath: null,
				hasMessages: false,
				globalWorktreeDefault: false,
				loadEnabled: (panelId) => panelId === "panel-1",
			})
		).toBe(true);
	});

	it("respects an opted-out persisted state even when the global default is enabled", () => {
		expect(
			resolveAgentPanelWorktreePending({
				panelId: "panel-1",
				activeWorktreePath: null,
				hasMessages: false,
				globalWorktreeDefault: true,
				loadEnabled: () => false,
			})
		).toBe(false);
	});

	it("returns false once a worktree already exists", () => {
		expect(
			resolveAgentPanelWorktreePending({
				panelId: "panel-1",
				activeWorktreePath: "/tmp/worktree",
				hasMessages: false,
				globalWorktreeDefault: true,
				loadEnabled: () => true,
			})
		).toBe(false);
	});

	it("returns false after the conversation has started", () => {
		expect(
			resolveAgentPanelWorktreePending({
				panelId: "panel-1",
				activeWorktreePath: null,
				hasMessages: true,
				globalWorktreeDefault: true,
				loadEnabled: () => true,
			})
		).toBe(false);
	});

	it("returns false without a panel id", () => {
		expect(
			resolveAgentPanelWorktreePending({
				panelId: null,
				activeWorktreePath: null,
				hasMessages: false,
				globalWorktreeDefault: true,
				loadEnabled: () => true,
			})
		).toBe(false);
	});
});